# AGENTS.md — Project guide for AI coding agents

This file orients an AI coding agent (or a new human) to this repo: what it is, how it's
structured, how to run it, the conventions to respect, and the work currently in flight. Read this
top-to-bottom once before making changes. The user-facing `README.md` is also accurate and
complementary — this file adds the agent-oriented detail and the current task state.

---

## 1. What this is

An always-on, frameless **desktop memo widget** that acts as a proactive personal assistant. It
floats on top of the screen showing your goals (collapsed) and expands into a chat + daily-briefing
panel that reads your Google Calendar and Gmail and plans your week with you.

- **Collapsed:** small always-on-top window, just the goal todolist.
- **Expanded:** adds the daily briefing + chat panel (toggle via header `›` button or tray).
- **Daily timer:** at 09:00 local it generates/show the day's briefing; at 10:00 it collapses back.
- **Chat with memory:** every turn persisted to SQLite; the assistant can emit fenced action blocks
  (`add-event`, `goal`, `remember`) that the app executes and hides.

Single user, local-first. All secrets and data stay on the machine.

---

## 2. Tech stack & architecture principle

- **Shell:** Tauri 2 (Rust). **UI:** React 18 + TypeScript, built with Vite. **Styling:** Tailwind.
- **Local DB:** SQLite via `tauri-plugin-sql` (file `sqlite:assistant.db`).
- **LLM:** Anthropic Messages API, model `claude-sonnet-4-6` (called from `src/lib/anthropic.ts`).
- **PDF parsing:** `pdfjs-dist` (for extracting assignments from uploaded files).

> **Core principle:** *All business logic lives in the TypeScript layer.* Rust (`src-tauri/`) is only
> the shell — window sizing, system tray, the daily timer, and DB migration declarations. When adding
> a feature, default to TypeScript; touch Rust only for window/tray/timer/migration/native concerns.

---

## 3. Run / build / verify

**Prerequisites:** Rust toolchain (rustup), Node 18+, Tauri 2 platform deps (macOS: Xcode CLT).

```bash
npm install
cp .env.example .env        # fill VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_SECRET
npm run tauri dev           # ALWAYS run inside Tauri, never `npm run dev`
```

> **Why not `npm run dev`?** `tauri-plugin-sql` only works inside the Tauri runtime. A plain browser
> Vite server fails on every DB call.

**Checks an agent can run non-interactively:**
- Frontend typecheck: `npx tsc --noEmit`
- Rust compile: `cd src-tauri && cargo check`
- Production build: `npm run build` (runs `tsc && vite build`), full app: `npm run tauri build`

**Anything involving real Google sign-in or live Anthropic calls needs a human** — OAuth opens a
browser and the Anthropic key is entered in-app, not in env.

**Config / secrets:**
- `.env` (gitignored): `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_SECRET` — OAuth 2.0 **Web
  application** client, with `http://localhost` as an authorized redirect URI (desktop plugin uses a
  loopback redirect on a dynamic port).
- `.env` (gitignored): `VITE_MS_CLIENT_ID`, `VITE_MS_TENANT` — Microsoft (Teams) app registration,
  type **Mobile and desktop applications** (public client, PKCE, NO secret), `http://localhost`
  redirect URI. `VITE_MS_TENANT` = your org/tenant id (NOT `common` — personal accounts can't read
  Teams chat). See §8.
- **Anthropic API key:** entered in the in-app Settings (⚙) panel, stored locally via
  `tauri-plugin-store` (`settings.json`). Never an env var, never committed.

---

## 4. Directory map

