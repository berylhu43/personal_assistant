# Personal Assistant — Desktop Memo

An always-on, frameless desktop memo widget that acts as a proactive personal
assistant. It floats on top of your screen showing your goals (collapsed), and
expands into a chat + daily-briefing panel that reads your Google Calendar and
Gmail and plans your week with you.

Built with **Tauri 2** (Rust shell) + **React + TypeScript (Vite)**. All
business logic — SQLite, Anthropic calls, Google API calls, memory — lives in
the TypeScript layer. Rust is only the shell: window management, system tray,
and the daily 9 AM timer.

---

## How it works

- **Collapsed (default):** a small always-on-top window showing just your goal
  todolist.
- **Expanded:** a larger window that adds the daily briefing + chat panel.
  Toggle with the `›` button in the header or the tray menu.
- **System tray:** Show / Hide, Expand / Collapse, Quit. The window remembers
  the last position you left it in.
- **Daily briefing:** at **09:00** local time, if today's briefing doesn't exist
  yet, it fetches your calendar + email, asks Claude for a short summary and a
  list of proactive items (prep reminders, dependencies), saves it, and expands
  the window to show it. At **10:00** it collapses back to the todolist.
- **Chat with memory:** every turn is saved to SQLite. The system prompt is
  built from today's date, your calendar, pending emails, everything the
  assistant has remembered, and the last ~20 messages. The assistant can emit
  fenced action blocks that the app executes and hides:
  - ` ```add-event ` → creates a Google Calendar event
  - ` ```goal ` → adds a goal (with an optional weekly plan) to your todolist
  - ` ```remember ` → stores a durable fact/preference in the `memories` table

---

## Prerequisites

1. **Rust toolchain** (required by Tauri). Install via [rustup](https://rustup.rs):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. **Node.js 18+** and npm.
3. **Platform deps** for Tauri 2 — see the
   [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
   On macOS this is just the Xcode Command Line Tools (`xcode-select --install`).

---

## Setup

```bash
npm install
cp .env.example .env          # fill in your Google OAuth client id/secret
npm run tauri dev             # IMPORTANT: run inside Tauri, not `npm run dev`
```

> **Why not `npm run dev`?** `tauri-plugin-sql` only works inside the Tauri
> runtime. Opening the Vite dev server in a plain browser will fail on every DB
> call. Always use `npm run tauri dev`.

On first launch: sign in with Google, then open **Settings (⚙)** and paste your
**Anthropic API key**. The key is stored locally in `settings.json` and never
committed or sent anywhere except the Anthropic API.

To build a distributable app: `npm run tauri build`.

---

## Environment variables

`.env` (gitignored), read by Vite at build time:

| Variable | What it is |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | OAuth 2.0 **Web application** client ID. |
| `VITE_GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret. |

The **Anthropic API key** is *not* an env var — enter it in the in-app Settings
panel (stored in the local `settings.json` via `tauri-plugin-store`).

---

## Plugins used

| Plugin | Purpose |
| --- | --- |
| `tauri-plugin-sql` (sqlite) | Local database `sqlite:assistant.db`, with versioned migrations. |
| `tauri-plugin-store` | Stores the Anthropic API key + current user id locally. |
| `tauri-plugin-http` | Calls Anthropic & Google APIs from Rust transport (no browser CORS). |
| `@choochmeque/tauri-plugin-google-auth` | Desktop Google OAuth (PKCE + loopback redirect + refresh). |
| `tauri-plugin-window-state` | Remembers the window position only. |

---

## Google OAuth setup

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project and **enable** the **Google Calendar API** and **Gmail API**.
2. **OAuth consent screen** → External. Add yourself under **Test users**. Add
   these scopes:
   - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/gmail.readonly`
3. **Credentials** → **Create Credentials** → **OAuth client ID** →
   **Application type: Web application**.
   - Under **Authorized redirect URIs**, add `http://localhost`.
     The desktop plugin runs a loopback redirect server and allocates the port
     dynamically, so the bare `http://localhost` entry is what's required.
   - Copy the **Client ID** and **Client secret** into `.env`.

---

## Database schema

Migrations live in `src-tauri/src/lib.rs` (declared to the SQL plugin; the
queries themselves are all in `src/lib/*.ts`). Tables: `users`, `google_tokens`,
`goals`, `memories`, `messages`, `briefings`.

---

## Project structure

```
src/
  App.tsx                 Orchestrator: auth, expand/collapse, tray+timer events
  components/             SignInScreen · GoalTracker · BriefingPanel · ChatPanel · Settings
  lib/
    db.ts                 Database.load + typed query helpers
    auth.ts               Google sign-in, token upsert, getValidAccessToken()
    google.ts             getTodayEvents · getPendingEmails · createEvent
    anthropic.ts          chat() → Anthropic Messages API (claude-sonnet-4-6)
    chat.ts               memory-aware prompt, persistence, fenced-block actions
    goals.ts memory.ts briefing.ts   CRUD wrappers over db.ts
    store.ts              Anthropic key + current user id
    types.ts
src-tauri/
  src/lib.rs              Shell: migrations, tray, window sizing, daily timer
  src/main.rs
  tauri.conf.json         Frameless, alwaysOnTop, skipTaskbar window
  capabilities/default.json
```

---

## Security & scope notes

- The Anthropic key and all Google tokens stay on the local machine.
  `settings.json` and `*.db` are gitignored — never commit secrets.
- Single-user; no push notifications or scheduled emails (out of scope for now).
