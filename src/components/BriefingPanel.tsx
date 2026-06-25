import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOrScanInbox,
  rescanInbox,
  setCachedInbox,
} from "../lib/emailTasks";
import { createCommitment } from "../lib/localCalendar";
import { saveGoal } from "../lib/goals";
import { friendlyError } from "../lib/errors";
import type { Briefing, InboxTaskCandidate } from "../lib/types";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function BriefingPanel({
  briefing,
  loading,
  expanded,
  userId,
  onTaskAdded,
}: {
  briefing: Briefing | null;
  loading: boolean;
  expanded: boolean;
  userId: string;
  onTaskAdded: () => void;
}) {
  // Inbox task candidates (null = not scanned yet).
  const [candidates, setCandidates] = useState<InboxTaskCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Only the notes list collapses — the summary is always visible.
  const [notesOpen, setNotesOpen] = useState(true);

  // `force` re-spends tokens (manual Refresh); otherwise use the daily cache.
  const scan = useCallback(
    async (force: boolean) => {
      setScanning(true);
      setError(null);
      try {
        setCandidates(
          force ? await rescanInbox(userId) : await getOrScanInbox(userId)
        );
      } catch (e) {
        console.error("inbox scan failed:", e);
        setError(friendlyError(e));
        setCandidates([]);
      } finally {
        setScanning(false);
      }
    },
    [userId]
  );

  // Scan only when the Inbox is actually shown (expanded). Cached per-day, so
  // re-expanding the same day costs no tokens. Collapsed never scans.
  useEffect(() => {
    if (!expanded || startedRef.current) return;
    startedRef.current = true;
    void scan(false);
  }, [expanded, scan]);

  async function addCandidate(c: InboxTaskCandidate) {
    if (c.task.kind === "goal") {
      await saveGoal({ userId, title: c.task.title, targetDate: c.task.date ?? null });
    } else {
      await createCommitment({
        userId,
        title: c.task.title,
        date: c.task.date ?? todayKey(),
        time: null,
        source: c.source,
      });
    }
    const next = (candidates ?? []).filter((x) => x !== c);
    setCandidates(next);
    await setCachedInbox(userId, next); // so it doesn't reappear next read
    onTaskAdded();
  }

  function dismiss(c: InboxTaskCandidate) {
    const next = (candidates ?? []).filter((x) => x !== c);
    setCandidates(next);
    void setCachedInbox(userId, next);
  }

  return (
    <div className="relative bg-gradient-to-b from-paper/70 to-cream/30 px-5 py-5 pl-10">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="h-1 w-1 rounded-full bg-gold" />
        <span className="eyebrow">Today's Briefing</span>
      </div>

      {briefing ? (
        <>
          {/* Summary — always visible (collapsed shows only this) */}
          <p className="font-serif text-[17px] leading-snug text-ink">
            {briefing.summary}
          </p>
          {expanded && briefing.notes.length > 0 && (
            <div className="mt-2.5">
              {notesOpen && (
                <ul className="mb-2 space-y-1.5">
                  {briefing.notes.map((n, i) => (
                    <li
                      key={i}
                      className="flex gap-2 font-sans text-xs leading-relaxed text-ink/70"
                    >
                      <span className="mt-px select-none text-ink/35">–</span>
                      {n}
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => setNotesOpen((o) => !o)}
                className="font-mono text-[10px] uppercase tracking-wide text-ink/45 transition hover:text-gold-deep"
              >
                {notesOpen ? "Hide notes" : `Show notes (${briefing.notes.length})`}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="flex items-center gap-2 font-sans text-xs italic text-ink/45">
          {loading && (
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-gold" />
          )}
          {loading
            ? "Gathering your day…"
            : "No briefing yet — connect Google to see your day."}
        </p>
      )}

      {/* Inbox — expanded only (collapsed never scans) */}
      {expanded && (
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-gold" />
            <span className="eyebrow">Inbox</span>
          </div>
          <button
            onClick={() => void scan(true)}
            disabled={scanning}
            title="Refresh inbox"
            aria-label="Refresh inbox"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink/45 transition hover:bg-ink/5 hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={scanning ? "animate-spin" : ""}
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
        </div>

        {scanning ? (
          <Empty>Reading your inbox…</Empty>
        ) : error ? (
          <Empty>{error}</Empty>
        ) : candidates && candidates.length === 0 ? (
          <Empty>No tasks in your inbox right now.</Empty>
        ) : (
          <ul className="space-y-2">
            {(candidates ?? []).map((c, i) => (
              <li
                key={`${c.sourceId}-${i}`}
                className="lift relative rounded-xl border border-ink/10 bg-paper/80 px-3 py-2.5 pr-9 shadow-memo hover:border-gold/50"
              >
                <button
                  onClick={() => dismiss(c)}
                  aria-label="Close task"
                  className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full font-mono text-ink/35 transition hover:bg-ink/5 hover:text-ink"
                >
                  ×
                </button>
                <p className="font-sans text-[13px] font-medium leading-snug text-ink">
                  {c.task.title}
                  {c.task.date && (
                    <span className="font-mono text-[10px] font-normal text-ink/45">
                      {" "}
                      · {c.task.date}
                    </span>
                  )}
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-px font-mono text-[8px] uppercase tracking-wide ${
                      c.source === "teams"
                        ? "bg-[#4B53BC]/15 text-[#4B53BC]"
                        : "bg-ink/10 text-ink/50"
                    }`}
                  >
                    {c.source}
                  </span>
                  {c.task.kind === "goal" && (
                    <span className="ml-1.5 rounded-full bg-gold/20 px-1.5 py-px font-mono text-[8px] uppercase tracking-wide text-gold-deep">
                      goal
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-ink/40">
                  {c.from} — {c.subject}
                </p>
                <div className="mt-2">
                  <button
                    onClick={() => void addCandidate(c)}
                    className="rounded-full bg-ink px-3 py-1 font-sans text-[11px] font-medium text-cream transition hover:bg-gold-deep"
                  >
                    Add
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-[11px] italic text-ink/35">{children}</p>;
}
