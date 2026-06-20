import { load, Store } from "@tauri-apps/plugin-store";

// Local settings store — holds the Anthropic API key and the signed-in user id.
// Stays on the local machine; never committed (settings.json is gitignored).

let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("settings.json", { autoSave: true, defaults: {} });
  }
  return storePromise;
}

const KEY_ANTHROPIC = "anthropic_api_key";
const KEY_USER_ID = "current_user_id";

export async function getApiKey(): Promise<string | null> {
  const s = await store();
  return (await s.get<string>(KEY_ANTHROPIC)) ?? null;
}

export async function setApiKey(key: string): Promise<void> {
  const s = await store();
  await s.set(KEY_ANTHROPIC, key.trim());
}

export async function getCurrentUserId(): Promise<string | null> {
  const s = await store();
  return (await s.get<string>(KEY_USER_ID)) ?? null;
}

export async function setCurrentUserId(id: string | null): Promise<void> {
  const s = await store();
  if (id) await s.set(KEY_USER_ID, id);
  else await s.delete(KEY_USER_ID);
}
