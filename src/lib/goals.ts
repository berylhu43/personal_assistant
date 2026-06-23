import { select, selectOne, execute, uid, stripEmoji } from "./db";
import type { Goal, GoalRow, WeeklyPlanItem } from "./types";

/**
 * Normalize a title for dedup: drop emoji, lowercase, drop straight & curly
 * quotes, collapse whitespace, and strip surrounding punctuation.
 */
export function normTitle(t: string): string {
  return stripEmoji(t)
    .toLowerCase()
    .replace(/[“”‘’„‟'"`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function rowToGoal(r: GoalRow): Goal {
  let plan: WeeklyPlanItem[] | null = null;
  if (r.plan) {
    try {
      plan = JSON.parse(r.plan);
    } catch {
      plan = null;
    }
  }
  return {
    id: r.id,
    title: r.title,
    progress: r.progress,
    done: r.done === 1,
    plan,
    targetDate: r.target_date,
    taskTotal: r.task_total,
    granularity: r.granularity === "weekly" ? "weekly" : "daily",
    createdAt: r.created_at,
  };
}

export async function listGoals(userId: string): Promise<Goal[]> {
  const rows = await select<GoalRow>(
    `SELECT * FROM goals WHERE user_id = ?1 ORDER BY done ASC, created_at DESC`,
    [userId]
  );
  return rows.map(rowToGoal);
}

export async function getGoalById(id: string): Promise<Goal | null> {
  const row = await selectOne<GoalRow>(`SELECT * FROM goals WHERE id = ?1`, [id]);
  return row ? rowToGoal(row) : null;
}

export async function createGoal(input: {
  userId: string;
  title: string;
  plan?: WeeklyPlanItem[] | null;
  targetDate?: string | null;
}): Promise<string> {
  const id = uid();
  await execute(
    `INSERT INTO goals (id, user_id, title, plan, target_date) VALUES (?1, ?2, ?3, ?4, ?5)`,
    [
      id,
      input.userId,
      stripEmoji(input.title),
      input.plan ? JSON.stringify(input.plan) : null,
      input.targetDate ?? null,
    ]
  );
  return id;
}

/**
 * Idempotent goal upsert keyed on the NORMALIZED title. If an existing goal
 * matches, merge in the new plan/target_date (preferring incoming non-null
 * values) instead of inserting a duplicate. Otherwise insert.
 */
export async function saveGoal(input: {
  userId: string;
  title: string;
  plan?: WeeklyPlanItem[] | null;
  targetDate?: string | null;
}): Promise<string> {
  const norm = normTitle(input.title);
  const existing = (await listGoals(input.userId)).find(
    (g) => normTitle(g.title) === norm
  );

  if (existing) {
    const plan = input.plan ?? existing.plan;
    const targetDate = input.targetDate ?? existing.targetDate;
    await execute(`UPDATE goals SET plan = ?1, target_date = ?2 WHERE id = ?3`, [
      plan ? JSON.stringify(plan) : null,
      targetDate ?? null,
      existing.id,
    ]);
    return existing.id;
  }

  // New goal. Daily tasks (if any) are model-planned and linked by the caller
  // (applyActions), which also sets task_total via setGoalTaskTotal.
  return createGoal(input);
}

/** Set how many linked tasks a goal has (drives read-only progress). */
export async function setGoalTaskTotal(
  goalId: string,
  n: number
): Promise<void> {
  await execute(`UPDATE goals SET task_total = ?1 WHERE id = ?2`, [n, goalId]);
}

/** Set whether a goal's linked tasks are daily or weekly. */
export async function setGoalGranularity(
  goalId: string,
  granularity: "daily" | "weekly"
): Promise<void> {
  await execute(`UPDATE goals SET granularity = ?1 WHERE id = ?2`, [
    granularity,
    goalId,
  ]);
}

/**
 * Recompute a goal's progress from its completed linked daily tasks.
 * No-op for goals without linked tasks (task_total = 0).
 */
export async function recomputeGoalProgress(goalId: string): Promise<void> {
  const goal = await selectOne<{ task_total: number }>(
    `SELECT task_total FROM goals WHERE id = ?1`,
    [goalId]
  );
  if (!goal || goal.task_total <= 0) return;

  const row = await selectOne<{ c: number }>(
    `SELECT count(*) AS c FROM calendar WHERE goal_id = ?1 AND done = 1`,
    [goalId]
  );
  const done = row?.c ?? 0;
  const progress = Math.max(
    0,
    Math.min(100, Math.round((done / goal.task_total) * 100))
  );
  await execute(`UPDATE goals SET progress = ?1, done = ?2 WHERE id = ?3`, [
    progress,
    progress >= 100 ? 1 : 0,
    goalId,
  ]);
}

/**
 * Persist a goal's plan and derive its progress from completed plan items
 * (so checking off a sub-task moves the bar). Marks the goal done at 100%.
 */
export async function setGoalPlan(
  id: string,
  plan: WeeklyPlanItem[]
): Promise<void> {
  const total = plan.length;
  const completed = plan.filter((p) => p.done).length;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  await execute(
    `UPDATE goals SET plan = ?1, progress = ?2, done = ?3 WHERE id = ?4`,
    [JSON.stringify(plan), progress, progress >= 100 ? 1 : 0, id]
  );
}

export async function setGoalProgress(id: string, progress: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  await execute(`UPDATE goals SET progress = ?1, done = ?2 WHERE id = ?3`, [
    clamped,
    clamped >= 100 ? 1 : 0,
    id,
  ]);
}

export async function setGoalDone(id: string, done: boolean): Promise<void> {
  await execute(`UPDATE goals SET done = ?1, progress = ?2 WHERE id = ?3`, [
    done ? 1 : 0,
    done ? 100 : 0,
    id,
  ]);
}

export async function deleteGoal(id: string): Promise<void> {
  await execute(`DELETE FROM goals WHERE id = ?1`, [id]);
}
