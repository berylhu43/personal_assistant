import { useState } from "react";
import type { PlanGranularity } from "../lib/store";

export interface PlanOptions {
  granularity: PlanGranularity;
  customCadence?: string;
  withResources: boolean;
}

const CADENCES: { key: PlanGranularity; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "custom", label: "Other" },
];

/**
 * The plan-options pop-up: the user picks a schedule cadence and whether to
 * include researched resources/links, then the app generates + saves the plan.
 * Shown after the assistant emits a `plan-request`. Collects choices only —
 * generation is the caller's job (App.runPlan → generatePlan).
 */
export default function PlanOptionsModal({
  topic,
  suggested,
  updating = false,
  onSubmit,
  onCancel,
}: {
  topic: string;
  // The cadence the assistant proposed (pre-selected; the user can change it).
  suggested?: "daily" | "weekly" | "monthly";
  // True when regenerating an existing goal's plan (vs. creating a new one).
  updating?: boolean;
  onSubmit: (opts: PlanOptions) => void;
  onCancel: () => void;
}) {
  const [granularity, setGranularity] = useState<PlanGranularity>(
    suggested ?? "daily"
  );
  const [customCadence, setCustomCadence] = useState("");
  const [withResources, setWithResources] = useState(true);

  function submit() {
    onSubmit({
      granularity,
      customCadence: granularity === "custom" ? customCadence.trim() : undefined,
      withResources,
    });
  }

  const canSubmit = granularity !== "custom" || customCadence.trim().length > 0;

  return (
    <div className="no-drag absolute inset-0 z-20 flex items-center justify-center bg-ink/30 px-5 backdrop-blur-[1px]">
      <div className="w-full max-w-sm rounded-2xl border border-ink/10 bg-cream p-4 shadow-memo">
        <p className="eyebrow mb-0.5">{updating ? "Update plan" : "Plan options"}</p>
        <p className="mb-3 truncate font-sans text-sm font-medium text-ink" title={topic}>
          {topic}
        </p>

        {/* Cadence */}
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-ink/45">
          Schedule
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {CADENCES.map((c) => (
            <button
              key={c.key}
              onClick={() => setGranularity(c.key)}
              className={`rounded-lg border px-2 py-1.5 font-sans text-xs transition ${
                granularity === c.key
                  ? "border-gold bg-gold/15 text-gold-deep"
                  : "border-ink/15 bg-white/60 text-ink/60 hover:border-gold/50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {granularity === "custom" && (
          <input
            value={customCadence}
            onChange={(e) => setCustomCadence(e.target.value)}
            placeholder="e.g. every other day, twice a week"
            className="selectable mt-2 w-full rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-sans text-sm text-ink transition focus:border-gold focus:outline-none"
          />
        )}

        {/* Resources */}
        <p className="mb-1.5 mt-4 font-mono text-[10px] uppercase tracking-wide text-ink/45">
          Resources &amp; links
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setWithResources(true)}
            className={`rounded-lg border px-2 py-1.5 font-sans text-xs transition ${
              withResources
                ? "border-gold bg-gold/15 text-gold-deep"
                : "border-ink/15 bg-white/60 text-ink/60 hover:border-gold/50"
            }`}
          >
            Yes — research links
          </button>
          <button
            onClick={() => setWithResources(false)}
            className={`rounded-lg border px-2 py-1.5 font-sans text-xs transition ${
              !withResources
                ? "border-gold bg-gold/15 text-gold-deep"
                : "border-ink/15 bg-white/60 text-ink/60 hover:border-gold/50"
            }`}
          >
            No — just a schedule
          </button>
        </div>
        <p className="mt-1.5 font-sans text-[11px] leading-snug text-ink/40">
          {withResources
            ? "Searches the web for real resources — takes a bit longer (Claude or GPT only)."
            : "Quick schedule from the model's own knowledge — no links."}
        </p>

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="font-sans text-xs text-ink/50 transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-full bg-ink px-3.5 py-1.5 font-sans text-xs font-medium text-cream transition hover:bg-gold-deep disabled:opacity-40 disabled:hover:bg-ink"
          >
            {updating ? "Update plan" : "Create plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
