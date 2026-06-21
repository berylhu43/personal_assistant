import { select, selectOne } from "./db";
import { chat } from "./anthropic";
import { addMemory } from "./memory";
import { createGoal } from "./goals";
import { createCommitment } from "./localCalendar";
import { todayStr } from "./briefing";
import type { MessageRow, MemoryKind } from "./types";

const VALID_KINDS: MemoryKind[] = ["fact", "preference", "goal_note"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeKind(k: unknown): MemoryKind {
  return VALID_KINDS.includes(k as MemoryKind) ? (k as MemoryKind) : "fact";
}

const DISTILL_SYSTEM = `You distill a finished conversation into durable, structured records for a personal assistant. Extract ONLY information worth keeping long-term, under strict boundary rules.

Return ONLY JSON of this exact shape (no prose):
{
  "memories": [ { "kind": "fact" | "preference" | "goal_note", "content": "..." } ],
  "goals": [ { "title": "...", "targetDate": "YYYY-MM-DD" } ],
  "commitments": [ { "title": "...", "date": "YYYY-MM-DD", "time": "HH:mm" } ]
}

Boundary rules:
- memories: durable, time-stable facts / preferences / habits ONLY (e.g. "prefers morning meetings", "is learning AI agents", "allergic to nuts"). NEVER events, appointments, or anything phrased relative to time.
- goals: objectives or projects the user expressed (an aim to accomplish). "targetDate" is optional.
- commitments: discrete dated things the user committed to (e.g. "dentist Friday", "submit report Monday"). "time" is optional.
- Resolve ALL relative time ("tomorrow", "this Friday", "next week") to ABSOLUTE calendar dates using the provided today's date. Never store a relative word.
- Omit anything uncertain or already obvious. Empty arrays are fine.`;

function tryParse(raw: string): any {
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw);
}

async function goalExists(userId: string, title: string): Promise<boolean> {
  const row = await selectOne<{ id: string }>(
    `SELECT id FROM goals WHERE user_id = ?1 AND lower(trim(title)) = lower(trim(?2)) LIMIT 1`,
    [userId, title]
  );
  return !!row;
}

/**
 * Read the current session's messages, make ONE model call to extract durable
 * info, and write it to the memory / goal / local-calendar stores (deduping).
 * Throws if the model call fails so callers can retry / keep the transcript.
 */
export async function distillConversation(userId: string): Promise<void> {
  const rows = await select<MessageRow>(
    `SELECT * FROM messages WHERE user_id = ?1 ORDER BY created_at ASC, rowid ASC`,
    [userId]
  );
  if (rows.length === 0) return;

  const transcript = rows.map((r) => `${r.role}: ${r.content}`).join("\n");
  const today = todayStr();
  const userMsg = `Today's date is ${today}.

Conversation transcript:
${transcript}

Distill it into the JSON structure now.`;

  const raw = await chat([{ role: "user", content: userMsg }], DISTILL_SYSTEM, 1024);

  let parsed: any;
  try {
    parsed = tryParse(raw);
  } catch {
    // Nothing structured to write — treat as an empty distillation.
    return;
  }

  // memories — addMemory already dedupes on existing content.
  for (const m of parsed.memories ?? []) {
    if (m?.content) {
      await addMemory({
        userId,
        kind: normalizeKind(m.kind),
        content: String(m.content),
        source: "distill",
      });
    }
  }

  // goals — dedupe on title.
  for (const g of parsed.goals ?? []) {
    if (g?.title && !(await goalExists(userId, String(g.title)))) {
      await createGoal({ userId, title: String(g.title) });
    }
  }

  // commitments — createCommitment dedupes on title+date; require an absolute date.
  for (const c of parsed.commitments ?? []) {
    if (c?.title && typeof c.date === "string" && DATE_RE.test(c.date)) {
      await createCommitment({
        userId,
        title: String(c.title),
        date: c.date,
        time: typeof c.time === "string" && /^\d{2}:\d{2}$/.test(c.time) ? c.time : null,
        source: "chat",
      });
    }
  }
}
