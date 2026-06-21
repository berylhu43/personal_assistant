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
