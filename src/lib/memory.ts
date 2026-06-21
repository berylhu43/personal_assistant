import { select, selectOne, execute, uid } from "./db";
import {
  isRelativeMemoriesPurged,
  setRelativeMemoriesPurged,
} from "./store";
import type { Memory, MemoryRow, MemoryKind } from "./types";

// Relative-time words that indicate a memory was a transient event/appointment
// rather than a durable fact. Used by the one-time cleanup below.
const RELATIVE_TIME_WORDS = [
  "tomorrow",
  "today",
  "tonight",
  "yesterday",
  "this weekend",
  "next weekend",
  "this week",
  "next week",
  "this month",
  "next month",
  "明天", // tomorrow
  "今天", // today
  "昨天", // yesterday
  "后天", // day after tomorrow
  "今晚", // tonight
  "这周", // this week
  "本周", // this week
  "下周", // next week
  "周末", // weekend
];

// Cap how many memories feed the system prompt so it stays bounded as memory
// grows; newest first.
const MEMORY_LIMIT = 100;

export async function listMemories(userId: string): Promise<Memory[]> {
  const rows = await select<MemoryRow>(
    `SELECT * FROM memories WHERE user_id = ?1
     ORDER BY created_at DESC, rowid DESC LIMIT ?2`,
    [userId, MEMORY_LIMIT]
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as MemoryKind,
    content: r.content,
    source: r.source,
    createdAt: r.created_at,
  }));
}

export async function addMemory(input: {
  userId: string;
  kind: MemoryKind;
  content: string;
  source?: string;
}): Promise<void> {
  // Skip if an identical memory (case/whitespace-insensitive) already exists.
  const existing = await selectOne<{ one: number }>(
    `SELECT 1 AS one FROM memories
     WHERE user_id = ?1 AND lower(trim(content)) = lower(trim(?2)) LIMIT 1`,
    [input.userId, input.content]
  );
  if (existing) return;

  await execute(
    `INSERT INTO memories (id, user_id, kind, content, source) VALUES (?1, ?2, ?3, ?4, ?5)`,
    [uid(), input.userId, input.kind, input.content, input.source ?? "chat"]
  );
}

/**
 * One-time cleanup of stale, time-relative memories (e.g. "meeting tomorrow")
 * that should never have been stored as durable facts. Guarded by a store flag
 * so it runs at most once. Durable preferences are untouched.
 */
export async function purgeRelativeTimeMemories(userId: string): Promise<void> {
  if (await isRelativeMemoriesPurged()) return;

  // ?1 = userId; ?2..?N = LIKE patterns for each relative-time word.
  const clauses = RELATIVE_TIME_WORDS.map(
    (_, i) => `lower(content) LIKE ?${i + 2}`
  ).join(" OR ");
  const params = [
    userId,
    ...RELATIVE_TIME_WORDS.map((w) => `%${w.toLowerCase()}%`),
  ];
  await execute(
    `DELETE FROM memories WHERE user_id = ?1 AND (${clauses})`,
    params
  );

  await setRelativeMemoriesPurged();
}

/**
 * Remove duplicate memories for a user, keeping the earliest row per
 * normalized (lowercased, trimmed) content. Used by the one-time consolidation.
 */
export async function dedupeMemories(userId: string): Promise<void> {
  await execute(
    `DELETE FROM memories
     WHERE user_id = ?1
       AND rowid NOT IN (
         SELECT MIN(rowid) FROM memories
         WHERE user_id = ?1
         GROUP BY lower(trim(content))
       )`,
    [userId]
  );
}
