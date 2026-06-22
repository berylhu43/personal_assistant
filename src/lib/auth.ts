import {
  signIn as googleSignIn,
  signOut as googleSignOut,
  refreshToken as googleRefresh,
} from "@choochmeque/tauri-plugin-google-auth-api";
import { execute, selectOne } from "./db";
import { getLocalUserId } from "./store";
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
    // UTF-8 safe so non-ASCII names aren't garbled.
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    );
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
 * Run the Google OAuth flow and store the tokens against the stable local user
 * id (NOT anything derived from the Google response). Google email/name are
 * stored only as display labels. Returns the local user.
 */
export async function signIn(): Promise<User> {
  const localId = await getLocalUserId();

  // Request offline access + forced consent so Google reliably returns a
  // refresh token (it otherwise omits it on repeat authorizations). These keys
  // aren't in the plugin's typed options, so we pass them via a variable
  // (avoids the excess-property check); the plugin forwards/ignores them.
  const signInOpts = {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scopes: SCOPES,
    access_type: "offline",
    prompt: "consent",
  };
  const res = await googleSignIn(signInOpts);


  // Display labels only — never used as an identity/ownership key.
  const claims = res.idToken ? decodeIdToken(res.idToken) : null;
  if (claims?.email || claims?.name) {
    await execute(`UPDATE users SET email = ?1, name = ?2 WHERE id = ?3`, [
      claims.email ?? "local@assistant",
      claims.name ?? null,
      localId,
    ]);
  }

  await execute(
    `INSERT INTO google_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = datetime('now')`,
    [localId, res.accessToken, res.refreshToken ?? "", expiresAtIso(res.expiresAt)]
  );

  return getCurrentUser() as Promise<User>;
}

/** Disconnect Google: revoke + drop the token row. Local data is untouched. */
export async function signOut(): Promise<void> {
  const localId = await getLocalUserId();
  const row = await selectOne<GoogleTokensRow>(
    `SELECT * FROM google_tokens WHERE user_id = ?1`,
    [localId]
  );
  if (row?.access_token) {
    // Best-effort revoke; ignore failures.
    try {
      await googleSignOut({ accessToken: row.access_token });
    } catch {
      /* noop */
    }
  }
  await execute(`DELETE FROM google_tokens WHERE user_id = ?1`, [localId]);
}

/** The local user row (always exists once ensureLocalUser has run). */
export async function getCurrentUser(): Promise<User | null> {
  const localId = await getLocalUserId();
  return selectOne<User>(`SELECT * FROM users WHERE id = ?1`, [localId]);
}

/**
 * True when Google is usable right now: either a refresh token exists (long-term
 * connection) OR the stored access token is still valid. This is only a gate for
 * "is Google usable" — token refresh in getValidAccessToken still needs the
 * refresh token and is unchanged.
 */
export async function isGoogleConnected(): Promise<boolean> {
  const localId = await getLocalUserId();
  const row = await selectOne<GoogleTokensRow>(
    `SELECT * FROM google_tokens WHERE user_id = ?1`,
    [localId]
  );
  if (!row) return false;
  const hasRefresh = !!row.refresh_token && row.refresh_token.trim() !== "";
  const accessValid =
    !!row.access_token && new Date(row.expires_at).getTime() > Date.now();
  return hasRefresh || accessValid;
}

/**
 * Return a valid access token for the local user, refreshing first if it is
 * within 60s of expiry (and persisting the refreshed token).
 */
export async function getValidAccessToken(): Promise<string> {
  const localId = await getLocalUserId();

  const row = await selectOne<GoogleTokensRow>(
    `SELECT * FROM google_tokens WHERE user_id = ?1`,
    [localId]
  );
  if (!row) throw new Error("Google is not connected");

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

  console.log("refresh expiresAt =", refreshed.expiresAt,
            "| len:", String(refreshed.expiresAt).length,
            "| computed:", expiresAtIso(refreshed.expiresAt));

  await execute(
    `UPDATE google_tokens
       SET access_token = ?1, refresh_token = ?2, expires_at = ?3, updated_at = datetime('now')
     WHERE user_id = ?4`,
    [
      refreshed.accessToken,
      refreshed.refreshToken ?? row.refresh_token,
      expiresAtIso(refreshed.expiresAt),
      localId,
    ]
  );
  

  return refreshed.accessToken;
}


