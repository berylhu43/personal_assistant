import { select } from "./db";
import { getActiveAdapter, LLMParseError } from "./llm";
import { addMemory, listMemories } from "./memory";
import { saveGoal, listGoals } from "./goals";
import { createCommitment, listUpcoming } from "./localCalendar";
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
- Omit anything uncertain or already obvious. Empty arrays are fine.
- Titles must be PLAIN TEXT — never include emoji, icons, or decorative symbols.

Reconciliation — IMPORTANT:
- You will be given the items ALREADY SAVED for this user (goals, commitments, memories). Output ONLY genuinely new items that are not already represented — even if you would phrase them differently.
- If something in the transcript is already captured by an existing goal/commitment/memory (the same underlying thing, regardless of wording or exact date), OMIT it.
- When unsure whether two refer to the same thing, treat them as the same and OMIT.`;

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

  // Load current state so the model reconciles against what already exists
  // (including items created live during this very conversation).
  const [openGoals, commitments, memories] = await Promise.all([
    listGoals(userId)
      .then((gs) => gs.filter((g) => !g.done))
      .catch(() => []),
    listUpcoming(userId).catch(() => []),
    listMemories(userId).catch(() => []),
  ]);

  const alreadySaved = `ALREADY SAVED (do NOT re-create anything represented here):
Goals:
${openGoals.length ? openGoals.map((g) => `  - ${g.title}${g.targetDate ? ` (by ${g.targetDate})` : ""}`).join("\n") : "  (none)"}
Commitments:
${commitments.length ? commitments.map((c) => `  - ${c.date}${c.time ? ` ${c.time}` : ""} — ${c.title}`).join("\n") : "  (none)"}
Memories:
${memories.length ? memories.map((m) => `  - ${m.content}`).join("\n") : "  (none)"}`;

  const transcript = rows.map((r) => `${r.role}: ${r.content}`).join("\n");
  const today = todayStr();
  const userMsg = `Today's date is ${today}.

${alreadySaved}

Conversation transcript:
${transcript}

Distill ONLY genuinely new items into the JSON structure now.`;

  let parsed: any;
  try {
    const { adapter, config } = await getActiveAdapter();
    parsed = await adapter.completeJSON<any>(
      {
        system: DISTILL_SYSTEM,
        messages: [{ role: "user", content: userMsg }],
        maxTokens: 1024,
      },
      config
    );
  } catch (e) {
    // Unparseable output → nothing structured to write (empty distillation).
    // Network/API failures propagate so the caller keeps the transcript & retries.
    if (e instanceof LLMParseError) return;
    throw e;
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

  // goals — saveGoal upserts by normalized title (backstop); persist an
  // absolute target date if given.
  for (const g of parsed.goals ?? []) {
    if (g?.title) {
      const targetDate =
        typeof g.targetDate === "string" && DATE_RE.test(g.targetDate)
          ? g.targetDate
          : null;
      await saveGoal({ userId, title: String(g.title), targetDate });
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
