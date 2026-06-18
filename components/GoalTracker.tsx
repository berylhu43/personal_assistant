"use client";

import { useEffect, useState } from "react";
import type { Goal } from "@/lib/types";

const STORAGE_KEY = "pa.goals.v1";

function loadGoals(): Goal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Goal[]) : [];
  } catch {
    return [];
  }
}

export default function GoalTracker() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    setGoals(loadGoals());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
  }, [goals, hydrated]);

  function addGoal(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setGoals((g) => [
      ...g,
      {
        id: crypto.randomUUID(),
        title: t,
        progress: 0,
        done: false,
        createdAt: new Date().toISOString(),
      },
    ]);
    setTitle("");
  }

  function toggleDone(id: string) {
    setGoals((g) =>
      g.map((goal) =>
        goal.id === id
          ? {
              ...goal,
              done: !goal.done,
              progress: !goal.done ? 100 : goal.progress,
            }
          : goal
      )
    );
  }

  function setProgress(id: string, progress: number) {
    setGoals((g) =>
      g.map((goal) =>
        goal.id === id
          ? { ...goal, progress, done: progress >= 100 }
          : goal
      )
    );
  }

  function removeGoal(id: string) {
    setGoals((g) => g.filter((goal) => goal.id !== id));
  }

  return (
    <div>
      <ul className="space-y-4">
        {goals.map((goal) => (
          <li key={goal.id} className="group">
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleDone(goal.id)}
                aria-label={goal.done ? "Mark not done" : "Mark done"}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition ${
                  goal.done
                    ? "border-done bg-done text-cream"
                    : "border-ink/30 bg-transparent"
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
                className={`flex-1 font-sans text-sm ${
                  goal.done ? "text-ink/40 line-through" : "text-ink"
                }`}
              >
                {goal.title}
              </span>
              <span className="font-sans text-xs tabular-nums text-ink/40">
                {goal.progress}%
              </span>
              <button
                onClick={() => removeGoal(goal.id)}
                aria-label="Remove goal"
                className="text-ink/25 opacity-0 transition group-hover:opacity-100 hover:text-ink/60"
              >
                ×
              </button>
            </div>

            {/* Thin progress bar — click/drag to set progress. */}
            <input
              type="range"
              min={0}
              max={100}
              value={goal.progress}
              onChange={(e) => setProgress(goal.id, Number(e.target.value))}
              className="goal-range mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full"
              style={{
                background: `linear-gradient(to right, ${
                  goal.done ? "#1D9E75" : "#D4A853"
                } ${goal.progress}%, rgba(28,28,30,0.1) ${goal.progress}%)`,
              }}
            />
          </li>
        ))}
      </ul>

      <form onSubmit={addGoal} className="mt-4 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a goal…"
          className="flex-1 border-b border-ink/15 bg-transparent pb-1 font-sans text-sm text-ink placeholder:text-ink/30 focus:border-gold focus:outline-none"
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
