import { select, selectOne, execute, uid, stripEmoji } from "./db";
import { recomputeGoalProgress } from "./goals";
import type { Commitment, CommitmentRow } from "./types";

// Local calendar: discrete timed commitments that stay on this machine and are
// NEVER synced to Google Calendar (that's google.ts). Source is 'chat' for now.

function rowToCommitment(r: CommitmentRow): Commitment {
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    time: r.time,
    done: r.done === 1,
    source: r.source,
    goalId: r.goal_id,
    span: r.span === "week" ? "week" : null,
    createdAt: r.created_at,
  };
}

/** Open commitments, soonest first (overdue ones surface at the top). */
export async function listUpcoming(userId: string): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar WHERE user_id = ?1 AND done = 0
     ORDER BY date ASC, COALESCE(time, '99:99') ASC LIMIT 50`,
    [userId]
  );
  return rows.map(rowToCommitment);
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function todayStr(): string {
  return dateStr(new Date());
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateStr(d);
}

/**
 * What the Upcoming panel lists. Date-ascending. Open tasks only.
 * - Daily / one-off (span IS NULL): overdue + today + tomorrow (date <= tomorrow).
 * - Weekly (span = 'week'): the week containing today, plus overdue past weeks
 *   (a weekly task's date is its Monday, so date <= today covers current+overdue
 *   while excluding future weeks).
 */
export async function listThroughTomorrow(userId: string): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar
     WHERE user_id = ?1 AND done = 0 AND (
       (COALESCE(span, '') != 'week' AND date <= ?2) OR
       (span = 'week' AND date <= ?3)
     )
     ORDER BY date ASC, COALESCE(time, '99:99') ASC LIMIT 50`,
    [userId, tomorrowStr(), todayStr()]
  );
  return rows.map(rowToCommitment);
}

/** Open commitments due on or before `onDate` — used by the briefing. */
export async function listTodayAndOverdue(
  userId: string,
  onDate: string
): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar WHERE user_id = ?1 AND done = 0 AND date <= ?2
     ORDER BY date ASC, COALESCE(time, '99:99') ASC`,
    [userId, onDate]
  );
  return rows.map(rowToCommitment);
}

export async function createCommitment(input: {
  userId: string;
  title: string;
  date: string;
  time?: string | null;
  source?: string;
  goalId?: string | null;
  span?: "week" | null;
}): Promise<string> {
  const title = stripEmoji(input.title);
  // Dedupe on title + date (case/whitespace-insensitive title).
  const existing = await selectOne<{ id: string; goal_id: string | null }>(
    `SELECT id, goal_id FROM calendar
     WHERE user_id = ?1 AND lower(trim(title)) = lower(trim(?2)) AND date = ?3 LIMIT 1`,
    [input.userId, title, input.date]
  );
  if (existing) {
    // Backfill the goal link if the existing row isn't linked yet.
    if (input.goalId && !existing.goal_id) {
      await execute(`UPDATE calendar SET goal_id = ?1 WHERE id = ?2`, [
        input.goalId,
        existing.id,
      ]);
    }
    return existing.id;
  }

  const id = uid();
  await execute(
    `INSERT INTO calendar (id, user_id, title, date, time, source, goal_id, span)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    [
      id,
      input.userId,
      title,
      input.date,
      input.time ?? null,
      input.source ?? "chat",
      input.goalId ?? null,
      input.span ?? null,
    ]
  );
  return id;
}

export async function setCommitmentDone(id: string, done: boolean): Promise<void> {
  await execute(`UPDATE calendar SET done = ?1 WHERE id = ?2`, [done ? 1 : 0, id]);
  // If this task is linked to a goal, recompute that goal's progress.
  const row = await selectOne<{ goal_id: string | null }>(
    `SELECT goal_id FROM calendar WHERE id = ?1`,
    [id]
  );
  if (row?.goal_id) {
    await recomputeGoalProgress(row.goal_id);
  }
}

export async function deleteCommitment(id: string): Promise<void> {
  await execute(`DELETE FROM calendar WHERE id = ?1`, [id]);
}
