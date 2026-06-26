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
    span: r.span === "week" ? "week" : r.span === "month" ? "month" : null,
    note: r.note ?? null,
    discarded: r.discarded === 1,
    createdAt: r.created_at,
  };
}

/**
 * Completed tasks for the Archive view, newest-first BY CREATION (no completion
 * timestamp exists). Served by the v12 (user_id, done, date) index.
 */
export async function listCompletedTasks(userId: string): Promise<Commitment[]> {
  // A task whose goal is also completed is represented by that goal in the
  // Archive's Completed Goals list — so exclude it here (show the whole goal, not
  // each sub-task). Tasks with no goal, or completed individually while the goal
  // is still active, still show.
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar WHERE user_id = ?1 AND done = 1 AND discarded = 0
       AND (goal_id IS NULL
            OR goal_id NOT IN (SELECT id FROM goals WHERE done = 1 AND discarded = 0))
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(rowToCommitment);
}

/**
 * Soft-deleted tasks for the Archive's Discarded section, newest-first. Like
 * Completed: a task whose goal is also discarded is represented by that goal in
 * the Discarded Goals list, so it's excluded here (show the whole goal, not each
 * sub-task). Individually-discarded tasks (goal still active) still show.
 */
export async function listDiscardedTasks(userId: string): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar WHERE user_id = ?1 AND discarded = 1
       AND (goal_id IS NULL
            OR goal_id NOT IN (SELECT id FROM goals WHERE discarded = 1))
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(rowToCommitment);
}

/** All (non-discarded) commitments linked to a goal, date-ascending. */
export async function listByGoal(goalId: string): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar WHERE goal_id = ?1 AND discarded = 0
     ORDER BY date ASC, COALESCE(time, '99:99') ASC`,
    [goalId]
  );
  return rows.map(rowToCommitment);
}

/** Open commitments, soonest first (overdue ones surface at the top). */
export async function listUpcoming(userId: string): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar WHERE user_id = ?1 AND done = 0 AND discarded = 0
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
 * The coming Sunday — end of the current Mon–Sun week (matching the weekly-goal
 * convention). If today is Sunday, returns today. Local-date math.
 */
function thisSundayStr(): string {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun … 6=Sat
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow));
  return dateStr(d);
}

/**
 * What the Upcoming panel lists. Date-ascending. Open tasks only.
 * - Daily / one-off (span IS NULL): overdue + today + tomorrow (date <= tomorrow).
 * - Weekly (span = 'week') / Monthly (span = 'month'): the period containing
 *   today, plus overdue past periods. A period task's date is its start (the
 *   Monday for a week, the 1st for a month), so date <= today covers
 *   current+overdue while excluding future periods.
 */
export async function listThroughTomorrow(userId: string): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar
     WHERE user_id = ?1 AND done = 0 AND discarded = 0 AND (
       ((COALESCE(span, '') NOT IN ('week', 'month')) AND date <= ?2) OR
       (span IN ('week', 'month') AND date <= ?3)
     )
     ORDER BY date ASC, COALESCE(time, '99:99') ASC LIMIT 50`,
    [userId, tomorrowStr(), todayStr()]
  );
  return rows.map(rowToCommitment);
}

/**
 * Single commitments (source != 'goal' — chat / manual / email) due later this
 * week: from the day AFTER tomorrow through the coming Sunday, so a one-off due
 * Thursday surfaces on Tuesday instead of staying hidden until the day before.
 * Excludes plan daily tasks (source = 'goal') so long plans don't flood the
 * list, and excludes today/tomorrow (already shown in the main group).
 */
