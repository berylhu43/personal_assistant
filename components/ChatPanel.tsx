"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarEvent, PendingEmail, ChatMessage } from "@/lib/types";

interface UIMessage extends ChatMessage {
  id: string;
  hidden?: boolean; // kickoff prompt — sent to API but not rendered
}

interface ProposedEvent {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  description?: string;
}

const ADD_EVENT_RE = /```add-event\s*([\s\S]*?)```/;

/** Pull an add-event JSON block out of an assistant reply, if present. */
function extractEvent(text: string): {
  clean: string;
  event: ProposedEvent | null;
} {
  const match = text.match(ADD_EVENT_RE);
  if (!match) return { clean: text, event: null };
  let event: ProposedEvent | null = null;
  try {
    event = JSON.parse(match[1].trim());
  } catch {
    event = null;
  }
  return { clean: text.replace(ADD_EVENT_RE, "").trim(), event };
}

export default function ChatPanel({
  calendarEvents,
  pendingEmails,
}: {
  calendarEvents: CalendarEvent[];
  pendingEmails: PendingEmail[];
}) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [kickedOff, setKickedOff] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep a ref to messages so async sends use the latest history.
  const messagesRef = useRef<UIMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  // Proactive opening message once the briefing data is available.
  useEffect(() => {
    if (kickedOff) return;
    if (calendarEvents.length === 0 && pendingEmails.length === 0) return;
    setKickedOff(true);
    const kickoff: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      hidden: true,
      content:
        "Give me a brief, proactive good-morning greeting. If anything on my calendar tomorrow likely needs prep, or any email needs a timely reply, point it out. Keep it to a few sentences.",
    };
    void send([kickoff]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarEvents, pendingEmails, kickedOff]);

  async function send(seed?: UIMessage[]) {
    const base = seed ?? messagesRef.current;
    setMessages(base);
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: base.map((m) => ({ role: m.role, content: m.content })),
          calendarEvents,
          pendingEmails,
        }),
      });
      const data = await res.json();
      const reply: string = res.ok
        ? data.reply
        : data.error ?? "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "I couldn't reach the server. Please try again.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const next = [
      ...messagesRef.current,
      { id: crypto.randomUUID(), role: "user" as const, content: text },
    ];
    setInput("");
    void send(next);
  }

  const visible = messages.filter((m) => !m.hidden);

  return (
    <section className="flex h-full w-full flex-col bg-white md:w-1/2">
      <header className="border-b border-ink/10 px-6 py-4">
        <h2 className="font-serif text-2xl text-ink">Assistant</h2>
        <p className="font-sans text-xs text-ink/45">
          Tell me your goals and plans — I'll help organize the week.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="slim-scroll flex-1 space-y-4 overflow-y-auto px-6 py-6"
      >
        {visible.length === 0 && !sending && (
          <p className="mt-8 text-center font-sans text-sm italic text-ink/30">
            Start by telling me a goal, like “I want to learn AI agents this
            month.”
          </p>
        )}

        {visible.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.content} />
          ) : (
            <AssistantBubble key={m.id} text={m.content} />
          )
        )}

        {sending && <TypingIndicator />}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-ink/10 px-6 py-4"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            rows={1}
            placeholder="Message your assistant…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-ink/15 bg-cream/40 px-4 py-2.5 font-sans text-sm text-ink placeholder:text-ink/35 focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-xl bg-ink px-4 py-2.5 font-sans text-sm font-medium text-cream transition hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 font-sans text-sm leading-relaxed text-cream">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ text }: { text: string }) {
  const { clean, event } = extractEvent(text);
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-ink/10 bg-white px-4 py-2.5 font-sans text-sm leading-relaxed text-ink shadow-sm">
          {clean}
        </div>
        {event && <AddEventCard event={event} />}
      </div>
    </div>
  );
}

function AddEventCard({ event }: { event: ProposedEvent }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">(
    "idle"
  );

  async function add() {
    setState("saving");
    try {
      const res = await fetch("/api/calendar/add-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  const when =
    event.startTime && event.endTime
      ? `${event.date} · ${event.startTime}–${event.endTime}`
      : `${event.date} · all day`;

  return (
    <div className="mt-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5">
      <p className="font-sans text-xs uppercase tracking-wide text-[#8a6a1f]">
        Suggested event
      </p>
      <p className="mt-0.5 font-sans text-sm font-medium text-ink">
        {event.title}
      </p>
      <p className="font-sans text-xs text-ink/55">{when}</p>
      <button
        onClick={add}
        disabled={state === "saving" || state === "done"}
        className="mt-2 rounded-lg bg-ink px-3 py-1.5 font-sans text-xs font-medium text-cream transition hover:opacity-90 disabled:opacity-50"
      >
        {state === "idle" && "Add to calendar"}
        {state === "saving" && "Adding…"}
        {state === "done" && "✓ Added"}
        {state === "error" && "Failed — retry"}
      </button>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex gap-1 rounded-2xl rounded-bl-sm border border-ink/10 bg-white px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
