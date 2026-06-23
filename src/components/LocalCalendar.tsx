import { useCallback, useEffect, useRef, useState } from "react";
import {
  listThroughTomorrow,
  createCommitment,
  setCommitmentDone,
  deleteCommitment,
} from "../lib/localCalendar";
import { getPlanByGoal } from "../lib/plans";
import { openExternal } from "../lib/openExternal";
import type { Commitment, PlanDay } from "../lib/types";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Week of Jun 22 – Jun 28" for a weekly task (Monday → Sunday). */
function formatWeek(weekStart: string): string {
  return `Week of ${formatDay(weekStart)} – ${formatDay(addDays(weekStart, 6))}`;
}

export default function LocalCalendar({
  userId,
  refreshKey,
  onTaskToggled,
}: {
  userId: string;
  refreshKey: number;
  onTaskToggled?: () => void;
}) {
  const [items, setItems] = useState<Commitment[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayKey());
  // The plan-day detail matched to each expanded task (undefined = not loaded).
  const [dayById, setDayById] = useState<Record<string, PlanDay | null>>({});
  // Cache of full plan documents by goal id, so sibling days don't refetch.
  const docCache = useRef<Map<string, PlanDay[]>>(new Map());

  async function toggleExpand(c: Commitment) {
    const willOpen = !expanded.has(c.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
      return next;
    });
    // Lazily load this task's plan-day detail from its goal's plan document.
    if (willOpen && c.goalId && dayById[c.id] === undefined) {
      try {
        let days = docCache.current.get(c.goalId);
        if (!days) {
          const row = await getPlanByGoal(c.goalId);
          const parsed = row ? (JSON.parse(row.content) as PlanDay[]) : [];
          days = Array.isArray(parsed) ? parsed : [];
          docCache.current.set(c.goalId, days);
        }
        const day = days.find((d) => d.date === c.date) ?? null;
        setDayById((m) => ({ ...m, [c.id]: day }));
      } catch {
        setDayById((m) => ({ ...m, [c.id]: null }));
      }
    }
  }

  const refresh = useCallback(() => {
    listThroughTomorrow(userId).then(setItems).catch(() => setItems([]));
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  async function toggle(c: Commitment) {
    await setCommitmentDone(c.id, !c.done);
    refresh();
    // A linked task may have moved its goal's progress — refresh the goals panel.
    onTaskToggled?.();
  }

  async function remove(id: string) {
    await deleteCommitment(id);
    refresh();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await createCommitment({
      userId,
      title: t,
      date: date || todayKey(),
      time: null,
      source: "manual",
    });
    refresh();
  }

  const today = todayKey();

  return (
    <div>
      {items.length === 0 ? (
        <p className="font-sans text-[13px] italic text-ink/35">
          No upcoming tasks.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((c) => {
            const isWeekly = c.span === "week";
            const overdue = isWeekly
              ? addDays(c.date, 6) < today
              : c.date < today;
            return (
              <li key={c.id} className="group flex items-start gap-2.5">
                <button
                  onClick={() => toggle(c)}
                  aria-label={c.done ? "Mark not done" : "Mark done"}
                  className={`mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[6px] border transition ${
                    c.done
                      ? "border-done bg-done"
                      : "border-ink/25 hover:border-gold"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p
                    onClick={() => void toggleExpand(c)}
                    title="Click to expand"
                    className={`cursor-pointer font-sans text-sm leading-snug text-ink ${
                      expanded.has(c.id)
                        ? "whitespace-normal break-words"
                        : "truncate"
                    }`}
                  >
                    {c.title}
                  </p>
                  <p
                    className={`mt-0.5 font-mono text-[10px] uppercase tracking-wide ${
                      overdue ? "font-bold text-gold-deep" : "text-ink/40"
                    }`}
                  >
                    {isWeekly ? formatWeek(c.date) : formatDate(c.date)}
                    {c.time ? ` · ${c.time}` : ""}
                    {overdue ? " · overdue" : ""}
                  </p>

                  {/* Expanded plan-day detail (learning-plan tasks) */}
                  {expanded.has(c.id) && dayById[c.id] && (
                    <div className="mt-1.5 border-l border-gold/40 pl-2.5">
                      {dayById[c.id]!.task && (
                        <p className="font-sans text-[11px] leading-snug text-ink/65">
                          {dayById[c.id]!.task}
                        </p>
                      )}
                      {dayById[c.id]!.practice && (
                        <p className="font-sans text-[11px] leading-snug text-ink/55">
                          Practice: {dayById[c.id]!.practice}
                        </p>
                      )}
                      {dayById[c.id]!.est_time && (
                        <p className="font-mono text-[10px] text-ink/40">
                          {dayById[c.id]!.est_time}
                        </p>
                      )}
                      {dayById[c.id]!.resources?.length ? (
                        <ul className="mt-0.5 space-y-1">
                          {dayById[c.id]!.resources!.map((r, j) => (
                            <li
                              key={j}
                              className="selectable font-mono text-[10px] leading-snug text-ink/55"
                            >
                              {r.title} —{" "}
                              <button
                                onClick={() => void openExternal(r.url)}
                                className="break-all text-left text-gold-deep underline-offset-2 hover:underline"
                                title="Open in browser"
                              >
                                {r.url}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => remove(c.id)}
                  aria-label="Remove task"
                  className="font-mono leading-none text-ink/25 opacity-0 transition group-hover:opacity-100 hover:text-ink/60"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={add} className="no-drag mt-4 flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          className="selectable min-w-0 flex-1 border-b border-ink/15 bg-transparent pb-1 font-sans text-sm text-ink transition placeholder:text-ink/30 focus:border-gold focus:outline-none"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="selectable shrink-0 border-b border-ink/15 bg-transparent pb-1 font-mono text-[11px] text-ink/70 transition focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-ink/5 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-gold-deep transition hover:bg-gold hover:text-cream"
        >
          Add
        </button>
      </form>
    </div>
  );
}
