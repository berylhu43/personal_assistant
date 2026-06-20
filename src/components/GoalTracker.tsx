import { useCallback, useEffect, useState } from "react";
import {
  listGoals,
  createGoal,
  setGoalProgress,
  setGoalDone,
  deleteGoal,
} from "../lib/goals";
import type { Goal } from "../lib/types";

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

  return (
    <div>
      <ul className="space-y-3.5">
        {goals.map((goal) => (
          <li key={goal.id} className="group">
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggle(goal)}
                aria-label={goal.done ? "Mark not done" : "Mark done"}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition ${
                  goal.done
                    ? "border-done bg-done text-cream"
                    : "border-ink/30"
                }`}
              >
                {goal.done && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6.5L5 9l4.5-5.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
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
                  className="font-sans text-[10px] text-gold hover:underline"
                >
                  {goal.plan.length}-wk plan
                </button>
              )}
              <span className="font-sans text-xs tabular-nums text-ink/40">
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
              className="goal-range mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full"
              style={{
                background: `linear-gradient(to right, ${
                  goal.done ? "#1D9E75" : "#D4A853"
                } ${goal.progress}%, rgba(28,28,30,0.1) ${goal.progress}%)`,
              }}
            />

            {openPlan === goal.id && goal.plan && (
              <ul className="mt-2 space-y-1 border-l border-gold/40 pl-3">
                {goal.plan.map((p) => (
                  <li key={p.week} className="font-sans text-xs text-ink/60">
                    <span className="font-medium text-ink/80">
                      Week {p.week}:
                    </span>{" "}
                    {p.focus}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {goals.length === 0 && (
          <li className="font-sans text-sm italic text-ink/35">
            No goals yet. Add one below or ask the assistant.
          </li>
        )}
      </ul>

      <form onSubmit={add} className="no-drag mt-4 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a goal…"
          className="selectable flex-1 border-b border-ink/15 bg-transparent pb-1 font-sans text-sm text-ink placeholder:text-ink/30 focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          className="font-sans text-sm font-medium text-gold hover:text-[#b8902f]"
        >
          + Add
        </button>
      </form>
    </div>
  );
}
