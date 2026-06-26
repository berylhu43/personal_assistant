import { fetch } from "@tauri-apps/plugin-http";
import { start, cancel, onUrl } from "@fabianlars/tauri-plugin-oauth";
import { execute, selectOne } from "./db";
import { getLocalUserId } from "./store";
import { openExternal } from "./openExternal";
import type { MicrosoftTokensRow } from "./types";

// Microsoft identity platform (Entra) sign-in for Teams/Graph. This mirrors the
// shape of auth.ts (Google), but Microsoft has no Tauri plugin, so the whole
// OAuth dance lives here in TS: tauri-plugin-oauth only provides the loopback
// listener that catches the browser redirect; PKCE + token exchange are ours.

const CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID;
// Tenant: an org/tenant id for work/school accounts. Defaults to "common" but
// note that reading Teams chat messages is NOT supported for personal accounts.
const TENANT = import.meta.env.VITE_MS_TENANT || "common";
const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`;

// Delegated scopes. offline_access → refresh token; Chat.Read → read the
// signed-in user's 1:1/group chat messages; User.Read → resolve /me identity.
export const MS_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Chat.Read",
];

// Refresh if the token expires within this window.
const REFRESH_SKEW_MS = 60_000;

// ---- PKCE helpers ----

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

/** ISO datetime `expiresInSeconds` from now (default 1h if missing). */
function expiresAtIso(expiresInSeconds: number | undefined): string {
  const ms = Date.now() + (expiresInSeconds ? expiresInSeconds * 1000 : 3600) * 1000;
  return new Date(ms).toISOString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** POST the token endpoint (auth-code or refresh grant) and parse the result. */
async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) {
    throw new Error(
      `Microsoft token error: ${data.error ?? res.status} — ${
        data.error_description ?? "request failed"
      }`
    );
  }
  return data;
}

/**
 * Run the loopback OAuth flow: start a localhost listener, open the browser to
 * the consent page, wait for the redirect, and return the authorization code.
 */
async function awaitAuthCode(): Promise<{ code: string; redirectUri: string }> {
  const port = await start();
  const redirectUri = `http://localhost:${port}`;
  const verifierState = await prepareAuthUrl(redirectUri);

  return new Promise<{ code: string; redirectUri: string }>(
    (resolve, reject) => {
      let settled = false;
      let unlisten: (() => void) | null = null;

      const cleanup = () => {
        if (unlisten) unlisten();
        void cancel(port).catch(() => {});
      };

      // Safety net: don't leave the loopback server running forever.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Microsoft sign-in timed out"));
      }, 300_000);

      onUrl((url) => {
        if (settled) return;
        try {
          const parsed = new URL(url);
          const err = parsed.searchParams.get("error");
          const code = parsed.searchParams.get("code");
          const returnedState = parsed.searchParams.get("state");
          if (err) throw new Error(parsed.searchParams.get("error_description") || err);
          if (!code) throw new Error("No authorization code returned");
          if (returnedState !== verifierState.state)
            throw new Error("OAuth state mismatch");
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve({ code, redirectUri });
        } catch (e) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(e);
        }
      })
        .then((un) => {
          unlisten = un;
          // Open the consent page only once the listener is wired up.
          void openExternal(verifierState.authUrl);
        })
        .catch((e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(e);
        });
    }
  );
}

// Built per sign-in so the verifier/state stay paired with their auth URL.
let pendingVerifier = "";

interface AuthUrlState {
  authUrl: string;
  state: string;
}

async function prepareAuthUrl(redirectUri: string): Promise<AuthUrlState> {
  const verifier = randomUrlSafe(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomUrlSafe(16);
  pendingVerifier = verifier;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    prompt: "select_account",
  });
  return { authUrl: `${AUTHORITY}/oauth2/v2.0/authorize?${params}`, state };
}

/** Upsert tokens, never clobbering a good refresh token with an empty one. */
async function storeTokens(
  localId: string,
  access: string,
  refresh: string,
  expiresAt: string
): Promise<void> {
  await execute(
    `INSERT INTO microsoft_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = CASE
         WHEN excluded.refresh_token IS NOT NULL AND excluded.refresh_token != ''
           THEN excluded.refresh_token
         ELSE microsoft_tokens.refresh_token
       END,
       expires_at = excluded.expires_at,
       updated_at = datetime('now')`,
    [localId, access, refresh, expiresAt]
  );
}

/** Run Microsoft OAuth and persist tokens against the stable local user id. */
export async function signInMicrosoft(): Promise<void> {
  if (!CLIENT_ID) {
    throw new Error("VITE_MS_CLIENT_ID is not set — cannot connect Teams");
  }
  const localId = await getLocalUserId();

  // Guarantee the parent users row exists before writing microsoft_tokens (FK →
  // users.id) — avoids a FOREIGN KEY constraint (SQLite 787) if startup init
  // didn't seed the local user. Idempotent.
  await execute(
    `INSERT INTO users (id, email, name) VALUES (?1, 'local@assistant', NULL)
     ON CONFLICT(id) DO NOTHING`,
    [localId]
  );

  const { code, redirectUri } = await awaitAuthCode();

  const data = await tokenRequest({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: pendingVerifier,
    scope: MS_SCOPES.join(" "),
  });
  pendingVerifier = "";

  await storeTokens(
    localId,
    data.access_token,
    data.refresh_token ?? "",
    expiresAtIso(data.expires_in)
  );
}

/** Disconnect Teams: drop the token row. Local data is untouched. */
export async function signOutMicrosoft(): Promise<void> {
  const localId = await getLocalUserId();
  await execute(`DELETE FROM microsoft_tokens WHERE user_id = ?1`, [localId]);
}

/** True when Teams is usable now: a refresh token exists OR access is still valid. */
export async function isTeamsConnected(): Promise<boolean> {
  const localId = await getLocalUserId();
  const row = await selectOne<MicrosoftTokensRow>(
    `SELECT * FROM microsoft_tokens WHERE user_id = ?1`,
    [localId]
  );
  if (!row) return false;
  const hasRefresh = !!row.refresh_token && row.refresh_token.trim() !== "";
  const accessValid =
    !!row.access_token && new Date(row.expires_at).getTime() > Date.now();
  return hasRefresh || accessValid;
}

/**
 * Return a valid Microsoft Graph access token, refreshing first if it is within
 * 60s of expiry (and persisting the refreshed token).
 */
export async function getValidMsAccessToken(): Promise<string> {
  const localId = await getLocalUserId();
  const row = await selectOne<MicrosoftTokensRow>(
    `SELECT * FROM microsoft_tokens WHERE user_id = ?1`,
    [localId]
  );
  if (!row) throw new Error("Microsoft Teams is not connected");

  const expiresMs = new Date(row.expires_at).getTime();
  if (expiresMs - Date.now() > REFRESH_SKEW_MS) {
    return row.access_token;
  }

  if (!row.refresh_token) {
    throw new Error(
      "Teams token expired and no refresh token available — connect Teams again"
    );
  }

  const data = await tokenRequest({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    scope: MS_SCOPES.join(" "),
  });

  await storeTokens(
    localId,
    data.access_token,
    data.refresh_token ?? row.refresh_token,
    expiresAtIso(data.expires_in)
  );
  return data.access_token;
}
