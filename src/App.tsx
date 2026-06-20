import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import * as auth from "./lib/auth";
import { getApiKey } from "./lib/store";
import { getTodayEvents, getPendingEmails } from "./lib/google";
import { getBriefing, generateBriefing } from "./lib/briefing";
import type { User, CalendarEvent, PendingEmail, Briefing } from "./lib/types";

import SignInScreen from "./components/SignInScreen";
import GoalTracker from "./components/GoalTracker";
import BriefingPanel from "./components/BriefingPanel";
import ChatPanel from "./components/ChatPanel";
import Settings from "./components/Settings";

type Status = "loading" | "signed-out" | "ready";

async function setWindowExpanded(expanded: boolean) {
  try {
    await invoke("set_expanded", { expanded });
  } catch {
    /* dev in browser: ignore */
  }
}

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emails, setEmails] = useState<PendingEmail[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [goalsRefresh, setGoalsRefresh] = useState(0);

  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const loadDayData = useCallback(async (u: User) => {
    setLoadingBriefing(true);
    const [ev, em, br] = await Promise.all([
      getTodayEvents().catch(() => [] as CalendarEvent[]),
      getPendingEmails().catch(() => [] as PendingEmail[]),
      getBriefing(u.id).catch(() => null),
    ]);
    setEvents(ev);
    setEmails(em);
    setBriefing(br);
    setLoadingBriefing(false);
  }, []);

  const finishSignIn = useCallback(
    async (u: User) => {
      setUser(u);
      setStatus("ready");
      await loadDayData(u);
      const key = await getApiKey();
      if (!key) setShowSettings(true);
    },
    [loadDayData]
  );

  // Initial load: restore an existing session if present.
  useEffect(() => {
    auth
      .getCurrentUser()
      .then((u) => {
        if (u) void finishSignIn(u);
        else setStatus("signed-out");
      })
      .catch(() => setStatus("signed-out"));
  }, [finishSignIn]);

  // Toggle expand/collapse (shared by UI button + tray).
  const toggleExpanded = useCallback(async (next: boolean) => {
    setExpanded(next);
    await setWindowExpanded(next);
  }, []);

  // Tray + daily-timer events from the Rust shell.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    listen<boolean>("expanded-changed", (e) => setExpanded(e.payload)).then(
      (u) => unlisteners.push(u)
    );

    listen("briefing-due", async () => {
      const u = userRef.current;
      if (!u) return;
      setLoadingBriefing(true);
      try {
        const existing = await getBriefing(u.id);
        const br = existing ?? (await generateBriefing(u.id));
        setBriefing(br);
        await loadDayData(u);
      } finally {
        setLoadingBriefing(false);
      }
      await toggleExpanded(true);
    }).then((u) => unlisteners.push(u));

    listen("briefing-end", () => {
      void toggleExpanded(false);
    }).then((u) => unlisteners.push(u));

    return () => unlisteners.forEach((u) => u());
  }, [loadDayData, toggleExpanded]);

  async function handleSignIn() {
    const u = await auth.signIn();
    await finishSignIn(u);
  }

  async function handleSignOut() {
    await auth.signOut();
    setUser(null);
    setEvents([]);
    setEmails([]);
    setBriefing(null);
    setStatus("signed-out");
    await toggleExpanded(false);
  }

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Drag handle / header — Tauri uses the data attribute, not CSS app-region */}
      <header
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-ink/10 bg-cream px-3 py-2"
      >
        <div className="flex items-center gap-2">
          {status === "ready" && (
            <button
              onClick={() => void toggleExpanded(!expanded)}
              className="no-drag flex h-6 w-6 items-center justify-center rounded-md text-ink/60 hover:bg-ink/5 hover:text-ink"
              aria-label={expanded ? "Collapse" : "Expand"}
              title={expanded ? "Collapse" : "Expand chat"}
            >
              {expanded ? "‹" : "›"}
            </button>
          )}
          <span className="font-serif text-sm text-ink">{dateStr}</span>
        </div>
        {status === "ready" && (
          <div className="no-drag flex items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink/50 hover:bg-ink/5 hover:text-ink"
              aria-label="Settings"
              title="Settings"
            >
              ⚙
            </button>
            <button
              onClick={() => void handleSignOut()}
              className="px-1 font-sans text-[11px] text-ink/40 hover:text-ink/70"
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {status === "loading" && (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-serif text-xl text-ink/40">Loading…</p>
          </div>
        )}

        {status === "signed-out" && (
          <div className="flex-1">
            <SignInScreen onSignIn={handleSignIn} />
          </div>
        )}

        {status === "ready" && user && (
          <>
            {/* Memo column — todolist, always visible */}
            <section
              className={`ruled-paper margin-line h-full overflow-y-auto slim-scroll px-4 py-4 pl-10 ${
                expanded ? "w-[340px] shrink-0" : "w-full"
              }`}
            >
              <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-gold">
                Goals
              </p>
              <div className="mt-2">
                <GoalTracker userId={user.id} refreshKey={goalsRefresh} />
              </div>
            </section>

            {/* Chat column — only when expanded */}
            {expanded && (
              <section className="flex flex-1 flex-col overflow-hidden border-l border-ink/10">
                <BriefingPanel
                  briefing={briefing}
                  events={events}
                  emails={emails}
                  loading={loadingBriefing}
                />
                <div className="min-h-0 flex-1">
                  <ChatPanel
                    userId={user.id}
                    events={events}
                    emails={emails}
                    onGoalCreated={() => setGoalsRefresh((n) => n + 1)}
                    onNeedApiKey={() => setShowSettings(true)}
                  />
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSaved={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
