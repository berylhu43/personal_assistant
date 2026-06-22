import { select, selectOne, execute, uid } from "./db";
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

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Open commitments dated through tomorrow only (overdue + today + tomorrow), so
 * a multi-day plan doesn't flood the panel. Date-ascending.
 */
export async function listThroughTomorrow(userId: string): Promise<Commitment[]> {
  const rows = await select<CommitmentRow>(
    `SELECT * FROM calendar WHERE user_id = ?1 AND done = 0 AND date <= ?2
     ORDER BY date ASC, COALESCE(time, '99:99') ASC LIMIT 50`,
    [userId, tomorrowStr()]
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
}): Promise<string> {
  // Dedupe on title + date (case/whitespace-insensitive title).
  const existing = await selectOne<{ id: string }>(
    `SELECT id FROM calendar
     WHERE user_id = ?1 AND lower(trim(title)) = lower(trim(?2)) AND date = ?3 LIMIT 1`,
    [input.userId, input.title, input.date]
  );
  if (existing) return existing.id;

  const id = uid();
  await execute(
    `INSERT INTO calendar (id, user_id, title, date, time, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    [id, input.userId, input.title, input.date, input.time ?? null, input.source ?? "chat"]
  );
  return id;
}

export async function setCommitmentDone(id: string, done: boolean): Promise<void> {
  await execute(`UPDATE calendar SET done = ?1 WHERE id = ?2`, [done ? 1 : 0, id]);
}

export async function deleteCommitment(id: string): Promise<void> {
  await execute(`DELETE FROM calendar WHERE id = ?1`, [id]);
}
