import { load, Store } from "@tauri-apps/plugin-store";

// Local settings store — holds the Anthropic API key and a stable local user id.
// Stays on the local machine; never committed (settings.json is gitignored).

let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("settings.json", { autoSave: true, defaults: {} });
  }
  return storePromise;
}

const KEY_ANTHROPIC = "anthropic_api_key";
const KEY_LOCAL_USER = "local_user_id";
const KEY_CONSOLIDATED = "data_consolidated_v1";
const KEY_RELATIVE_PURGED = "memories_purged_relative_v1";
const KEY_TITLES_CLEANED = "titles_deemojified_v1";
const KEY_PROVIDER_KEY_MIGRATED = "provider_key_migrated_v1";

export async function getApiKey(): Promise<string | null> {
  const s = await store();
  return (await s.get<string>(KEY_ANTHROPIC)) ?? null;
}

export async function setApiKey(key: string): Promise<void> {
  const s = await store();
  await s.set(KEY_ANTHROPIC, key.trim());
}

/**
 * The permanent local user id for this installation. Independent of Google
 * login — generated once and reused forever, so local data (goals, memory,
 * chat history) is never reset by signing in/out of Google.
 */
export async function getLocalUserId(): Promise<string> {
  const s = await store();
  let id = await s.get<string>(KEY_LOCAL_USER);
  if (!id) {
    id = crypto.randomUUID();
    await s.set(KEY_LOCAL_USER, id);
  }
  return id;
}

export async function isDataConsolidated(): Promise<boolean> {
  const s = await store();
  return (await s.get<boolean>(KEY_CONSOLIDATED)) === true;
}

export async function setDataConsolidated(): Promise<void> {
  const s = await store();
  await s.set(KEY_CONSOLIDATED, true);
}

export async function isRelativeMemoriesPurged(): Promise<boolean> {
  const s = await store();
  return (await s.get<boolean>(KEY_RELATIVE_PURGED)) === true;
}

export async function setRelativeMemoriesPurged(): Promise<void> {
  const s = await store();
  await s.set(KEY_RELATIVE_PURGED, true);
}

export async function areTitlesCleaned(): Promise<boolean> {
  const s = await store();
  return (await s.get<boolean>(KEY_TITLES_CLEANED)) === true;
}

export async function setTitlesCleaned(): Promise<void> {
  const s = await store();
  await s.set(KEY_TITLES_CLEANED, true);
}

/** Whether the one-time copy of the settings.json Anthropic key into the
 * llm_providers table has already run. */
export async function isProviderKeyMigrated(): Promise<boolean> {
  const s = await store();
  return (await s.get<boolean>(KEY_PROVIDER_KEY_MIGRATED)) === true;
}

export async function setProviderKeyMigrated(): Promise<void> {
  const s = await store();
  await s.set(KEY_PROVIDER_KEY_MIGRATED, true);
}

// The cadence a plan is scheduled at. "custom" = an irregular rhythm the user
// typed (e.g. "twice a week"); the model resolves it to explicit dated tasks.
export type PlanGranularity = "daily" | "weekly" | "monthly" | "custom";

/**
 * The confirmed options for generating a plan, collected from the plan-options
 * modal and handed to `generatePlan`. (The model only proposes topic/targetDate
 * + a suggested cadence in its `plan-request` block; the user picks the rest.)
 */
export interface PendingPlan {
  topic: string;
  targetDate?: string;
  // The cadence the user chose; defaults to "daily" downstream when omitted.
  granularity?: PlanGranularity;
  // Free-text rhythm when granularity === "custom" (e.g. "every other day").
  customCadence?: string;
  // Whether to web-search real resources/links (heavy path) or just lay out a
  // schedule (lightweight, no search). Defaults to true downstream.
  withResources?: boolean;
}
