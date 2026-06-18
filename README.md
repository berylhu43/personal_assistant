# Personal Assistant

A desktop, memo-style dashboard that acts as a proactive personal assistant.

- **Left panel** — a daily briefing on ruled "paper": today's & tomorrow's calendar, emails that need action, and a goal tracker.
- **Right panel** — a multi-turn chat with an assistant that knows your day, helps break goals into weekly plans, surfaces dependencies/reminders, and can add events straight to your calendar.

Built with Next.js 14 (App Router), TypeScript, Tailwind CSS, the Anthropic SDK (server-side only), and Google Calendar + Gmail via NextAuth (Google OAuth 2.0).

---

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev
```

Open http://localhost:3000 and sign in with Google.

---

## Environment variables

Create `.env.local` with:

| Variable | What it is |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key. Used only on the server. |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret. |
| `NEXTAUTH_SECRET` | Random secret for NextAuth. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | App base URL, e.g. `http://localhost:3000`. |

Get an Anthropic key at <https://console.anthropic.com/>.

---

## Setting up Google OAuth credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create (or select) a project.
2. **Enable the APIs.** APIs & Services → **Library** → enable both:
   - **Google Calendar API**
   - **Gmail API**
3. **Configure the OAuth consent screen.** APIs & Services → **OAuth consent screen**:
   - User type: **External** (fine for personal use).
   - Add your Google account under **Test users** (required while the app is unverified).
   - Add the following **scopes**:
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `https://www.googleapis.com/auth/calendar.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/gmail.readonly`
4. **Create credentials.** APIs & Services → **Credentials** → **Create Credentials** → **OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** `http://localhost:3000`
   - **Authorized redirect URIs:** `http://localhost:3000/api/auth/callback/google`
   - Copy the **Client ID** and **Client secret** into `.env.local`.

> When you deploy, add your production origin and `https://YOUR_DOMAIN/api/auth/callback/google` as an authorized redirect URI, and set `NEXTAUTH_URL` to the production URL.

### Scopes requested by this app

| Scope | Why |
| --- | --- |
| `calendar.readonly` | Read today's & tomorrow's events for the briefing. |
| `calendar.events` | Create events the assistant proposes. |
| `gmail.readonly` | Find unread/starred threads from the last 48h that need action. |
| `openid email profile` | Basic sign-in and your display name. |

---

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/chat` | POST | `{ messages, calendarEvents, pendingEmails }` → assistant reply (Claude, server-side). |
| `/api/calendar/today` | GET | Today's + tomorrow's events. |
| `/api/gmail/pending` | GET | Unread/starred inbox threads from the last 48h, with a heuristic action tag. |
| `/api/calendar/add-event` | POST | `{ title, date, startTime?, endTime?, description? }` → creates a calendar event. |

The chat model is `claude-sonnet-4-6`. When it proposes scheduling time, it emits a fenced ` ```add-event ` JSON block; the chat UI turns that into a one-click **Add to calendar** button.

---

## Project structure

```
app/
  api/
    auth/[...nextauth]/route.ts   NextAuth (Google OAuth + token refresh)
    chat/route.ts                 Anthropic chat
    calendar/today/route.ts       Read events
    calendar/add-event/route.ts   Create event
    gmail/pending/route.ts        Read action-needed email
  layout.tsx, page.tsx, providers.tsx, globals.css
components/
  BriefingPanel.tsx  ChatPanel.tsx  GoalTracker.tsx  SignInScreen.tsx
lib/
  auth.ts  google.ts  types.ts
types/
  next-auth.d.ts
```

---

## Notes & current scope

- **Goals** persist in `localStorage` only (no database yet).
- Single-user; no push notifications or scheduled emails yet.
- The Anthropic API key never reaches the browser — all model calls go through `/api/chat`.
