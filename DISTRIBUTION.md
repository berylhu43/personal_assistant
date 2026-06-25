# DISTRIBUTION.md — turning this into a downloadable app

Status: **planning notes, not yet started.** This captures what it would take to ship the assistant as a
downloadable desktop app (instead of "clone the repo + bring your own OAuth credentials"). Nothing here
is implemented; it's a roadmap to revisit. Targets **Google + Microsoft Teams**; Slack is deferred (and
changes the architecture — see §6).

---

## 1. The key insight: Google + Teams need NO backend

Both Google (installed-app flow) and Microsoft/Entra (public client) support **OAuth with PKCE and no
confidential secret**. That means the current **local-first, loopback-redirect** architecture
(`tauri-plugin-oauth` listener + PKCE/token-exchange in TS — see `src/lib/msAuth.ts`) works as-is for a
distributed app. No server, no token proxy, no hosting.

> This is only true because Slack is deferred. Slack has no PKCE and requires a client secret for token
> exchange, which a shipped binary can't protect — that forces a backend. See §6.

What stays per-user and on-device: SQLite, the Anthropic calls (each user enters their own key in
Settings), inbox scanning, memory. The app never phones home.

---

## 2. The model shift

| | Today (dev / clone the repo) | Downloadable app |
| --- | --- | --- |
| OAuth apps | Each user registers their own Google project + Azure app | **You** register ONE app per provider, verified, shipped |
| Credentials | Each user's `.env` (gitignored) | Your client IDs **baked into the build** (via CI secrets) |
| Trust | "unverified app" warning, manual test-users | Verified publisher; any user can connect their own account |

Client IDs that ship in the binary:
- **Microsoft:** `VITE_MS_CLIENT_ID` only — public client, **no secret**. Safe to embed.
- **Google:** `VITE_GOOGLE_CLIENT_ID` + the **Desktop-app** client secret, which Google explicitly does
  *not* treat as confidential for installed apps. Acceptable to embed (standard installed-app model).

---

## 3. Workstream A — Auth & registrations

### Microsoft / Teams
- [ ] Set app registration to **Multiple Entra ID tenants** (Supported account types).
- [ ] Set `VITE_MS_TENANT=organizations` so any org's work/school account can reach it.
- [ ] Complete **publisher verification** (one-time) to remove the "unverified" label.
- [ ] Implement the **admin-consent flow** (see §5 — the one unavoidable Teams hurdle).
- Scopes already requested (delegated): `openid profile email offline_access User.Read Chat.Read`
  (see `MS_SCOPES` in `src/lib/msAuth.ts`).

### Google
- [ ] Change OAuth client type from **Web application** → **Desktop app** (installed-app, PKCE, loopback).
- [ ] Publish to **Production** and pass **OAuth verification**.
- [ ] ⚠️ DECIDE on `gmail.readonly`: it's a **restricted** scope → publishing requires an annual
      third-party **CASA security assessment** (significant time + cost). Options: pay for CASA, make
      Gmail optional, or cut Gmail from the public v1. Calendar scopes are "sensitive" (lighter brand
      review, no CASA). Current scopes in `src/lib/auth.ts` (`SCOPES`).
- Note: the Google secret is currently embedded via the vendored plugin path; that's fine for the
  installed-app model.

---

## 4. Workstream B — Packaging, signing, updates (the actual "downloadable" work)

Mostly new, independent of auth.

- [ ] **Build installers:** `npm run tauri build` → `.dmg`/`.app` (macOS), `.msi`/`.exe` (Windows).
- [ ] **Code-sign + notarize** (without this, users hit Gatekeeper / SmartScreen blocks):
  - macOS: **Apple Developer Program** ($99/yr) → Developer ID signing + notarization.
  - Windows: a code-signing certificate (OV/EV).
- [ ] **Auto-updates:** add the **Tauri updater plugin** + a signed release feed (GitHub Releases is fine).
- [ ] **CI build with secrets:** inject `VITE_GOOGLE_CLIENT_ID` / `VITE_MS_CLIENT_ID` (+ Google desktop
      secret) as CI secrets at build time. The Anthropic key remains per-user (Settings, never bundled).
- [ ] Loopback redirect (`http://localhost`, dynamic port) already works per end-user machine — no change.

---

## 5. Workstream C — The Teams org-consent reality (cannot be engineered away)

Every downloading user whose organization restricts app consent (e.g. universities like UChicago) will
hit an **"admin approval required"** wall. Distribution does NOT fix this — it's that org's IT policy.

What we *can* build:
- [ ] **Admin-consent flow:** surface the Microsoft admin-consent URL
      (`https://login.microsoftonline.com/{tenant}/adminconsent?client_id=...`) so an IT admin can
      approve the app **org-wide once**, after which all that org's users connect freely.
- [ ] **Graceful UX:** detect the approval-required / consent error and tell the user "ask your IT admin
      to approve this app" (with the link), instead of a dead end.

Publisher verification (Workstream A) helps with orgs that allow consent only for *verified* publishers,
but does nothing for orgs that mandate admin consent for everything.

---

## 6. Slack (deferred) — why it changes everything

When Slack is added, the no-backend property breaks:
- Slack OAuth v2 has **no PKCE** and requires `client_secret` for `oauth.v2.access` → the secret can't
  ship in the binary.
- Slack requires **HTTPS redirect URLs** in production (no loopback).

So Slack requires a **thin backend** that: holds the secret, does code→token exchange + refresh, and
hands tokens back to the app (via a custom URI scheme deep link or one-time-code polling). Keep that
backend OAuth-only — message content and user data should still be processed locally. Once that backend
exists, Google/Teams *can* route through it too for uniformity (optional; they don't need to).

Suggested phasing:
- **Phase 1:** Google + Teams, fully client-side. Proves the signing/notarization/updater pipeline.
- **Phase 2:** stand up the OAuth backend, add Slack.

---

## 7. Open decisions (revisit before starting)

1. **Gmail scope** — keep + pay for CASA, make optional, or cut for public v1? (Biggest cost driver.)
2. **OS targets** — macOS only, or Windows too? (Each needs its own signing setup.)
3. **Apple Developer Program** enrollment ($99/yr) — required for a distributable Mac app.
4. **Publisher verification** — Microsoft (and later, Slack app review).
5. **Update channel** — GitHub Releases vs self-hosted.

---

## 8. What's actually code (vs. portal/cert/process work)

Most of the lift above is portal config, certificates, and verification *process*. The genuine code
changes are small:
- Tauri **updater plugin** wiring + release config.
- Teams **admin-consent helper** + approval-required UX (§5).
- Possibly gating Gmail behind a flag if it's cut/optional (§3).

Everything else (registrations, CASA, signing certs, notarization, publisher verification) is account/
process work done outside the codebase.
