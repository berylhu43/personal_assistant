import {
  signIn as googleSignIn,
  signOut as googleSignOut,
  refreshToken as googleRefresh,
} from "@choochmeque/tauri-plugin-google-auth-api";
import { execute, selectOne } from "./db";
import { setCurrentUserId, getCurrentUserId } from "./store";
import type { User, GoogleTokensRow } from "./types";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;

export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
];

// Refresh if the token expires within this window.
const REFRESH_SKEW_MS = 60_000;

interface IdClaims {
  sub: string;
  email?: string;
  name?: string;
}

/** Decode the payload of a JWT id token (no verification needed locally). */
function decodeIdToken(idToken: string): IdClaims | null {
  try {
    const payload = idToken.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function expiresAtIso(expiresAtSeconds: number | undefined): string {
  const ms = expiresAtSeconds ? expiresAtSeconds * 1000 : Date.now() + 3600_000;
  return new Date(ms).toISOString();
}

/**
 * Run the Google OAuth flow, then upsert the user and their tokens.
 * Returns the signed-in user.
 */
export async function signIn(): Promise<User> {
  const res = await googleSignIn({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scopes: SCOPES,
  });

  const claims = res.idToken ? decodeIdToken(res.idToken) : null;
  const userId = claims?.sub ?? res.accessToken.slice(0, 24);
  const email = claims?.email ?? "unknown@local";
  const name = claims?.name ?? null;

  await execute(
    `INSERT INTO users (id, email, name) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
    [userId, email, name]
  );

  await execute(
    `INSERT INTO google_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = datetime('now')`,
    [userId, res.accessToken, res.refreshToken ?? "", expiresAtIso(res.expiresAt)]
  );

  await setCurrentUserId(userId);
  return getCurrentUser() as Promise<User>;
}

export async function signOut(): Promise<void> {
  const userId = await getCurrentUserId();
  if (userId) {
    const row = await selectOne<GoogleTokensRow>(
      `SELECT * FROM google_tokens WHERE user_id = ?1`,
      [userId]
    );
    if (row?.access_token) {
      // Best-effort revoke; ignore failures.
      try {
        await googleSignOut({ accessToken: row.access_token });
      } catch {
        /* noop */
      }
    }
  }
  await setCurrentUserId(null);
}

export async function getCurrentUser(): Promise<User | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  return selectOne<User>(`SELECT * FROM users WHERE id = ?1`, [userId]);
}

/**
 * Return a valid access token for the current user, refreshing first if it is
 * within 60s of expiry (and persisting the refreshed token).
 */
export async function getValidAccessToken(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not signed in");

  const row = await selectOne<GoogleTokensRow>(
    `SELECT * FROM google_tokens WHERE user_id = ?1`,
    [userId]
  );
  if (!row) throw new Error("No tokens stored for current user");

  const expiresMs = new Date(row.expires_at).getTime();
  if (expiresMs - Date.now() > REFRESH_SKEW_MS) {
    return row.access_token;
  }

  if (!row.refresh_token) {
    throw new Error("Access token expired and no refresh token available — sign in again");
  }

  const refreshed = await googleRefresh({
    refreshToken: row.refresh_token,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scopes: SCOPES,
  });

  await execute(
    `UPDATE google_tokens
       SET access_token = ?1, refresh_token = ?2, expires_at = ?3, updated_at = datetime('now')
     WHERE user_id = ?4`,
    [
      refreshed.accessToken,
      refreshed.refreshToken ?? row.refresh_token,
      expiresAtIso(refreshed.expiresAt),
      userId,
    ]
  );

  return refreshed.accessToken;
}