```
src/                         React + TS — ALL business logic
  main.tsx                   React entry
  App.tsx                    Orchestrator: auth gate, expand/collapse, tray + timer event wiring
  components/
    SignInScreen.tsx         Google connect screen
    GoalTracker.tsx          Collapsed-view goal todolist
    BriefingPanel.tsx        Daily briefing UI
    ChatPanel.tsx            Chat UI (renders runChatTurn results)
    Settings.tsx             Anthropic key entry + app settings
    LocalCalendar.tsx        Local (non-Google) commitments UI
  lib/
    db.ts                    Database.load + typed helpers: select / selectOne / execute / uid / stripEmoji
    auth.ts                  Google OAuth: signIn, signOut, getCurrentUser, isGoogleConnected,
                             getValidAccessToken (refresh-on-expiry). SCOPES list lives here.
    msAuth.ts                Microsoft (Teams/Graph) OAuth: signInMicrosoft, signOutMicrosoft,
                             isTeamsConnected, getValidMsAccessToken. PKCE + token exchange in TS;
                             tauri-plugin-oauth only provides the loopback listener. See §8.
    teams.ts                 Graph client: getTeamsMessages — 1:1 DMs + @mentions (filtered locally).
    teamsTasks.ts            scanTeamsForTasks — LLM extracts task candidates from Teams DMs/@mentions
                             (same InboxTaskCandidate shape as email; merged into the Inbox).
    init.ts                  ensureLocalUser (stable local id), initApp (one-time startup migrations/dedupe)
    store.ts                 tauri-plugin-store wrappers: API key, local user id, one-time flags, pending plan
    anthropic.ts             chat() → Anthropic Messages API
    chat.ts                  buildSystemPrompt, parseBlocks (fenced actions), runChatTurn, message persistence
    google.ts                getTodayEvents, getPendingEmails, getRecentEmailsWithBody, createEvent
    goals.ts                 Goal CRUD + progress/granularity/plan helpers
    memory.ts                memories table CRUD + dedupe + relative-time purge
    briefing.ts              todayStr, getBriefing, generateBriefing, getOrGenerateBriefing
    planning.ts              generatePlan — LLM-generated weekly/learning plan for a goal
    plans.ts                 plans table CRUD (createPlan, getPlanByGoal)
    planExport.ts            planToMarkdown, downloadPlan (export a plan to a .md file)
    distill.ts               distillConversation — summarize chat into durable memories
    emailTasks.ts            scanInboxForTasks / getOrScanInbox / rescanInbox — cached daily inbox scan
    fileTasks.ts             pickDocument, extractText (pdfjs), extractAssignments — turn a doc into tasks
    localCalendar.ts         Local commitments CRUD + various "upcoming/this week" queries
    errors.ts                friendlyError — map raw errors to user-facing messages
    openExternal.ts          Open URLs in the system browser
    types.ts                 Shared TS types (User, GoogleTokensRow, Goal, Memory, Briefing, ...)
  styles/globals.css         Tailwind entry

src-tauri/                   Rust shell ONLY
  src/lib.rs                 Migrations (v1–v7), tray, window sizing (COLLAPSED/EXPANDED), daily timer,
                             plugin registration, set_expanded command
  src/main.rs                Thin entry → personal_assistant_lib::run()
  Cargo.toml                 Rust deps + plugin list (see vendored google-auth note below)
  tauri.conf.json            Frameless / alwaysOnTop / skipTaskbar window, CSP, bundle config
  capabilities/default.json  Tauri permission capabilities
  vendor/tauri-plugin-google-auth/   LOCAL PATCHED COPY of the OAuth plugin (see §7)

Root: index.html, vite.config.ts, tailwind/postcss configs, tsconfig*.json, .env(.example)
```

---

## 5. Data model

SQLite DB `sqlite:assistant.db`. Schema is declared as versioned migrations in
`src-tauri/src/lib.rs` (`migrations()`); the actual queries are all in `src/lib/*.ts`. Migrations are
append-only and run exactly once each — **never edit an existing migration; add a new versioned one.**

| Table | Purpose |
| --- | --- |
| `users` | The single local user (stable local id; Google email/name are display labels only). |
| `google_tokens` | `access_token`, `refresh_token` (NOT NULL — empty string allowed), `expires_at`. One row per user. |
| `goals` | Todolist goals: progress, done, plan, target_date, task_total, granularity. |
| `memories` | Durable facts/preferences (`kind`, `content`, `source`). |
| `messages` | Full chat history (role, content). |
| `briefings` | One daily briefing per `(user_id, date)`. |
| `calendar` | Local commitments NOT synced to Google (date, time, source, done, goal_id, span). |
| `plans` | Learning/weekly plan documents linked to a goal. |
| `inbox_scans` | Cached daily inbox-task scan per `(user_id, date)`. |
| `microsoft_tokens` | Microsoft (Teams/Graph) OAuth tokens. Same shape/convention as `google_tokens`. |

Migration versions so far: 1 initial · 2 calendar · 3 goal target_date · 4 task↔goal link · 5 weekly
granularity · 6 plans · 7 inbox_scans · 8 microsoft_tokens. **Next migration = version 9.**

---

## 6. Key runtime flows

- **Startup (`App.tsx` → `init.ts`):** `ensureLocalUser` creates/loads a stable local user id (stored
  via `tauri-plugin-store`, independent of Google identity). `initApp` runs one-time consolidation
  steps gated by flags in `store.ts`. The app gates on `isGoogleConnected()`; if false → SignInScreen.
