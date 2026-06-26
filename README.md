# Personal Assistant — Desktop Memo

An always-on, frameless desktop memo widget that acts as a proactive personal
assistant. It floats on top of your screen showing your goals (collapsed), and
expands into a chat + daily-briefing panel that reads your Google Calendar and
Gmail (and, optionally, Microsoft Teams) and plans your week with you.

Built with **Tauri 2** (Rust shell) + **React + TypeScript (Vite)**. All
business logic — SQLite, LLM-provider calls, Google & Microsoft API calls,
memory — lives in the TypeScript layer. Rust is only the shell: window
management, system tray, and the daily 9 AM timer.

You bring your own model: pick **Claude, GPT, DeepSeek, or Qwen** in Settings
and enter that provider's API key. Keys stay on your machine.

---

## How it works

- **Collapsed (default):** a small always-on-top window showing just your goal
  todolist.
- **Expanded:** a larger window that adds the daily briefing + chat panel.
  Toggle with the `›` button in the header or the tray menu.
- **System tray:** Show / Hide, Expand / Collapse, Quit. The window remembers
  the last position you left it in.
- **Daily briefing:** at **09:00** local time, if today's briefing doesn't exist
  yet, it fetches your calendar + email (+ Teams, if connected), asks your
  selected model for a short summary and a list of proactive items (prep
  reminders, dependencies), saves it, and expands the window to show it. At
  **10:00** it collapses back to the todolist.
- **Chat with memory:** every turn is saved to SQLite. The system prompt is
  built from today's date, your calendar, pending emails, Teams messages,
  everything the assistant has remembered, and the last ~20 messages. The
  assistant can emit fenced action blocks that the app executes and hides:
  - ` ```add-event ` → creates a Google Calendar event
  - ` ```goal ` → adds a goal (optionally with daily / weekly / monthly tasks)
  - ` ```commitment ` → adds a one-off dated task to your local calendar
  - ` ```remember ` → stores a durable fact/preference in the `memories` table
- **Goals & tasks:** track goals with a progress bar, optional start/target
  dates, and linked tasks at **daily, weekly, or monthly** granularity. Tasks
  show up in the local calendar (Upcoming) as their dates arrive and drive the
  goal's progress. Everything is editable inline.
- **Plans (any goal, not just study):** ask the assistant to build a plan —
  learning, fitness, diet, travel, a project, anything. It first clarifies the
  essentials in chat (e.g. a trip's destination/budget), then a small **pop-up**
  lets you choose:
  - **Schedule:** daily / weekly / monthly / a custom rhythm you type.
  - **Resources & links:** *Yes* → it web-searches real, current resources and
    attaches links to each step (needs **Claude or GPT**); *No* → a quick
    schedule-only plan from the model's own knowledge (works with **any**
    provider). Either way the plan is **saved as a goal**, so it persists after
    you close the chat. Researched plans can be exported to Markdown.
- **Local calendar:** dated commitments that live only on this machine (never
  synced to Google), with overdue highlighting and weekly/monthly task spans.
- **Archive & recoverable delete:** checking a goal/task off **archives** it
  (Completed); clicking **×** **soft-deletes** it to a recoverable **Discarded**
  area. From the Archive you can **Restore** either, or **Delete forever**
  (confirmed). Discarding a goal carries its tasks with it; restoring brings
  them back.
- **Inbox & files:** the briefing surfaces task candidates scanned from recent
  email (and Teams DMs/@mentions); you can also attach a PDF/txt/md (e.g. a
  syllabus) and confirm extracted assignments into your calendar.

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

On first launch: sign in with Google, then open **Settings (⚙)** and add an API
key for at least one **LLM provider** (Claude, GPT, DeepSeek, or Qwen) and pick
which one is active. Keys are stored locally (in the `llm_providers` table) and
never committed or sent anywhere except that provider's API. Note: building a
plan **with researched resources/links** uses web search, so that mode works
only with **Claude or GPT**; schedule-only plans (and everything else) work with
any provider.

To build a distributable app: `npm run tauri build`.

---

## Environment variables

`.env` (gitignored), read by Vite at build time:

| Variable | What it is |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | OAuth 2.0 **Web application** client ID. |
| `VITE_GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret. |
| `VITE_MS_CLIENT_ID` | Microsoft (Teams) app registration client ID — **Mobile and desktop** (public client, no secret). |
| `VITE_MS_TENANT` | Microsoft tenant/org ID. Must be a work/school org (not `common`); personal accounts can't read Teams chat. |

**LLM provider API keys** are *not* env vars — enter them in the in-app Settings
panel (stored locally in the `llm_providers` table).

---

## Plugins used

| Plugin | Purpose |
| --- | --- |
| `tauri-plugin-sql` (sqlite) | Local database `sqlite:assistant.db`, with versioned migrations. |
| `tauri-plugin-store` | Stores the stable local user id + one-time setup flags. (LLM API keys live in the DB's `llm_providers` table.) |
| `tauri-plugin-http` | Calls LLM-provider & Google/Microsoft APIs from Rust transport (no browser CORS). |
| `tauri-plugin-dialog` / `tauri-plugin-fs` | File picker + read/write (PDF/doc task extraction, plan export). |
| `@choochmeque/tauri-plugin-google-auth` | Desktop Google OAuth (PKCE + loopback redirect + refresh). |
| `tauri-plugin-oauth` | Loopback redirect listener for Microsoft (Teams) OAuth (PKCE flow runs in TS). |
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

## Microsoft Teams setup

Teams reads your **1:1 direct messages and @mentions** through Microsoft Graph. This is a separate
connection from Google, with its own app registration. It's **optional** — the app works without it.

> **Work/school accounts only.** Microsoft Graph does **not** allow reading Teams chat messages with a
> *personal* Microsoft account. The account you connect must be an organizational (Entra) one, and you
> must register the app in that organization's directory.

### 1. Create the app registration

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com) (or the Azure Portal →
   **Microsoft Entra ID**) → **App registrations** → **New registration**.
2. **Name:** anything, e.g. `Personal Assistant`.
3. **Supported account types:** *Accounts in this organizational directory only (single tenant)*.
4. **Redirect URI:** choose platform **Public client/native (mobile & desktop)** and enter
   `http://localhost`. (The app uses a loopback redirect on a dynamically chosen port; Microsoft
   matches that against the bare `http://localhost`.)
