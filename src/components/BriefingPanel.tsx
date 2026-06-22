import { useCallback, useEffect, useRef, useState } from "react";
import { scanInboxForTasks, type EmailTaskCandidate } from "../lib/emailTasks";
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
  userId,
  onTaskAdded,
}: {
  briefing: Briefing | null;
  loading: boolean;
  userId: string;
  onTaskAdded: () => void;
}) {
  // Inbox task candidates (null = not scanned yet).
  const [candidates, setCandidates] = useState<EmailTaskCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Collapsible sections.
  const [briefingOpen, setBriefingOpen] = useState(true);
  const [inboxOpen, setInboxOpen] = useState(true);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      setCandidates(await scanInboxForTasks(userId));
    } catch (e) {
      console.error("inbox scan failed:", e);
      setError(`Couldn't scan: ${e instanceof Error ? e.message : String(e)}`);
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
    <div className="relative border-b border-ink/10 bg-gradient-to-b from-paper/70 to-cream/30 px-5 py-5 pl-10">
      <button
        onClick={() => setBriefingOpen((o) => !o)}
        className="mb-2 flex w-full items-center gap-1.5"
      >
        <span className="h-1 w-1 rounded-full bg-gold" />
        <span className="eyebrow">Today's Briefing</span>
        <span
          className={`ml-auto text-ink/35 transition-transform ${
            briefingOpen ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>

      {briefingOpen &&
        (briefing ? (
          <>
            <p className="font-serif text-[17px] leading-snug text-ink">
              {briefing.summary}
            </p>
            {briefing.notes.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {briefing.notes.map((n, i) => (
                  <li
                    key={i}
                    className="flex gap-2 font-sans text-xs leading-relaxed text-ink/70"
                  >
                    <span className="mt-px select-none text-gold-deep">›</span>
                    {n}
                  </li>
                ))}
              </ul>
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
        ))}

      {/* Inbox — extracted tasks to confirm */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setInboxOpen((o) => !o)}
            className="flex items-center gap-1.5"
          >
            <span className="h-1 w-1 rounded-full bg-gold" />
            <span className="eyebrow">Inbox</span>
            <span
              className={`text-ink/35 transition-transform ${
                inboxOpen ? "rotate-90" : ""
              }`}
            >
              ›
            </span>
            {candidates && candidates.length > 0 && (
              <span className="rounded-full bg-gold/20 px-1.5 font-mono text-[9px] text-gold-deep">
                {candidates.length}
              </span>
            )}
          </button>
          <button
            onClick={() => void scan()}
            disabled={scanning}
            className="font-mono text-[10px] lowercase tracking-wide text-ink/40 transition hover:text-gold-deep disabled:opacity-40"
            title="Re-scan inbox"
          >
            {scanning ? "scanning…" : "⟳ refresh"}
          </button>
        </div>

        {!inboxOpen ? null : scanning ? (
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
                className="lift group/task relative rounded-xl border border-ink/10 bg-paper/80 px-3 py-2.5 pr-7 shadow-memo hover:border-gold/50"
              >
                <button
                  onClick={() => dismiss(c)}
                  aria-label="Close task"
                  title="Close"
                  className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-ink/30 transition hover:bg-ink/5 hover:text-ink"
                >
                  ✕
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
                    ✓ Add
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
