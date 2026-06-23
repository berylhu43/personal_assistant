import Database from "@tauri-apps/plugin-sql";

// NOTE: tauri-plugin-sql only works inside the Tauri runtime. Run the app with
// `npm run tauri dev`, not `npm run dev` (a plain browser) — DB calls fail there.

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:assistant.db");
  }
  return dbPromise;
}

/** Typed SELECT. */
export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

/** Typed SELECT returning the first row or null. */
export async function selectOne<T>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await select<T>(sql, params);
  return rows[0] ?? null;
}

/** INSERT / UPDATE / DELETE. */
export async function execute(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.execute(sql, params);
}

/** Cheap unique id without extra deps. */
export function uid(): string {
  return crypto.randomUUID();
}

/**
 * Remove emoji / pictographic icons from a string (keeps normal text, arrows,
 * and punctuation). Used to keep goal/task titles icon-free.
 */
export function stripEmoji(s: string): string {
  const emoji =
    /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍]/gu;
  return s.replace(emoji, "").replace(/\s{2,}/g, " ").trim();
}
