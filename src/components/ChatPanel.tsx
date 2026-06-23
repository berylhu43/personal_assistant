import { useEffect, useRef, useState } from "react";
import { runChatTurn, clearMessages } from "../lib/chat";
import { distillConversation } from "../lib/distill";
import { downloadPlan } from "../lib/planExport";
import {
  pickDocument,
  extractText,
  extractAssignments,
  FileExtractError,
  type AssignmentCandidate,
} from "../lib/fileTasks";
import { createCommitment } from "../lib/localCalendar";
import { MissingApiKeyError } from "../lib/anthropic";
import { friendlyError } from "../lib/errors";
import type { PendingPlan } from "../lib/store";
import type { CalendarEvent, PendingEmail, ChatMessage } from "../lib/types";

function formatDue(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface UIMessage extends ChatMessage {
  id: string;
}

export default function ChatPanel({
  userId,
  events,
  emails,
  planning,
  planResult,
  onPlanConfirmed,
  onGoalCreated,
  onCommitmentCreated,
  onNeedApiKey,
  onClose,
}: {
  userId: string;
  events: CalendarEvent[];
  emails: PendingEmail[];
  planning: boolean;
  planResult: { reply: string; goalId: string | null } | null;
  onPlanConfirmed: (pending: PendingPlan) => void;
  onGoalCreated: () => void;
  onCommitmentCreated: () => void;
  onNeedApiKey: () => void;
  onClose: () => void;
}) {
  // Conversations are ephemeral: the UI ALWAYS starts empty on launch and never
  // replays a prior conversation (the messages table is the live session only).
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  // Assignment candidates extracted from an uploaded document, awaiting confirm.
  const [fileItems, setFileItems] = useState<AssignmentCandidate[]>([]);
  const [fileCourse, setFileCourse] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending, planning, planResult, fileItems, attaching]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
    ]);
    setSending(true);

    try {
      const result = await runChatTurn(userId, text, { events, emails });
      // A learning-plan confirmation: hand off to App (survives collapse). The
      // App-driven indicator + result/Download will render below.
      if (result.planConfirmed) {
        console.log("[plan-debug] ChatPanel: planConfirmed → onPlanConfirmed");
        onPlanConfirmed(result.planConfirmed);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: result.reply },
      ]);
      if (result.createdGoal) onGoalCreated();
      if (result.createdCommitment) onCommitmentCreated();
    } catch (e) {
      console.error("chat turn failed:", e);
      if (e instanceof MissingApiKeyError) onNeedApiKey();
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: friendlyError(e),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  // Attach a document (syllabus etc.), extract assignment candidates, and surface
  // them as confirm-to-add cards. Nothing is written until the user taps Add.
  async function attachFile() {
    if (attaching || sending) return;
    let path: string | null = null;
    try {
      path = await pickDocument();
    } catch (e) {
      console.error("file pick failed:", e);
      return;
    }
    if (!path) return;

    const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
    setAttaching(true);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: `📎 ${name}` },
    ]);

    try {
      const { text } = await extractText(path);
      const { course, items } = await extractAssignments(text);
      if (items.length === 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "I read that file but couldn't find any assignments with due dates.",
          },
        ]);
      } else {
        setFileCourse(course);
        setFileItems(items);
        const label = course ? ` for ${course}` : "";
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Found ${items.length} item${
              items.length > 1 ? "s" : ""
            }${label} with due dates — confirm the ones to add:`,
          },
        ]);
      }
    } catch (e) {
      console.error("file extraction failed:", e);
      if (e instanceof MissingApiKeyError) onNeedApiKey();
      const content =
        e instanceof FileExtractError ? e.message : friendlyError(e);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content },
      ]);
    } finally {
      setAttaching(false);
    }
  }

  async function addFileItem(item: AssignmentCandidate) {
    const title = fileCourse ? `${fileCourse}: ${item.title}` : item.title;
    await createCommitment({
      userId,
      title,
      date: item.due,
      time: null,
      source: "file",
    });
    setFileItems((prev) => prev.filter((x) => x !== item));
    onCommitmentCreated();
  }

  function dismissFileItem(item: AssignmentCandidate) {
    setFileItems((prev) => prev.filter((x) => x !== item));
  }

  // End & save: distill the conversation into durable stores, clear it, and
  // collapse to the todo view. If distillation fails, keep the transcript so the
  // next launch retries — but still reset the UI.
  async function endAndSave() {
    if (closing) return;
    setClosing(true);
    let distilled = false;
    try {
      await distillConversation(userId);
      distilled = true;
    } catch {
      /* keep transcript for next-launch retry */
    }
    if (distilled) {
      await clearMessages(userId);
    }
    setMessages([]);
    setInput("");
    setFileItems([]);
    setFileCourse(null);
    setClosing(false);
    onClose();
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-white to-paper/40">
      <header className="no-drag flex items-center justify-between border-b border-ink/10 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-gold" />
          <span className="eyebrow">Conversation</span>
        </div>
        <button
          onClick={() => void endAndSave()}
          disabled={closing}
          className="rounded-full border border-ink/15 px-3 py-1 font-sans text-xs font-medium text-ink/70 transition hover:border-gold hover:bg-gold/5 hover:text-ink disabled:opacity-50"
          title="Distill this conversation into goals, commitments & memory, then close it"
        >
          {closing ? "Saving…" : "End & save"}
        </button>
      </header>

      <div
        ref={scrollRef}
        className="slim-scroll selectable flex-1 space-y-3 overflow-y-auto px-5 py-5"
      >
        {messages.length === 0 && !sending && (
          <div className="mt-10 px-6 text-center">
            <p className="font-sans text-sm italic leading-relaxed text-ink/35">
              Tell me a goal or plan — e.g. “I want to learn AI agents this
              month.”
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3.5 py-2 font-sans text-sm leading-relaxed text-cream shadow-memo">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-ink/10 bg-paper/80 px-3.5 py-2 font-sans text-sm leading-relaxed text-ink shadow-memo">
                {m.content}
              </div>
            </div>
          )
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-2xl rounded-bl-md border border-ink/10 bg-paper/80 px-3.5 py-2.5 shadow-memo">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold/70"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* App-driven plan generation (survives collapse/expand) */}
        {planning && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-gold/40 bg-gold/10 px-3.5 py-2 font-sans text-xs text-ink/70 shadow-memo">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-gold" />
              Searching and building your plan…
            </div>
          </div>
        )}

        {/* Extracting assignments from an attached document */}
        {attaching && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-gold/40 bg-gold/10 px-3.5 py-2 font-sans text-xs text-ink/70 shadow-memo">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-gold" />
              Reading the file…
            </div>
          </div>
        )}

        {/* Assignment candidates extracted from a document (confirm to add) */}
        {fileItems.length > 0 && (
          <div className="space-y-2">
            {fileItems.map((it, i) => (
              <div
                key={`${it.title}-${i}`}
                className="lift relative rounded-xl border border-ink/10 bg-paper/80 px-3 py-2.5 pr-9 shadow-memo hover:border-gold/50"
              >
                <button
                  onClick={() => dismissFileItem(it)}
                  aria-label="Dismiss"
                  className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full font-mono text-ink/35 transition hover:bg-ink/5 hover:text-ink"
                >
                  ×
                </button>
                <p className="font-sans text-[13px] font-medium leading-snug text-ink">
                  {it.title}
                  <span className="ml-1.5 rounded-full bg-gold/20 px-1.5 py-px font-mono text-[8px] uppercase tracking-wide text-gold-deep">
                    {it.type}
                  </span>
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-ink/45">
                  Due {formatDue(it.due)}
                  {it.note ? ` · ${it.note}` : ""}
                </p>
                <div className="mt-2">
                  <button
                    onClick={() => void addFileItem(it)}
                    className="rounded-full bg-ink px-3 py-1 font-sans text-[11px] font-medium text-cream transition hover:bg-gold-deep"
                  >
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Completed plan: message + Download control */}
        {!planning && planResult && (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-ink/10 bg-paper/80 px-3.5 py-2 shadow-memo">
              <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
                {planResult.reply}
              </p>
              {planResult.goalId && (
                <button
                  onClick={() => void downloadPlan(planResult.goalId!)}
                  className="mt-2 rounded-full bg-ink px-3 py-1 font-sans text-[11px] font-medium text-cream transition hover:bg-gold-deep"
                >
                  Download plan
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="no-drag border-t border-ink/10 bg-paper/50 px-4 py-3">
        <div className="flex items-end gap-2">
          <button
            onClick={() => void attachFile()}
            disabled={attaching || sending}
            title="Attach a file (PDF, txt, or md)"
            aria-label="Attach file"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink/15 bg-cream/50 text-ink/45 transition hover:border-gold hover:text-gold-deep disabled:opacity-40"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={attaching ? "animate-spin" : ""}
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Message…"
            className="selectable focus-gold max-h-28 flex-1 resize-none rounded-xl border border-ink/15 bg-cream/50 px-3.5 py-2.5 font-sans text-sm text-ink transition placeholder:text-ink/35"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="rounded-xl bg-ink px-4 py-2.5 font-sans text-sm font-medium text-cream shadow-memo transition hover:bg-gold-deep disabled:opacity-40 disabled:hover:bg-ink"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
