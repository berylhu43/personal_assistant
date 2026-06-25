import { select, selectOne, execute } from "./db";
import { getApiKey } from "./store";
import type { LlmProviderRow } from "./types";

// Data-layer access to the llm_providers table. NOTHING here is wired into the
// API-call layer or UI yet — that's a later step. The table + seed rows are
// created by SQL migration v9; the existing Anthropic key (in settings.json) is
// copied in by migrateAnthropicKeyFromSettings() at startup.

/** All providers (read-only helper, e.g. for verification). */
export async function listProviders(): Promise<LlmProviderRow[]> {
  return select<LlmProviderRow>(
    `SELECT * FROM llm_providers ORDER BY id`
  );
}

/** The single active provider (is_active = 1), or null if none is active. */
export async function getActiveProvider(): Promise<LlmProviderRow | null> {
  return selectOne<LlmProviderRow>(
    `SELECT * FROM llm_providers WHERE is_active = 1`
  );
}

/** A provider by id, or null if unknown. */
export async function getProvider(id: string): Promise<LlmProviderRow | null> {
  return selectOne<LlmProviderRow>(
    `SELECT * FROM llm_providers WHERE id = ?1`,
    [id]
  );
}

/** Set (or replace) a provider's API key. Stored locally; trimmed. */
export async function setProviderKey(id: string, key: string): Promise<void> {
  await execute(
    `UPDATE llm_providers SET api_key = ?2, updated_at = datetime('now') WHERE id = ?1`,
    [id, key.trim()]
  );
}

/**
 * Make `id` the active provider and EVERY other row inactive. This is a single
 * atomic UPDATE (one statement = one implicit transaction), so there is never a
 * moment with zero or two active rows — exactly one active provider globally.
 * Throws if the id is unknown (so we never zero out every row by accident).
 */
export async function setActiveProvider(id: string): Promise<void> {
  const exists = await getProvider(id);
  if (!exists) throw new Error(`Unknown provider: ${id}`);
  await execute(
    `UPDATE llm_providers
       SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END,
           updated_at = datetime('now')`,
    [id]
  );
}

/**
 * One-time migration: copy the existing Anthropic key from settings.json into
 * the anthropic provider row, and make anthropic active IF a key was found.
 *
 * Idempotent and non-destructive:
 *  - Only writes a key when one exists in settings.json (never writes NULL).
 *  - Only copies into the row when the row's api_key is still empty, so it never
 *    clobbers a key the user may set later.
 *  - Does NOT delete the settings.json key (kept as a fallback for now).
 *  - If no key is found, all rows stay is_active = 0.
 *
 * Returns whether a key was copied/activated (for startup verification). The
 * caller gates this behind a store flag so it runs once.
 */
export async function migrateAnthropicKeyFromSettings(): Promise<{
  copied: boolean;
}> {
  const key = await getApiKey(); // settings.json Anthropic key (legacy location)
  if (!key) return { copied: false };

  const row = await getProvider("anthropic");
  if (!row) return { copied: false }; // table not seeded (shouldn't happen)

  if (!row.api_key) {
    await setProviderKey("anthropic", key);
  }
  await setActiveProvider("anthropic");
  return { copied: true };
}
