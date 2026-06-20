import { select, execute, uid } from "./db";
import type { Memory, MemoryRow, MemoryKind } from "./types";

export async function listMemories(userId: string): Promise<Memory[]> {
  const rows = await select<MemoryRow>(
    `SELECT * FROM memories WHERE user_id = ?1 ORDER BY created_at DESC`,
    [userId]
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
  await execute(
    `INSERT INTO memories (id, user_id, kind, content, source) VALUES (?1, ?2, ?3, ?4, ?5)`,
    [uid(), input.userId, input.kind, input.content, input.source ?? "chat"]
  );
}
