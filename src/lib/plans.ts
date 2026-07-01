import { selectOne, execute, uid } from "./db";
import { listByGoal, updateCommitment } from "./localCalendar";
import type { PlanRow, PlanDay } from "./types";

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

/** Remove all plan documents for a goal — used when regenerating its plan. */
export async function deletePlansByGoal(goalId: string): Promise<void> {
  await execute(`DELETE FROM plans WHERE goal_id = ?1`, [goalId]);
}

/** Rewrite a plan document's content (e.g. after editing a day in-place). */
export async function updatePlanContent(
  id: string,
  content: string
): Promise<void> {
  await execute(`UPDATE plans SET content = ?1 WHERE id = ?2`, [content, id]);
}

/**
 * Edit one day of a goal's plan document IN PLACE and keep the linked daily task
 * (commitment, joined by date) in sync — used by BOTH the goal-side editor and
 * the task-side editor so they behave identically. `origDate` locates the day to
 * replace (the date may change). Returns the updated, date-sorted day list so
 * callers can refresh their cache.
 */
export async function savePlanDay(
  goalId: string,
  origDate: string,
  newDay: PlanDay
): Promise<PlanDay[]> {
  const row = await getPlanByGoal(goalId);
  if (!row) return [];
  let days: PlanDay[] = [];
  try {
    const parsed = JSON.parse(row.content);
    days = Array.isArray(parsed) ? parsed : [];
  } catch {
    days = [];
  }
  const idx = days.findIndex((d) => d.date === origDate);
  if (idx >= 0) days[idx] = newDay;
  else days.push(newDay);
  days.sort((a, b) => a.date.localeCompare(b.date));
  await updatePlanContent(row.id, JSON.stringify(days));

  // Sync the linked daily task (matched by the OLD date): title from the new
  // topic/task, and the new date.
  const tasks = await listByGoal(goalId);
  const c = tasks.find((t) => t.date === origDate);
  if (c) {
    const title = (newDay.topic || newDay.task || c.title).slice(0, 120);
    await updateCommitment(c.id, { title, date: newDay.date });
  }
  return days;
}
