import { useEffect, useRef, useState } from "react";
import { runChatTurn, clearMessages } from "../lib/chat";
import { distillConversation } from "../lib/distill";
import { MissingApiKeyError } from "../lib/anthropic";
import type { CalendarEvent, PendingEmail, ChatMessage } from "../lib/types";

interface UIMessage extends ChatMessage {
  id: string;
}

export default function ChatPanel({
  userId,
  events,
  emails,
  onGoalCreated,
  onCommitmentCreated,
  onNeedApiKey,
  onClose,
}: {
  userId: string;
  events: CalendarEvent[];
  emails: PendingEmail[];
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

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
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: result.reply },
      ]);
      if (result.createdGoal) onGoalCreated();
      if (result.createdCommitment) onCommitmentCreated();
    } catch (e) {
      if (e instanceof MissingApiKeyError) {
        onNeedApiKey();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Add your Anthropic API key in settings and I'll be ready.",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Something went wrong: ${
              (e as Error)?.message ?? "unknown error"
            }`,
          },
        ]);
      }
    } finally {
      setSending(false);
    }
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
    setClosing(false);
    onClose();
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="no-drag flex items-center justify-between border-b border-ink/10 px-4 py-2">
        <span className="font-serif text-sm text-ink">Conversation</span>
        <button
          onClick={() => void endAndSave()}
          disabled={closing}
          className="rounded-full border border-ink/15 px-3 py-1 font-sans text-xs font-medium text-ink/70 transition hover:border-gold hover:text-ink disabled:opacity-50"
          title="Distill this conversation into goals, commitments & memory, then close it"
        >
          {closing ? "Saving…" : "End & save"}
        </button>
      </header>

      <div
        ref={scrollRef}
        className="slim-scroll selectable flex-1 space-y-3 overflow-y-auto px-5 py-4"
      >
        {messages.length === 0 && !sending && (
          <p className="mt-6 text-center font-sans text-sm italic text-ink/30">
            Tell me a goal or plan — e.g. “I want to learn AI agents this month.”
          </p>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 font-sans text-sm leading-relaxed text-cream">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-ink/10 bg-white px-3.5 py-2 font-sans text-sm leading-relaxed text-ink shadow-sm">
                {m.content}
              </div>
            </div>
          )
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-2xl rounded-bl-sm border border-ink/10 bg-white px-3.5 py-2.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="no-drag border-t border-ink/10 px-4 py-3">
        <div className="flex items-end gap-2">
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
            className="selectable max-h-28 flex-1 resize-none rounded-xl border border-ink/15 bg-cream/40 px-3 py-2 font-sans text-sm text-ink placeholder:text-ink/35 focus:border-gold focus:outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="rounded-xl bg-ink px-3.5 py-2 font-sans text-sm font-medium text-cream transition hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
