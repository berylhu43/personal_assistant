import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOrScanInbox,
  rescanInbox,
  setCachedInbox,
  type EmailTaskCandidate,
} from "../lib/emailTasks";
import { createCommitment } from "../lib/localCalendar";
import { saveGoal } from "../lib/goals";
import type { Briefing } from "../lib/types";

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
  const [candidates, setCandidates] = useState<EmailTaskCandidate[] | null>(null);
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
        setError(`Couldn't scan: ${e instanceof Error ? e.message : String(e)}`);
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
    const next = (candidates ?? []).filter((x) => x !== c);
    setCandidates(next);
    await setCachedInbox(userId, next); // so it doesn't reappear next read
    onTaskAdded();
  }

  function dismiss(c: EmailTaskCandidate) {
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
            className="shrink-0 rounded-full bg-ink/5 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-gold-deep transition hover:bg-gold hover:text-cream disabled:opacity-50 disabled:hover:bg-ink/5 disabled:hover:text-gold-deep"
          >
            {scanning ? "Scanning…" : "Refresh"}
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
                key={`${c.emailId}-${i}`}
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