- **Tray + timer (Rust → events):** `lib.rs` builds the tray (Show/Hide, Expand/Collapse, Quit) and a
  once-a-minute timer that emits `briefing-due` (9 AM) and `briefing-end` (10 AM). React listens and
  decides what to do (guards on whether today's briefing already exists). Resize via the `set_expanded`
  command, which also emits `expanded-changed`.
- **Chat turn (`chat.ts` `runChatTurn`):** builds a memory-aware system prompt (date + today's
  calendar + pending emails + remembered facts + last ~20 messages), calls `anthropic.chat()`, then
  `parseBlocks` extracts fenced action blocks and executes them (create Google event / add goal /
  store memory), hiding the blocks from displayed text. Everything is persisted to `messages`.
- **Google data (`google.ts`):** all calls go through `getValidAccessToken()` for auth and use
  `tauri-plugin-http` transport (no browser CORS).
- **OAuth token lifecycle (`auth.ts`):** `signIn` runs the OAuth flow and upserts `google_tokens`;
  `getValidAccessToken` returns the access token, refreshing via the plugin when within 60s of expiry
  and persisting the result. **This is the area under active work — see §7.**

---

## 7. CURRENT WORK IN FLIGHT — Google refresh_token / auto-renew fix

**Branch:** `add-file-staging`. **State:** code complete + compiles; **runtime verification still
pending** (needs a human to do a real Google sign-in).

### The bug
`google_tokens.refresh_token` was stored **empty**. Once the access token expired,
`getValidAccessToken()` had nothing to refresh with and threw "sign in again" — the connection could
not auto-renew.

### Root cause (confirmed by reading the plugin source)
Google never returned a refresh token, because the OAuth authorization URL never included
`access_type=offline`. The npm plugin `@choochmeque/tauri-plugin-google-auth-api` forwards options to
a Rust command whose `SignInRequest` struct has no `access_type`/`prompt` fields (serde drops unknown
keys), and the Rust `sign_in` builds the auth URL with only scopes + PKCE. **No version of the plugin
(0.5.1 or upstream master) exposes an offline-access option.** So the earlier "fix" that passed
`access_type`/`prompt` from JS was silently dropped.

### Fix applied (chosen approach: vendor + local patch)
1. **Vendored the plugin** to `src-tauri/vendor/tauri-plugin-google-auth/` and repointed
   `src-tauri/Cargo.toml` from the crates.io version to `{ path = "vendor/tauri-plugin-google-auth" }`.
2. **Patched** `vendor/tauri-plugin-google-auth/src/desktop.rs` (search `LOCAL PATCH`) — in `sign_in`,
   after the scope loop and before `.set_pkce_challenge`:
   ```rust
   auth_url_builder = auth_url_builder
       .add_extra_param("access_type", "offline")
       .add_extra_param("prompt", "consent");
   ```
   `offline` → Google issues a refresh token; `consent` → forces consent each time so it is re-issued.
   `add_extra_param` is valid on oauth2 v5 (the resolved version).
3. **`src/lib/auth.ts` (`signIn`)**:
   - Removed the dead JS `access_type`/`prompt` keys (they did nothing) and documented that the
     mechanism now lives in the Rust patch.
   - **Regression guard** on the `ON CONFLICT(user_id) DO UPDATE`: `refresh_token` is only overwritten
     when the incoming value is non-empty, so a re-login that omits one keeps the stored token
     (`CASE WHEN excluded.refresh_token != '' THEN excluded.refresh_token ELSE google_tokens.refresh_token END`).
   - Added a **TEMPORARY diagnostic** `console.log` (search `TEMP DIAGNOSTIC`) of the response keys +
     `refreshToken` length.

**Deliberately NOT changed:** `getValidAccessToken()` refresh logic (the goal was to *have* a refresh
token, not weaken the refresh path). There is also a pre-existing stray
`console.log("refresh expiresAt …")` in `getValidAccessToken` from earlier debugging — out of scope,
left as-is.

**Verified so far:** `npx tsc --noEmit` passes; `cargo check` passes (vendored patched crate builds).

### REMAINING WORK — verification (needs a human / real OAuth)
1. `npm run tauri dev`. Disconnect Google if already connected, then Connect Google and complete
   consent (you should now see the consent screen every time).
2. Dev console should log: `[signIn] refreshToken present? true | value len: <non-zero>`.
3. Inspect the DB: `google_tokens.refresh_token` should be **non-empty**.
4. Force expiry (set `google_tokens.expires_at` to the past, or wait ~1h), then open Inbox/calendar —
   it should **auto-renew with no manual re-login**.

### After verification passes (cleanup)
- Remove the `// TEMP DIAGNOSTIC` block in `src/lib/auth.ts`.
- (Optional) remove the stray `console.log` in `getValidAccessToken`.
- (Optional) trim unused sub-trees from the vendored crate (`android/`, `ios/`, JS `src/`, README) —
  only `src/*.rs`, `Cargo.toml`, `build.rs`, `permissions/` are needed for the desktop build; re-run
  `cargo check` after trimming.

### If the plugin is ever bumped/replaced
The whole patch is the two `add_extra_param` lines in `desktop.rs`. If upstream ever adds a real
offline-access option, switch back to the crates.io dependency, pass that option from `auth.ts`, and
delete `src-tauri/vendor/tauri-plugin-google-auth/`.

---

## 8. Microsoft Teams integration (Graph)

Mirrors the Gmail integration in *shape* (connect → tokens stored locally → a data client feeding the
chat context) but runs on a parallel Microsoft stack, because Teams uses the Microsoft identity
platform (Entra) + Microsoft Graph, not Google OAuth.

- **Auth (`src/lib/msAuth.ts`):** full OAuth lives in TS (per the core principle). `tauri-plugin-oauth`
  only provides a loopback HTTP listener (`start()` → port, `onUrl()` → redirect). We generate PKCE,
  open the consent page via `openExternal`, catch the redirect, and exchange the code at
  `login.microsoftonline.com/{tenant}/oauth2/v2.0/token`. Tokens go in `microsoft_tokens` with the
  same "never clobber a good refresh token with an empty one" upsert guard as Google.
  `getValidMsAccessToken` refreshes within 60s of expiry. Scopes: `openid profile email
  offline_access User.Read Chat.Read`.
- **Data (`src/lib/teams.ts`):** `getTeamsMessages` lists `/me/chats?$expand=lastMessagePreview`, keeps
  `oneOnOne` DMs from the last 7 days, and scans recent group chats for messages that `@mention` the
  user (matched against `/me` id). **Filtering happens locally, before anything reaches the prompt** —
  the LLM only pays tokens for high-signal messages. Bounded by `MAX_CHATS_SCANNED` / `MAX_GROUP_FETCHES`
  / `MAX_RESULTS` constants.
- **Wiring (mirrors email, which feeds BOTH the Inbox and the chat context):**
  - *Inbox task extraction (primary, visible):* `teamsTasks.scanTeamsForTasks` extracts task candidates
    from DMs/@mentions in the unified `InboxTaskCandidate` shape. `emailTasks.getOrScanInbox` /
    `rescanInbox` now scan email **and** Teams (Teams only when `isTeamsConnected`) and MERGE both into
    one list, cached together in `inbox_scans` (no new table). `BriefingPanel` renders the merged list in
    the existing **Inbox** section; Teams items get a small `teams` tag and Add writes a commitment with
    `source: "teams"`.
  - *Chat context (secondary):* surfaced in the system prompt next to pending emails
    (`buildSystemPrompt` → "Teams messages needing attention"); fetched in `App.loadDayData` (gated on
    `isTeamsConnected`) and threaded through `ChatPanel` into `runChatTurn`'s ctx.
  - Connect/Disconnect UI is in `Settings.tsx`. Teams is an OPTIONAL, separate connection — the app does
    NOT gate readiness on it (only on Google).
- **Hard constraint:** Graph delegated chat read is **work/school accounts only** — personal Microsoft
  accounts cannot read Teams chat. `VITE_MS_TENANT` must be an org/tenant id.
- **Verification still needs a human** (real Microsoft OAuth): Settings → Connect Teams → consent;
  confirm `microsoft_tokens.refresh_token` is non-empty; confirm DMs/@mentions appear in chat context.
  `npx tsc --noEmit` and `cargo check` both pass.

## 9. Conventions & gotchas

- **Run inside Tauri** (`npm run tauri dev`), never plain Vite — DB calls fail otherwise.
- **TS owns logic; Rust is the shell.** Resist adding logic to Rust.
- **Migrations are append-only and versioned.** SQLite has no `ADD COLUMN IF NOT EXISTS`; rely on the
  version guard. Next is version 9.
- **Local identity vs. Google identity are separate.** The app keys everything off a stable local
  user id (`store.ts` / `ensureLocalUser`); Google email/name are display labels only — never use them
  as ownership keys.
- **Secrets:** `.env` and `*.db` and `settings.json` are gitignored. Never commit keys/tokens.
- **Git:** current branch `add-file-staging`. Commit/push only when the user asks; if asked, follow
  the repo's existing commit style.
- **User-facing errors** go through `errors.ts` `friendlyError`.
- **Model:** when changing LLM calls, keep using current Claude models (`claude-sonnet-4-6` today;
  check for newer before downgrading).

## 10. Where to start for common tasks
- New table/column → add migration v9 in `src-tauri/src/lib.rs`, then queries in the relevant
  `src/lib/*.ts`, then types in `types.ts`.
- New chat capability → extend `buildSystemPrompt` + `parseBlocks`/`runChatTurn` in `chat.ts`.
- New Google API call → add to `google.ts`, auth via `getValidAccessToken()`.
- New Teams/Graph call → add to `teams.ts`, auth via `getValidMsAccessToken()` (see §8).
- Window/tray/timer behavior → `src-tauri/src/lib.rs`.
- The active OAuth fix → §7.