5. Click **Register**.

### 2. Copy the IDs into `.env`

On the app's **Overview** page, copy:

| Portal field | `.env` variable |
| --- | --- |
| **Application (client) ID** | `VITE_MS_CLIENT_ID` |
| **Directory (tenant) ID** | `VITE_MS_TENANT` |

> Use the **tenant ID** (a GUID), not `common` — personal-account sign-in isn't supported here.

### 3. Allow the public-client (PKCE) flow

**Authentication** → scroll to **Advanced settings** → **Allow public client flows** → set to **Yes** →
**Save**. (This app is a public client and uses PKCE with no client secret — so you do **not** create a
client secret.)

### 4. Add the API permissions

**API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**, then add:

- `Chat.Read` — read your 1:1 and group chat messages
- `User.Read` — identify the signed-in user (needed to match @mentions)
- `offline_access` — issue a refresh token so the connection auto-renews
- `openid`, `profile`, `email` — basic sign-in

If your org requires it, click **Grant admin consent for &lt;org&gt;** (otherwise you'll be asked to
consent the first time you connect).

### 5. Connect in the app

Run the app, open **Settings (⚙)**, and click **Connect Teams**. A browser window opens for Microsoft
sign-in + consent; once you finish, the tokens are stored locally in `microsoft_tokens`.

---

## Database schema

Migrations live in `src-tauri/src/lib.rs` (declared to the SQL plugin; the
queries themselves are all in `src/lib/*.ts`). Migrations are append-only and
versioned — never edit an existing one; add a new version. Tables:

- `users` — the single local user (Google/Microsoft email & name are display labels only).
- `google_tokens` / `microsoft_tokens` — OAuth tokens (one row per user each).
- `goals` — todolist goals (progress, done, plan, start/target dates, task_total, granularity, note, `discarded` soft-delete flag).
- `calendar` — local commitments not synced to Google (date, time, source, done, `goal_id`, `span` = week/month, note, `discarded`).
- `plans` — researched plan documents (day/week/month entries with resources/links) linked to a goal.
- `memories` — durable facts/preferences.
- `messages` — the current chat session.
- `briefings` — one daily briefing per `(user_id, date)`.
- `inbox_scans` — cached daily inbox-task scan per `(user_id, date)`.
- `llm_providers` — configurable providers (Claude/GPT/DeepSeek/Qwen): key, model, base URL, web-search support, which one is active.

---

## Project structure

```
src/
  App.tsx                 Orchestrator: auth, expand/collapse, tray+timer events, plan generation
  components/
    SignInScreen · GoalTracker · BriefingPanel · ChatPanel · Settings
    LocalCalendar · Archive (Completed + Discarded) · PlanOptionsModal (cadence + resources pop-up)
    PlanDayEditor · LinkifiedText · PencilIcon
  lib/
    db.ts                 Database.load + typed query helpers
    auth.ts               Google sign-in, token upsert, getValidAccessToken()
    msAuth.ts             Microsoft (Teams) OAuth: signInMicrosoft · getValidMsAccessToken
    google.ts             getTodayEvents · getPendingEmails · createEvent
    teams.ts teamsTasks.ts   Teams DMs/@mentions + Inbox task extraction
    emailTasks.ts fileTasks.ts   Inbox scan + PDF/doc → task extraction
    llm.ts                Unified provider adapter (Anthropic + OpenAI-compatible), getActiveAdapter()
    providers.ts          llm_providers table (key/model/active provider)
    anthropic.ts          Anthropic Messages API — used for web-search plans (chat({webSearch}))
    gptSearch.ts          OpenAI Responses API web_search (GPT plans)
    planning.ts           generatePlan — cadence-aware, researched OR schedule-only; saves a goal
    plans.ts planExport.ts   plan documents (CRUD, edit-a-day, Markdown export)
    chat.ts               memory-aware prompt, persistence, fenced-block actions
    goals.ts localCalendar.ts memory.ts briefing.ts   CRUD wrappers over db.ts
    distill.ts            summarize a chat into durable memories on close
    init.ts store.ts errors.ts openExternal.ts types.ts
src-tauri/
  src/lib.rs              Shell: migrations, tray, window sizing, daily timer
  src/main.rs
  tauri.conf.json         Frameless, alwaysOnTop, skipTaskbar window
  capabilities/default.json
  vendor/tauri-plugin-google-auth/   Local patched OAuth plugin (offline-access refresh token)
```

---

## Security & scope notes

- Your LLM-provider API keys and all Google/Microsoft tokens stay on the local
  machine. `.env`, `settings.json`, and `*.db` are gitignored — never commit secrets.
- **Single user, one account per service.** Exactly one Google (Gmail/Calendar)
  account and one Microsoft (Teams) account can be connected at a time;
  connecting a different one replaces it (your local data is keyed to a stable
  local id, so it's never reset by switching accounts). Multi-account is out of
  scope for now.
- Deletions are recoverable: × soft-deletes to the Archive's **Discarded** area;
  only "Delete forever" there is permanent.
- No push notifications or scheduled emails (out of scope for now).
