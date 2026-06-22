import { useCallback, useEffect, useRef, useState } from "react";
import { scanInboxForTasks, type EmailTaskCandidate } from "../lib/emailTasks";
import { createCommitment } from "../lib/localCalendar";
import { saveGoal } from "../lib/goals";
import type { Briefing, CalendarEvent } from "../lib/types";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function BriefingPanel({
  briefing,
  events,
  loading,
  userId,
  onTaskAdded,
}: {
  briefing: Briefing | null;
  events: CalendarEvent[];
  loading: boolean;
  userId: string;
  onTaskAdded: () => void;
}) {
  const today = events.filter((e) => e.day === "today");
  const tomorrow = events.filter((e) => e.day === "tomorrow");

  // Inbox task candidates (null = not scanned yet).
  const [candidates, setCandidates] = useState<EmailTaskCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      setCandidates(await scanInboxForTasks(userId));
    } catch {
      setError("Couldn't scan your inbox.");
      setCandidates([]);
    } finally {
      setScanning(false);
    }
  }, [userId]);

  // Scan once when the panel mounts — guarded so re-renders don't re-trigger.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void scan();
  }, [scan]);

  async function addCandidate(c: EmailTaskCandidate) {
    if (c.task.kind === "goal") {
      await saveGoal({ userId, title: c.task.title, targetDate: c.task.date ?? null });
    } else {
      await createCommitment({
        userId,
        title: c.task.title,
        date: c.task.date ?? todayKey(),
        time: null,
        source: "email",
      });
    }
    setCandidates((prev) => (prev ?? []).filter((x) => x !== c));
    onTaskAdded();
  }

  function dismiss(c: EmailTaskCandidate) {
    setCandidates((prev) => (prev ?? []).filter((x) => x !== c));
  }

  return (
    <div className="border-b border-ink/10 bg-cream/40 px-5 py-4">
      <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-gold">
        Today's Briefing
      </p>

      {briefing ? (
        <>
          <p className="mt-1.5 font-serif text-base leading-snug text-ink">
            {briefing.summary}
          </p>
          {briefing.notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {briefing.notes.map((n, i) => (
                <li key={i} className="flex gap-2 font-sans text-xs text-ink/70">
                  <span className="text-gold">›</span>
                  {n}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-1.5 font-sans text-xs italic text-ink/40">
          {loading
            ? "Gathering your day…"
            : "No briefing yet today — it appears each morning at 9."}
        </p>
      )}

      {/* Schedule glance */}
      <div className="mt-3">
        <p className="mb-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-ink/45">
          Schedule
        </p>
        {today.length + tomorrow.length === 0 ? (
          <Empty>Clear.</Empty>
        ) : (
          <ul className="space-y-1">
            {[...today, ...tomorrow].slice(0, 5).map((e) => (
              <li key={e.id} className="font-sans text-[11px] text-ink/75">
                <span className="text-ink/40">
                  {e.day === "tomorrow" ? "tmrw " : ""}
                  {e.allDay ? "" : formatTime(e.start) + " "}
                </span>
                {e.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Inbox — extracted tasks to confirm */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="font-sans text-[10px] font-semibold uppercase tracking-wide text-ink/45">
            Inbox tasks
          </p>
          <button
            onClick={() => void scan()}
            disabled={scanning}
            className="font-sans text-[10px] text-ink/45 hover:text-ink disabled:opacity-40"
            title="Re-scan inbox"
          >
            ⟳ refresh
          </button>
        </div>

        {scanning ? (
          <Empty>Scanning your inbox…</Empty>
        ) : error ? (
          <Empty>{error}</Empty>
        ) : candidates && candidates.length === 0 ? (
          <Empty>No tasks in your inbox right now.</Empty>
        ) : (
          <ul className="space-y-2">
            {(candidates ?? []).map((c, i) => (
              <li
                key={`${c.emailId}-${i}`}
                className="rounded-lg border border-ink/10 bg-white/60 px-2.5 py-2"
              >
                <p className="font-sans text-xs font-medium text-ink">
                  {c.task.title}
                  {c.task.date && (
                    <span className="font-normal text-ink/45"> · {c.task.date}</span>
                  )}
                  {c.task.kind === "goal" && (
                    <span className="ml-1 rounded bg-gold/20 px-1 text-[8px] uppercase text-[#8a6a1f]">
                      goal
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate font-sans text-[10px] text-ink/45">
                  {c.from} — {c.subject}
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    onClick={() => void addCandidate(c)}
                    className="rounded-md bg-ink px-2 py-0.5 font-sans text-[11px] font-medium text-cream hover:opacity-90"
                  >
                    ✓ Add
                  </button>
                  <button
                    onClick={() => dismiss(c)}
                    className="rounded-md border border-ink/15 px-2 py-0.5 font-sans text-[11px] text-ink/55 hover:text-ink"
                  >
                    ✕ Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-[11px] italic text-ink/35">{children}</p>;
}
