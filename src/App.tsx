import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import * as auth from "./lib/auth";
import { initApp } from "./lib/init";
import { getApiKey, type PendingPlan } from "./lib/store";
import { getTodayEvents, getPendingEmails } from "./lib/google";
import { getTeamsMessages } from "./lib/teams";
import { isTeamsConnected } from "./lib/msAuth";
import { getBriefing, getOrGenerateBriefing, generateBriefing } from "./lib/briefing";
import { generatePlan } from "./lib/planning";
import { addMessage, clearMessages } from "./lib/chat";
import { distillConversation } from "./lib/distill";
import type {
  User,
  CalendarEvent,
  PendingEmail,
  TeamsMessage,
  Briefing,
} from "./lib/types";

import SignInScreen from "./components/SignInScreen";
import GoalTracker from "./components/GoalTracker";
import LocalCalendar from "./components/LocalCalendar";
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

function GearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [emails, setEmails] = useState<PendingEmail[]>([]);
  const [teams, setTeams] = useState<TeamsMessage[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [goalsRefresh, setGoalsRefresh] = useState(0);
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  // Plan generation lives at App level so collapsing/unmounting the chat panel
  // can't interrupt it. `planResult` is the latest completed plan (for the
  // in-chat message + Download control).
  const [planning, setPlanning] = useState(false);
  const [planResult, setPlanResult] = useState<{
    reply: string;
    goalId: string | null;
  } | null>(null);
  // Adjustable width of the left memo column when expanded (persisted).
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("pa.leftWidth"));
    return saved >= 280 ? saved : 360;
  });

  const userRef = useRef<User | null>(null);
  userRef.current = user;

  // Drag the divider between the memo and chat panels.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(Math.max(ev.clientX, 280), window.innerWidth - 300);
      setLeftWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setLeftWidth((w) => {
        localStorage.setItem("pa.leftWidth", String(w));
        return w;
      });
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const loadDayData = useCallback(async (u: User) => {
    setLoadingBriefing(true);
    // generateBriefing is internally resilient (it falls back if Google/model
    // fail) and loadDayData only runs once signed in, so we always
    // get-or-generate rather than gating on the strict isGoogleConnected().
    const [ev, em, tm, br] = await Promise.all([
      getTodayEvents().catch(() => [] as CalendarEvent[]),
      getPendingEmails().catch(() => [] as PendingEmail[]),
      // Teams is an optional, separate connection — only fetch when connected.
      isTeamsConnected().then((on) =>
        on ? getTeamsMessages().catch(() => [] as TeamsMessage[]) : []
      ),
      getOrGenerateBriefing(u.id).catch((e) => {
        // Keep briefing failures visible rather than silently swallowing them.
        console.error("[briefing] load failed:", e);
        return null;
      }),
    ]);
    setEvents(ev);
    setEmails(em);
    setTeams(tm);
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

  // Initial load: ensure the local user + run one-time consolidation, then
  // decide the view based on whether Google is connected. The app always has a
  // local user, so data is never gated on (or reset by) Google login.
  useEffect(() => {
    (async () => {
      try {
        await initApp();
        const u = await auth.getCurrentUser();
        setUser(u);
        if (u && (await auth.isGoogleConnected())) {
          await finishSignIn(u);
        } else {
          setStatus("signed-out");
        }
      } catch {
        setStatus("signed-out");
      }
    })();
  }, [finishSignIn]);

  // Toggle expand/collapse (shared by UI button + tray).
  const toggleExpanded = useCallback(async (next: boolean) => {
    setExpanded(next);
    await setWindowExpanded(next);
  }, []);

  // Collapsing the chat distills the conversation into durable memory and clears
  // it — so every collapse is a clean save, not just the "End & save" button.
  // An effect on the expanded true→false transition catches ALL collapse paths
  // (header button, tray toggle, the 10:00 briefing-end). distillConversation is
  // a no-op when there are no messages, so an empty glance costs nothing.
  const prevExpandedRef = useRef(expanded);
  const distillingRef = useRef(false);
  useEffect(() => {
    const was = prevExpandedRef.current;
    prevExpandedRef.current = expanded;
    if (!was || expanded) return; // only run on a true → false transition
    const u = userRef.current;
    if (!u || distillingRef.current) return;
    distillingRef.current = true;
    (async () => {
      try {
        await distillConversation(u.id);
        await clearMessages(u.id);
        // Memory/goals/commitments may have changed — refresh the left panel.
        setGoalsRefresh((n) => n + 1);
        setCalendarRefresh((n) => n + 1);
      } catch (e) {
        // Keep the transcript for a later retry (next collapse or next launch).
        console.error("[collapse-distill] failed, keeping transcript:", e);
      } finally {
        distillingRef.current = false;
      }
    })();
  }, [expanded]);

  // Tray + daily-timer events from the Rust shell.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    listen<boolean>("expanded-changed", (e) => setExpanded(e.payload)).then(
      (u) => unlisteners.push(u)
    );

    listen("briefing-due", async () => {
      const u = userRef.current;
      if (!u || !(await auth.isGoogleConnected())) return;
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
    // Disconnect Google only — the local user (and its goals/memory/history)
    // stays intact.
    await auth.signOut();
    setEvents([]);
    setEmails([]);
    setTeams([]);
    setBriefing(null);
    setStatus("signed-out");
    await toggleExpanded(false);
  }

  // After a conversation is distilled & closed: refresh the left panel (goals +
  // commitments may have changed) and collapse back to the todo view.
  const handleCloseConversation = useCallback(async () => {
    setGoalsRefresh((n) => n + 1);
    setCalendarRefresh((n) => n + 1);
    await toggleExpanded(false);
  }, [toggleExpanded]);

  // Run a confirmed learning plan from App level so it survives the chat panel
  // collapsing/unmounting mid-generation. Persists the assistant reply, writes
  // the goal/tasks/plan, and refreshes the left panel — all regardless of the
  // expanded/collapsed state.
  const runPlan = useCallback(async (pending: PendingPlan) => {
    const u = userRef.current;
    console.log("[plan-debug] App.runPlan entry, user?", !!u, pending);
    if (!u) return;
    setPlanResult(null);
    setPlanning(true);
    try {
      const result = await generatePlan(u.id, pending);
      console.log("[plan-debug] App.runPlan done, ok =", result.ok);
      await addMessage(u.id, "assistant", result.reply);
      setPlanResult({ reply: result.reply, goalId: result.ok ? result.goalId ?? null : null });
      if (result.ok) {
        setGoalsRefresh((n) => n + 1);
        setCalendarRefresh((n) => n + 1);
      }
    } catch (e) {
      console.error("[plan-debug] runPlan failed:", e);
      setPlanResult({
        reply: `I couldn't build the plan — ${
          (e as Error)?.message ?? "the request failed"
        }.`,
        goalId: null,
      });
    } finally {
      setPlanning(false);
    }
  }, []);

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
        className="relative z-10 flex items-center justify-between gap-2 border-b border-ink/10 bg-paper/60 px-3 py-2 backdrop-blur-sm"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {status === "ready" && (
            <button
              onClick={() => void toggleExpanded(!expanded)}
              title={expanded ? "Collapse" : "Expand chat"}
              aria-label={expanded ? "Collapse" : "Expand"}
              className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink/45 transition hover:bg-ink/5 hover:text-ink"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`transition-transform duration-200 ${
                  expanded ? "" : "rotate-180"
                }`}
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="eyebrow text-[8px]">Today</span>
            <span className="truncate font-serif text-[15px] leading-none text-ink">
              {dateStr}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {status === "ready" && planning && (
            <div className="no-drag flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-gold-deep">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-gold" />
              Building…
            </div>
          )}
          {status === "ready" && (
            <div className="no-drag flex items-center gap-0.5">
              <button
                onClick={() => setShowSettings(true)}
                title="Settings"
                aria-label="Settings"
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink/45 transition hover:bg-ink/5 hover:text-ink"
              >
                <GearIcon />
              </button>
              <button
                onClick={() => void handleSignOut()}
                title="Sign out"
                aria-label="Sign out"
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink/45 transition hover:bg-ink/5 hover:text-ink"
              >
                <LogoutIcon />
              </button>
            </div>
          )}
        </div>
        {/* gold hairline accent */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent" />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {status === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <span className="h-2 w-2 animate-ping rounded-full bg-gold" />
            <p className="eyebrow animate-pulse">Opening your desk</p>
          </div>
        )}

        {status === "signed-out" && (
          <div className="flex-1">
            <SignInScreen onSignIn={handleSignIn} />
          </div>
        )}

        {status === "ready" && user && (
          <>
            {/* Memo column — always visible. Order: Briefing → Upcoming → Goals */}
            <section
              style={expanded ? { width: leftWidth } : undefined}
              className={`ruled-paper margin-line h-full overflow-y-auto slim-scroll ${
                expanded ? "shrink-0" : "w-full"
              }`}
            >
              {/* Briefing + Inbox — expanded only. Collapsed = tasks only. */}
              {expanded && (
                <BriefingPanel
                  briefing={briefing}
                  loading={loadingBriefing}
                  expanded={expanded}
                  userId={user.id}
                  onTaskAdded={() => {
                    setGoalsRefresh((n) => n + 1);
                    setCalendarRefresh((n) => n + 1);
                  }}
                />
              )}

              <div className="px-4 py-5 pl-10">
                <div
                  className="rise mb-2.5 flex items-center gap-1.5"
                  style={{ animationDelay: "60ms" }}
                >
                  <span className="h-1 w-1 rounded-full bg-gold" />
                  <span className="eyebrow">Upcoming Tasks</span>
                </div>
                <div className="rise" style={{ animationDelay: "90ms" }}>
                  <LocalCalendar
                    userId={user.id}
                    refreshKey={calendarRefresh}
                    onTaskToggled={() => setGoalsRefresh((n) => n + 1)}
                  />
                </div>

                {/* Goals — expanded only (collapsed shows briefing + upcoming) */}
                {expanded && (
                  <>
                    <div
                      className="rise mb-2.5 mt-9 flex items-center gap-1.5"
                      style={{ animationDelay: "120ms" }}
                    >
                      <span className="h-1 w-1 rounded-full bg-gold" />
                      <span className="eyebrow">Goals</span>
                    </div>
                    <div className="rise" style={{ animationDelay: "150ms" }}>
                      <GoalTracker
                        userId={user.id}
                        refreshKey={goalsRefresh}
                        onTasksChanged={() => setCalendarRefresh((n) => n + 1)}
                      />
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* Draggable divider */}
            {expanded && (
              <div
                onMouseDown={startResize}
                className="no-drag group relative z-10 w-1 shrink-0 cursor-col-resize bg-ink/10 transition hover:bg-gold/50"
                title="Drag to resize"
              >
                <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
              </div>
            )}

            {/* Chat column — only when expanded */}
            {expanded && (
              <section className="flex flex-1 flex-col overflow-hidden">
                <ChatPanel
                  userId={user.id}
                  events={events}
                  emails={emails}
                  teams={teams}
                  planning={planning}
                  planResult={planResult}
                  onPlanConfirmed={(pending) => void runPlan(pending)}
                  onGoalCreated={() => setGoalsRefresh((n) => n + 1)}
                  onCommitmentCreated={() => setCalendarRefresh((n) => n + 1)}
                  onNeedApiKey={() => setShowSettings(true)}
                  onClose={() => void handleCloseConversation()}
                />
              </section>
            )}
          </>
        )}
      </div>

      {showSettings && (
        <Settings onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