export async function listLaterThisWeek(userId: string): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar
     WHERE user_id = ?1 AND done = 0 AND discarded = 0 AND COALESCE(source, '') != 'goal'
       AND date > ?2 AND date <= ?3
     ORDER BY date ASC, COALESCE(time, '99:99') ASC LIMIT 50`,
    [userId, tomorrowStr(), thisSundayStr()]
  );
  return rows.map(rowToCommitment);
}

/**
 * Single commitments (source != 'goal') due from tomorrow through the coming
 * Sunday — used by the briefing to proactively flag things due soon. Plan daily
 * tasks are excluded so the briefing isn't spammed with "AI Agents Day 5/6".
 */
export async function listSingleUpcomingThisWeek(
  userId: string
): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar
     WHERE user_id = ?1 AND done = 0 AND discarded = 0 AND COALESCE(source, '') != 'goal'
       AND date > ?2 AND date <= ?3
     ORDER BY date ASC, COALESCE(time, '99:99') ASC LIMIT 50`,
    [userId, todayStr(), thisSundayStr()]
  );
  return rows.map(rowToCommitment);
}

/** Open commitments due on or before `onDate` — used by the briefing. */
export async function listTodayAndOverdue(
  userId: string,
  onDate: string
): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar WHERE user_id = ?1 AND done = 0 AND discarded = 0 AND date <= ?2
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
  span?: "week" | "month" | null;
  note?: string | null;
}): Promise<string> {
  const title = stripEmoji(input.title);
  // Dedupe on title + date (case/whitespace-insensitive title).
  const existing = await selectOne<{ id: string; goal_id: string | null }>(
    `SELECT id, goal_id FROM calendar
     WHERE user_id = ?1 AND lower(trim(title)) = lower(trim(?2)) AND date = ?3
       AND discarded = 0 LIMIT 1`,
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
    `INSERT INTO calendar (id, user_id, title, date, time, source, goal_id, span, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    [
      id,
      input.userId,
      title,
      input.date,
      input.time ?? null,
      input.source ?? "chat",
      input.goalId ?? null,
      input.span ?? null,
      input.note?.trim() ? input.note.trim() : null,
    ]
  );
  return id;
}

/**
 * Edit a task's title, date, time, and/or detail note. Only provided fields are
 * changed (undefined = leave as-is; null/empty clears time or note).
 */
export async function updateCommitment(
  id: string,
  fields: {
    title?: string;
    date?: string;
    time?: string | null;
    note?: string | null;
  }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (fields.title !== undefined) {
    sets.push(`title = ?${i++}`);
    params.push(stripEmoji(fields.title));
  }
  if (fields.date !== undefined) {
    sets.push(`date = ?${i++}`);
    params.push(fields.date);
  }
  if (fields.time !== undefined) {
    sets.push(`time = ?${i++}`);
    params.push(fields.time || null);
  }
  if (fields.note !== undefined) {
    sets.push(`note = ?${i++}`);
    params.push(fields.note?.trim() ? fields.note.trim() : null);
  }
  if (sets.length === 0) return;
  params.push(id);
  await execute(`UPDATE calendar SET ${sets.join(", ")} WHERE id = ?${i}`, params);
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

/** Soft-delete / restore a task (× → discarded; Archive restore → active). */
export async function setCommitmentDiscarded(
  id: string,
  discarded: boolean
): Promise<void> {
  await execute(`UPDATE calendar SET discarded = ?1 WHERE id = ?2`, [
    discarded ? 1 : 0,
    id,
  ]);
  // Recompute the linked goal's progress (a discarded task drops out of it).
  const row = await selectOne<{ goal_id: string | null }>(
    `SELECT goal_id FROM calendar WHERE id = ?1`,
    [id]
  );
  if (row?.goal_id) {
    await recomputeGoalProgress(row.goal_id);
  }
}

/** Mark every task linked to a goal done/undone (when the goal itself is). */
export async function setTasksDoneByGoal(
  goalId: string,
  done: boolean
): Promise<void> {
  await execute(`UPDATE calendar SET done = ?1 WHERE goal_id = ?2`, [
    done ? 1 : 0,
    goalId,
  ]);
}

/**
 * Soft-delete / restore every task linked to a goal — used when the goal itself
 * is discarded/restored, so its plan tasks travel with it (out of the active
 * lists into Archive → Discarded, and back).
 */
export async function setTasksDiscardedByGoal(
  goalId: string,
  discarded: boolean
): Promise<void> {
  await execute(`UPDATE calendar SET discarded = ?1 WHERE goal_id = ?2`, [
    discarded ? 1 : 0,
    goalId,
  ]);
}
