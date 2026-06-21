import { select, execute } from "./db";
import {
  getLocalUserId,
  isDataConsolidated,
  setDataConsolidated,
} from "./store";
import { dedupeMemories, purgeRelativeTimeMemories } from "./memory";
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
  return localId;
}
