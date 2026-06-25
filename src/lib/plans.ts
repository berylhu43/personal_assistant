import { selectOne, execute, uid } from "./db";
import type { PlanRow } from "./types";

// A "plan" is the full learning-plan document (day-by-day entries with
// resources/links) attached to a goal. The short daily tasks live in the
// calendar; this is the rich source document. UI for viewing is a later task.

export async function createPlan(input: {
  goalId: string;
  title: string;
  content: string; // JSON string of PlanDay[]
}): Promise<string> {
  const id = uid();
  await execute(
    `INSERT INTO plans (id, goal_id, title, content) VALUES (?1, ?2, ?3, ?4)`,
    [id, input.goalId, input.title, input.content]
  );
  return id;
}

export async function getPlanByGoal(goalId: string): Promise<PlanRow | null> {
  return selectOne<PlanRow>(
    `SELECT * FROM plans WHERE goal_id = ?1 ORDER BY created_at DESC LIMIT 1`,
    [goalId]
  );
}

/** Rewrite a plan document's content (e.g. after editing a day in-place). */
export async function updatePlanContent(
  id: string,
  content: string
): Promise<void> {
  await execute(`UPDATE plans SET content = ?1 WHERE id = ?2`, [content, id]);
}
