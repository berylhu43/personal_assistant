import { select, selectOne, execute, uid } from "./db";
import type { Memory, MemoryRow, MemoryKind } from "./types";

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
