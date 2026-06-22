import { select, execute, uid } from "./db";
import type { Goal, GoalRow, WeeklyPlanItem } from "./types";

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
      input.title,
      input.plan ? JSON.stringify(input.plan) : null,
      input.targetDate ?? null,
    ]
  );
  return id;
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
