import { useCallback, useEffect, useState } from "react";
import {
  listGoals,
  createGoal,
  setGoalProgress,
  setGoalPlan,
  setGoalDone,
  deleteGoal,
} from "../lib/goals";
import type { Goal } from "../lib/types";

/** "2026-07-01" → "Jul 1". */
function formatTarget(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function GoalTracker({
  userId,
  refreshKey,
}: {
  userId: string;
  refreshKey: number;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState("");
  const [openPlan, setOpenPlan] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listGoals(userId).then(setGoals).catch(() => setGoals([]));
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await createGoal({ userId, title: t });
    refresh();
  }

  async function toggle(g: Goal) {
    await setGoalDone(g.id, !g.done);
    refresh();
  }

  async function progress(g: Goal, value: number) {
    // Optimistic update for a snappy slider.
    setGoals((prev) =>
      prev.map((x) => (x.id === g.id ? { ...x, progress: value } : x))
    );
    await setGoalProgress(g.id, value);
  }

  async function remove(id: string) {
    await deleteGoal(id);
    refresh();
  }

  // Check off a plan step → progress bar reflects the completed fraction.
  async function togglePlanItem(goal: Goal, week: number) {
    if (!goal.plan) return;
    const newPlan = goal.plan.map((p) =>
      p.week === week ? { ...p, done: !p.done } : p
    );
    await setGoalPlan(goal.id, newPlan);
    refresh();
  }

  return (
    <div>
      <ul className="space-y-3.5">
        {goals.map((goal) => (
          <li key={goal.id} className="group">
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggle(goal)}
                aria-label={goal.done ? "Mark not done" : "Mark done"}
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition ${
                  goal.done
                    ? "border-done bg-done text-cream"
                    : "border-ink/25 hover:border-gold"
                }`}
              >
                {goal.done && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6.5L5 9l4.5-5.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <span
                className={`flex-1 truncate font-sans text-sm ${
                  goal.done ? "text-ink/40 line-through" : "text-ink"
                }`}
              >
                {goal.title}
              </span>
              {goal.plan && goal.plan.length > 0 && (
                <button
                  onClick={() =>
                    setOpenPlan(openPlan === goal.id ? null : goal.id)
                  }
                  className="shrink-0 rounded-full bg-gold/15 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-gold-deep transition hover:bg-gold/30"
                >
                  {goal.plan.length}wk
                </button>
              )}
              {goal.targetDate && (
                <span className="shrink-0 font-mono text-[10px] text-ink/40">
                  {formatTarget(goal.targetDate)}
                </span>
              )}
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink/45">
                {goal.progress}%
              </span>
              <button
                onClick={() => remove(goal.id)}
                aria-label="Remove goal"
                className="text-ink/25 opacity-0 transition group-hover:opacity-100 hover:text-ink/60"
              >
                ×
              </button>
            </div>

            <input
              type="range"
              min={0}
              max={100}
              value={goal.progress}
              onChange={(e) => progress(goal, Number(e.target.value))}
              className="goal-range mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full"
              style={{
                background: `linear-gradient(to right, ${
                  goal.done ? "#1D9E75" : "#D4A853"
                } ${goal.progress}%, rgba(28,28,30,0.1) ${goal.progress}%)`,
              }}
            />

            {openPlan === goal.id && goal.plan && (
              <ul className="mt-2 space-y-1.5 border-l border-gold/40 pl-3">
                {goal.plan.map((p) => (
                  <li key={p.week} className="flex items-start gap-2">
                    <button
                      onClick={() => togglePlanItem(goal, p.week)}
                      aria-label={p.done ? "Mark step undone" : "Mark step done"}
                      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition ${
                        p.done
                          ? "border-done bg-done text-cream"
                          : "border-ink/25 hover:border-gold"
                      }`}
                    >
                      {p.done && (
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6.5L5 9l4.5-5.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                    <span
                      className={`font-sans text-xs leading-snug ${
                        p.done ? "text-ink/40 line-through" : "text-ink/65"
                      }`}
                    >
                      <span className="font-mono text-[10px] uppercase text-gold-deep">
                        W{p.week}
                      </span>{" "}
                      {p.focus}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {goals.length === 0 && (
          <li className="font-sans text-[13px] italic text-ink/35">
            No goals yet. Add one below, or ask the assistant.
          </li>
        )}
      </ul>

      <form onSubmit={add} className="no-drag mt-4 flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a goal…"
          className="selectable flex-1 border-b border-ink/15 bg-transparent pb-1 font-sans text-sm text-ink transition placeholder:text-ink/30 focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-ink/5 px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-gold-deep transition hover:bg-gold hover:text-cream"
        >
          + Add
        </button>
      </form>
    </div>
  );
}
