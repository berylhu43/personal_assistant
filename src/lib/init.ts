import { select, execute, stripEmoji } from "./db";
import {
  getLocalUserId,
  isDataConsolidated,
  setDataConsolidated,
  areTitlesCleaned,
  setTitlesCleaned,
  isProviderKeyMigrated,
  setProviderKeyMigrated,
} from "./store";
import { dedupeMemories, purgeRelativeTimeMemories } from "./memory";
import {
  migrateAnthropicKeyFromSettings,
  listProviders,
} from "./providers";
import { hasMessages, clearMessages } from "./chat";
import { distillConversation } from "./distill";
import type { GoogleTokensRow } from "./types";

/**
 * Guarantee a `users` row exists for the permanent local id. Idempotent.
 * Placeholder email/name are used until a Google sign-in fills in real labels.
 */
export async function ensureLocalUser(): Promise<string> {
  const localId = await getLocalUserId();
  await execute(
    `INSERT INTO users (id, email, name) VALUES (?1, 'local@assistant', NULL)
     ON CONFLICT(id) DO NOTHING`,
    [localId]
  );
  return localId;
}

/**
 * One-time consolidation: re-home any data that was previously keyed to a
 * Google-derived id onto the stable local id, dedupe memories, and clear out
 * stray user rows. Guarded by a flag so it only runs once.
 *
 * Safe on a single-user machine: every existing row really belongs to this
 * person, so orphaned rows are simply re-owned.
 */
async function consolidateData(localId: string): Promise<void> {
  // google_tokens: keep the most recent row, drop the rest, re-home to local id.
  const tokens = await select<GoogleTokensRow>(
    `SELECT * FROM google_tokens ORDER BY updated_at DESC`
  );
  if (tokens.length > 0) {
    const keep = tokens[0];
    await execute(`DELETE FROM google_tokens WHERE user_id != ?1`, [keep.user_id]);
    if (keep.user_id !== localId) {
      await execute(`UPDATE google_tokens SET user_id = ?1 WHERE user_id = ?2`, [
        localId,
        keep.user_id,
      ]);
    }
  }

  // Re-home all other tables onto the local id.
  for (const table of ["goals", "memories", "messages"]) {
    await execute(`UPDATE ${table} SET user_id = ?1 WHERE user_id != ?1`, [localId]);
  }
  // briefings has UNIQUE(user_id, date); ignore any row that would collide.
  await execute(
    `UPDATE OR IGNORE briefings SET user_id = ?1 WHERE user_id != ?1`,
    [localId]
  );

  await dedupeMemories(localId);

  // Remove any leftover user rows other than the local id (data already moved).
  await execute(`DELETE FROM users WHERE id != ?1`, [localId]);
}

/**
 * App startup entry point: ensure the local user exists, run the one-time
 * consolidation if needed, and return the local id. Call once before any data
 * access.
 */
export async function initApp(): Promise<string> {
  const localId = await ensureLocalUser();
  if (!(await isDataConsolidated())) {
    await consolidateData(localId);
    await setDataConsolidated();
  }
  // One-time purge of stale time-relative memories (self-guarded).
  await purgeRelativeTimeMemories(localId);

  // One-time copy of the legacy settings.json Anthropic key into llm_providers.
  // Gated by a flag so it runs once; the copy itself is also non-destructive.
  if (!(await isProviderKeyMigrated())) {
    const { copied } = await migrateAnthropicKeyFromSettings();
    await setProviderKeyMigrated();
    // TEMP verification (remove next step): confirm the migration's outcome.
    const providers = await listProviders();
    const activeCount = providers.filter((p) => p.is_active === 1).length;
    console.log("[providers] one-time migration:", {
      anthropicKeyCopied: copied,
      rowCount: providers.length,
      activeCount, // should be 1 if a key was found, else 0
      activeId: providers.find((p) => p.is_active === 1)?.id ?? null,
    });
  }

  // One-time strip of emoji/icons from existing goal & task titles.
  if (!(await areTitlesCleaned())) {
    for (const table of ["goals", "calendar"]) {
      const rows = await select<{ id: string; title: string }>(
        `SELECT id, title FROM ${table} WHERE user_id = ?1`,
        [localId]
      );
      for (const r of rows) {
        const clean = stripEmoji(r.title);
        if (clean !== r.title) {
          await execute(`UPDATE ${table} SET title = ?1 WHERE id = ?2`, [
            clean,
            r.id,
          ]);
        }
      }
    }
    await setTitlesCleaned();
  }

  // A non-empty messages table at launch means a previous session was quit
  // without closing. Distill it, then clear. Best-effort: if distillation
  // fails (e.g. no API key yet), keep the rows and retry on the next launch.
  if (await hasMessages(localId)) {
    try {
      await distillConversation(localId);
      await clearMessages(localId);
    } catch {
      /* keep the transcript; retry next launch */
    }
  }

  return localId;
}
