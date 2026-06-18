"use client";

import { signOut } from "next-auth/react";
import type { CalendarEvent, PendingEmail } from "@/lib/types";
import GoalTracker from "./GoalTracker";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

const tagStyles: Record<string, string> = {
  "reply needed": "bg-gold/20 text-[#8a6a1f]",
  "prep needed": "bg-ink/10 text-ink",
  review: "bg-done/15 text-done",
  unread: "bg-ink/5 text-ink/60",
};

function Tag({ label }: { label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        tagStyles[label] ?? "bg-ink/5 text-ink/60"
      }`}
    >
      {label}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-serif text-xl text-ink">{children}</h2>
  );
}

export default function BriefingPanel({
  events,
  emails,
  loading,
  error,
  userName,
}: {
  events: CalendarEvent[];
  emails: PendingEmail[];
  loading: boolean;
  error: string | null;
  userName: string | null;
}) {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const todayEvents = events.filter((e) => e.day === "today");
  const tomorrowEvents = events.filter((e) => e.day === "tomorrow");

  return (
    <section className="ruled-paper margin-line h-full w-full overflow-y-auto slim-scroll md:w-1/2 md:border-r md:border-ink/10">
      <div className="px-6 py-8 pl-16">
        {/* Header */}
        <div className="rise flex items-start justify-between">
          <div>
            <p className="font-sans text-xs uppercase tracking-[0.2em] text-gold">
              Daily Briefing
            </p>
            <h1 className="mt-1 font-serif text-4xl leading-none text-ink">
              {dateStr}
            </h1>
            {userName && (
              <p className="mt-2 font-sans text-sm text-ink/60">
                Good day, {userName.split(" ")[0]}.
              </p>
            )}
          </div>
          <button
            onClick={() => signOut()}
            className="font-sans text-xs text-ink/40 underline-offset-2 hover:underline"
          >
            Sign out
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-md bg-gold/15 px-3 py-2 font-sans text-xs text-[#8a6a1f]">
            {error}
          </p>
        )}

        {/* Today */}
        <div className="rise mt-8" style={{ animationDelay: "60ms" }}>
          <SectionTitle>Today</SectionTitle>
          {loading ? (
            <SkeletonRows />
          ) : todayEvents.length === 0 ? (
            <Empty>Nothing scheduled today.</Empty>
          ) : (
            <ul className="space-y-2">
              {todayEvents.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </div>

        {/* Tomorrow */}
        <div className="rise mt-8" style={{ animationDelay: "120ms" }}>
          <SectionTitle>Tomorrow</SectionTitle>
          {loading ? (
            <SkeletonRows />
          ) : tomorrowEvents.length === 0 ? (
            <Empty>Nothing scheduled tomorrow.</Empty>
          ) : (
            <ul className="space-y-2">
              {tomorrowEvents.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </div>

        {/* Emails */}
        <div className="rise mt-8" style={{ animationDelay: "180ms" }}>
          <SectionTitle>Inbox needs you</SectionTitle>
          {loading ? (
            <SkeletonRows />
          ) : emails.length === 0 ? (
            <Empty>No emails need action right now.</Empty>
          ) : (
            <ul className="space-y-3">
              {emails.map((m) => (
                <li
                  key={m.id}
                  className="border-l-2 border-ink/10 pl-3 hover:border-gold"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-sans text-sm font-medium text-ink">
                      {m.subject}
                    </p>
                    <Tag label={m.tag} />
                  </div>
                  <p className="truncate font-sans text-xs text-ink/50">
                    {m.from}
                  </p>
                  <p className="mt-0.5 line-clamp-2 font-sans text-xs text-ink/40">
                    {m.snippet}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Goals */}
        <div className="rise mt-8" style={{ animationDelay: "240ms" }}>
          <SectionTitle>Goals</SectionTitle>
          <GoalTracker />
        </div>
      </div>
    </section>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="w-16 shrink-0 font-sans text-xs tabular-nums text-ink/50">
        {event.allDay ? "all day" : formatTime(event.start)}
      </span>
      <span className="font-sans text-sm text-ink">
        {event.title}
        {event.location && (
          <span className="text-ink/40"> · {event.location}</span>
        )}
      </span>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-sm italic text-ink/35">{children}</p>;
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-4 w-2/3 animate-pulse rounded bg-ink/10"
          style={{ width: `${70 - i * 15}%` }}
        />
      ))}
    </div>
  );
}
