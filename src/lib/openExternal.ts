import { openUrl } from "@tauri-apps/plugin-opener";

/** Open a URL in the user's default browser (outside the app window). */
export async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (e) {
    console.error("openExternal failed:", e);
  }
}
