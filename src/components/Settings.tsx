import { useEffect, useState } from "react";
import {
  listProviders,
  setProviderKey,
  setActiveProvider,
} from "../lib/providers";
import { testProviderConnection } from "../lib/llm";
import {
  isTeamsConnected,
  signInMicrosoft,
  signOutMicrosoft,
} from "../lib/msAuth";
import { openExternal } from "../lib/openExternal";
import { friendlyError } from "../lib/errors";
import type { LlmProviderRow } from "../lib/types";

// Where each provider's keys are created — a one-click jump to reduce friction.
const CONSOLE_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
};

interface TestResult {
  state: "running" | "ok" | "fail";
  message?: string; // friendly explanation when state === "fail"
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<LlmProviderRow[] | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  const [teamsOn, setTeamsOn] = useState(false);
  const [teamsBusy, setTeamsBusy] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  async function loadProviders() {
    setProviders(await listProviders());
  }

  useEffect(() => {
    loadProviders();
    isTeamsConnected().then(setTeamsOn);
  }, []);

  const active = providers?.find((p) => p.is_active === 1) ?? null;
  const activeLacksSearch = !!active && active.supports_web_search !== 1;

  async function saveKey(id: string) {
    const key = (inputs[id] ?? "").trim();
    if (!key || savingId) return;
    setSavingId(id);
    try {
      await setProviderKey(id, key);
      setInputs((s) => ({ ...s, [id]: "" }));
      // Clear any stale test result for this provider (the key changed).
      setTests((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      await loadProviders();
    } finally {
      setSavingId(null);
    }
  }

  async function makeActive(id: string) {
    if (activatingId) return;
    setActivatingId(id);
    try {
      await setActiveProvider(id);
      await loadProviders();
    } finally {
      setActivatingId(null);
    }
  }

  async function testKey(p: LlmProviderRow) {
    const typed = (inputs[p.id] ?? "").trim();
    setTests((s) => ({ ...s, [p.id]: { state: "running" } }));
    try {
      await testProviderConnection(p, typed || undefined);
      setTests((s) => ({ ...s, [p.id]: { state: "ok" } }));
    } catch (e) {
      console.error("provider test failed:", e);
      setTests((s) => ({
        ...s,
        [p.id]: { state: "fail", message: friendlyError(e) },
      }));
    }
  }

  async function connectTeams() {
    if (teamsBusy) return;
    setTeamsBusy(true);
    setTeamsError(null);
    try {
      await signInMicrosoft();
      setTeamsOn(true);
    } catch (e) {
      console.error("Teams connect failed:", e);
      setTeamsError(friendlyError(e));
    } finally {
      setTeamsBusy(false);
    }
  }

  async function disconnectTeams() {
    if (teamsBusy) return;
    setTeamsBusy(true);
    setTeamsError(null);
    try {
      await signOutMicrosoft();
      setTeamsOn(false);
    } finally {
      setTeamsBusy(false);
    }
  }

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 px-6"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ backgroundColor: "#FBF7EF" }}
        className="no-drag rise max-h-[85vh] w-full max-w-sm overflow-y-auto slim-scroll rounded-2xl border border-ink/15 p-6 shadow-lift"
      >
        <span className="eyebrow">Settings</span>
        <h3 className="mt-1 font-serif text-2xl text-ink">Your keys</h3>
        <p className="mt-1.5 font-sans text-xs leading-relaxed text-ink/60">
          Your API keys are stored locally and never leave this machine. Pick
          which model the assistant uses.
        </p>

        {activeLacksSearch && (
          <p className="mt-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 font-sans text-xs leading-relaxed text-gold-deep">
            The study-plan feature is only available with Claude or GPT.
          </p>
        )}

        <div className="mt-4 space-y-2.5">
          {providers?.map((p) => {
            const isActive = p.is_active === 1;
            const hasKey = !!p.api_key;
            const test = tests[p.id];
            return (
              <div
                key={p.id}
                className={`rounded-xl border p-3 transition ${
                  isActive
                    ? "border-gold bg-gold/5"
                    : "border-ink/15 bg-white/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => void makeActive(p.id)}
                    disabled={!hasKey || isActive || !!activatingId}
                    title={
                      hasKey ? "Use this model" : "Set a key first"
                    }
                    className="group flex items-center gap-2 disabled:cursor-default"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                        isActive
                          ? "border-gold-deep"
                          : "border-ink/30 group-hover:border-gold-deep"
                      }`}
                    >
                      {isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-gold-deep" />
                      )}
                    </span>
                    <span className="font-serif text-base text-ink">
                      {p.display_name}
                    </span>
                  </button>
                  <span className="font-mono text-[9px] uppercase tracking-wide">
                    {isActive && (
                      <span className="mr-1.5 text-gold-deep">active</span>
                    )}
                    {hasKey ? (
                      <span className="text-done">··· set</span>
                    ) : (
                      <span className="text-ink/35">not set</span>
                    )}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="password"
                    value={inputs[p.id] ?? ""}
                    onChange={(e) =>
                      setInputs((s) => ({ ...s, [p.id]: e.target.value }))
                    }
                    placeholder={
                      hasKey ? "Enter a new key to replace" : "Paste API key"
                    }
                    style={{ backgroundColor: "#FFFFFF" }}
                    className="selectable focus-gold min-w-0 flex-1 rounded-lg border border-ink/20 px-2.5 py-1.5 font-mono text-xs text-ink transition"
                  />
                  <button
                    onClick={() => void saveKey(p.id)}
                    disabled={!(inputs[p.id] ?? "").trim() || savingId === p.id}
                    className="shrink-0 rounded-full bg-ink px-3 py-1.5 font-sans text-xs font-medium text-cream transition hover:bg-gold-deep disabled:opacity-40 disabled:hover:bg-ink"
                  >
                    {savingId === p.id ? "Saving…" : "Save"}
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={() => void testKey(p)}
                    disabled={
                      test?.state === "running" ||
                      (!hasKey && !(inputs[p.id] ?? "").trim())
                    }
                    className="font-mono text-[10px] uppercase tracking-wide text-ink/45 transition hover:text-gold-deep disabled:opacity-40 disabled:hover:text-ink/45"
                  >
                    {test?.state === "running" ? "Testing…" : "Test connection"}
                  </button>
                  {test?.state === "ok" && (
                    <span className="font-mono text-[10px] text-done">
                      ✓ works
                    </span>
                  )}
                  {CONSOLE_URLS[p.id] && (
                    <button
                      onClick={() => void openExternal(CONSOLE_URLS[p.id])}
                      className="ml-auto font-mono text-[10px] uppercase tracking-wide text-ink/45 transition hover:text-gold-deep"
                    >
                      Get a key ↗
                    </button>
                  )}
                </div>
                {test?.state === "fail" && (
                  <p className="mt-1.5 font-sans text-[11px] leading-relaxed text-red-700">
                    {test.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 border-t border-ink/10 pt-5">
          <label className="block font-mono text-[10px] uppercase tracking-wide text-ink/60">
            Microsoft Teams{" "}
            {teamsOn && <span className="text-done">· connected</span>}
          </label>
          <p className="mt-1.5 font-sans text-xs leading-relaxed text-ink/60">
            Lets the assistant see your recent 1:1 direct messages and @mentions.
            Work/school account required.
          </p>
          {teamsError && (
            <p className="mt-2 font-sans text-xs leading-relaxed text-red-700">
              {teamsError}
            </p>
          )}
          <button
            onClick={() => void (teamsOn ? disconnectTeams() : connectTeams())}
            disabled={teamsBusy}
            className={`mt-3 rounded-full px-4 py-2 font-sans text-sm font-medium transition disabled:opacity-40 ${
              teamsOn
                ? "border border-ink/20 text-ink/70 hover:border-ink/40 hover:text-ink"
                : "bg-ink text-cream shadow-memo hover:bg-gold-deep"
            }`}
          >
            {teamsBusy
              ? teamsOn
                ? "Disconnecting…"
                : "Connecting…"
              : teamsOn
              ? "Disconnect Teams"
              : "Connect Teams"}
          </button>
        </div>

        <div className="mt-8 flex items-center justify-end border-t border-ink/10 pt-5">
          <button
            onClick={onClose}
            className="rounded-full bg-ink px-6 py-2 font-sans text-sm font-medium text-cream shadow-memo transition hover:bg-gold-deep"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
