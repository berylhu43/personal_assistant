import { useEffect, useState } from "react";
import {
  listCompletedGoals,
  listDiscardedGoals,
  setGoalDone,
  setGoalDiscarded,
  deleteGoal,
} from "../lib/goals";
import {
  listCompletedTasks,
  listDiscardedTasks,
  setCommitmentDone,
  setCommitmentDiscarded,
  setTasksDoneByGoal,
  setTasksDiscardedByGoal,
  deleteCommitment,
} from "../lib/localCalendar";
import LinkifiedText from "./LinkifiedText";
import type { Goal, Commitment } from "../lib/types";

/** "2026-07-01" → "Jul 1". */
function fmt(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function goalRange(g: Goal): string | null {
  if (g.startDate && g.targetDate) return `${fmt(g.startDate)}–${fmt(g.targetDate)}`;
  if (g.targetDate) return fmt(g.targetDate);
  if (g.startDate) return `from ${fmt(g.startDate)}`;
  return null;
}

export default function Archive({
  userId,
  onClose,
  onRestored,
}: {
  userId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Commitment[]>([]);
  const [discardedGoals, setDiscardedGoals] = useState<Goal[]>([]);
  const [discardedTasks, setDiscardedTasks] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  // Two-step delete: holds the id awaiting confirmation.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [g, t, dg, dt] = await Promise.all([
      listCompletedGoals(userId).catch(() => [] as Goal[]),
      listCompletedTasks(userId).catch(() => [] as Commitment[]),
      listDiscardedGoals(userId).catch(() => [] as Goal[]),
      listDiscardedTasks(userId).catch(() => [] as Commitment[]),
    ]);
    setGoals(g);
    setTasks(t);
    setDiscardedGoals(dg);
    setDiscardedTasks(dt);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Restoring a goal undoes the completion cascade: the goal AND its linked
  // tasks return to the active lists (see completion mechanics in GoalTracker).
  async function restoreGoal(g: Goal) {
    await setGoalDone(g.id, false);
    await setTasksDoneByGoal(g.id, false);
    onRestored();
    await load();
  }

  // Restoring a task sets done = 0 (and recomputes its goal's progress, so a
  // completed goal it belonged to also returns to active).
  async function restoreTask(c: Commitment) {
    await setCommitmentDone(c.id, false);
    onRestored();
    await load();
  }

  // Un-discard a goal (× → restore): the goal AND its linked tasks return to the
  // active lists, with whatever done/progress state they had before discarding.
  async function undiscardGoal(g: Goal) {
    await setGoalDiscarded(g.id, false);
    await setTasksDiscardedByGoal(g.id, false);
    onRestored();
    await load();
  }

  // Un-discard a task: it returns to the active lists (and its goal's progress
  // is recomputed inside setCommitmentDiscarded).
  async function undiscardTask(c: Commitment) {
    await setCommitmentDiscarded(c.id, false);
    onRestored();
    await load();
  }

  async function removeGoal(id: string) {
    await deleteGoal(id);
    setConfirmId(null);
    onRestored();
    await load();
  }

  async function removeTask(id: string) {
    await deleteCommitment(id);
    setConfirmId(null);
    onRestored();
    await load();
  }

  const restoreBtn =
    "rounded-full bg-ink px-3 py-1 font-sans text-[11px] font-medium text-cream transition hover:bg-gold-deep";
  const deleteBtn =
    "font-mono text-[10px] uppercase tracking-wide text-ink/35 transition hover:text-red-700";

  function DeleteControl({ id, onDelete }: { id: string; onDelete: () => void }) {
    if (confirmId === id) {
      return (
        <span className="flex items-center gap-2">
          <span className="font-sans text-[11px] text-red-700">Delete forever?</span>
          <button onClick={onDelete} className="font-mono text-[10px] uppercase tracking-wide text-red-700 hover:underline">
            Delete
          </button>
          <button
            onClick={() => setConfirmId(null)}
            className="font-mono text-[10px] uppercase tracking-wide text-ink/40 hover:text-ink"
          >
            Cancel
          </button>
        </span>
      );
    }
    return (
      <button onClick={() => setConfirmId(id)} className={deleteBtn}>
        Delete
      </button>
    );
  }

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 px-6"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ backgroundColor: "#FBF7EF" }}
        className="no-drag rise max-h-[85vh] w-full max-w-md overflow-y-auto slim-scroll rounded-2xl border border-ink/15 p-6 shadow-lift"
      >
        <div className="flex items-baseline justify-between">
          <div>
            <span className="eyebrow">Archive</span>
            <h3 className="mt-1 font-serif text-2xl text-ink">Completed</h3>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink/40">
            Newest first (by creation)
          </span>
        </div>
        <p className="mt-1.5 font-sans text-xs leading-relaxed text-ink/55">
          Finished goals and tasks are kept here. Restore one to return it to your
          active lists.
        </p>

        {loading ? (
          <p className="mt-6 font-sans text-[13px] italic text-ink/35">Loading…</p>
        ) : (
          <>
            {/* ---- Goals ---- */}
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-gold" />
                <span className="eyebrow">Goals</span>
              </div>
              {goals.length === 0 ? (
                <p className="font-sans text-[12px] italic text-ink/35">
                  No completed goals yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {goals.map((g) => {
                    const range = goalRange(g);
                    return (
                      <li
                        key={g.id}
                        className="rounded-xl border border-ink/10 bg-white/40 px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 font-sans text-sm text-ink/55 line-through">
                            {g.title}
                          </span>
                          {range && (
                            <span className="shrink-0 font-mono text-[10px] text-ink/40">
                              {range}
                            </span>
                          )}
                        </div>
                        {g.note && g.note.trim() && (
                          <div className="mt-1 border-l border-gold/40 pl-2.5">
                            <LinkifiedText text={g.note} />
                          </div>
                        )}
                        {g.plan && g.plan.length > 0 && (
                          <ul className="mt-1 space-y-0.5 border-l border-gold/40 pl-2.5">
                            {g.plan.map((p) => (
                              <li
                                key={p.week}
                                className="font-sans text-[11px] leading-snug text-ink/55"
                              >
                                <span className="font-mono text-[10px] uppercase text-gold-deep">
                                  W{p.week}
                                </span>{" "}
                                {p.focus}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-2 flex items-center gap-3">
                          <button onClick={() => void restoreGoal(g)} className={restoreBtn}>
                            Restore
                          </button>
                          <DeleteControl id={g.id} onDelete={() => void removeGoal(g.id)} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* ---- Tasks ---- */}
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-gold" />
                <span className="eyebrow">Tasks</span>
              </div>
              {tasks.length === 0 ? (
                <p className="font-sans text-[12px] italic text-ink/35">
                  No completed tasks yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {tasks.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-xl border border-ink/10 bg-white/40 px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 font-sans text-sm text-ink/55 line-through">
                          {c.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-ink/40">
                          {fmt(c.date)}
                          {c.time ? ` · ${c.time}` : ""}
                        </span>
                      </div>
                      {c.note && c.note.trim() && (
                        <div className="mt-1 border-l border-gold/40 pl-2.5">
                          <LinkifiedText text={c.note} />
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-3">
                        <button onClick={() => void restoreTask(c)} className={restoreBtn}>
                          Restore
                        </button>
                        <DeleteControl id={c.id} onDelete={() => void removeTask(c.id)} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ---- Discarded (soft-deleted via ×) ---- */}
            {(discardedGoals.length > 0 || discardedTasks.length > 0) && (
              <div className="mt-8 border-t border-ink/10 pt-5">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-ink/30" />
                  <span className="eyebrow">Discarded</span>
                </div>
                <p className="mb-3 font-sans text-xs leading-relaxed text-ink/55">
                  Removed with ×. Restore to bring it back, or delete it forever.
                </p>

                {discardedGoals.length > 0 && (
                  <ul className="space-y-2.5">
                    {discardedGoals.map((g) => {
                      const range = goalRange(g);
                      return (
                        <li
                          key={g.id}
                          className="rounded-xl border border-ink/10 bg-white/40 px-3 py-2.5"
                        >
                          <div className="flex items-start gap-2">
                            <span className="min-w-0 flex-1 font-sans text-sm text-ink/55">
                              {g.title}
                            </span>
                            {range && (
                              <span className="shrink-0 font-mono text-[10px] text-ink/40">
                                {range}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex items-center gap-3">
                            <button
                              onClick={() => void undiscardGoal(g)}
                              className={restoreBtn}
                            >
                              Restore
                            </button>
                            <DeleteControl id={g.id} onDelete={() => void removeGoal(g.id)} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {discardedTasks.length > 0 && (
                  <ul className="mt-2.5 space-y-2.5">
                    {discardedTasks.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-xl border border-ink/10 bg-white/40 px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 font-sans text-sm text-ink/55">
                            {c.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-ink/40">
                            {fmt(c.date)}
                            {c.time ? ` · ${c.time}` : ""}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                          <button
                            onClick={() => void undiscardTask(c)}
                            className={restoreBtn}
                          >
                            Restore
                          </button>
                          <DeleteControl id={c.id} onDelete={() => void removeTask(c.id)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        <div className="mt-6 flex items-center justify-end">
          <button
            onClick={onClose}
            className="rounded-full bg-ink px-5 py-2 font-sans text-sm font-medium text-cream shadow-memo transition hover:bg-gold-deep"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
