import { useState } from "react";
import type { PlanDay, PlanResource } from "../lib/types";

interface DraftResource {
  kind: string;
  title: string;
  url: string;
}

const inputClass =
  "selectable w-full rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-sans text-sm text-ink transition focus:border-gold focus:outline-none";
const dateClass =
  "selectable rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-mono text-[11px] text-ink/70 transition focus:border-gold focus:outline-none";

/**
 * Inline editor for one learning-plan day (date, topic, task, practice, est.
 * time, and resource links). Shared by the goal-side and task-side editors so
 * editing a plan day behaves identically wherever you start it. Persistence is
 * the caller's job (via plans.savePlanDay) — this only collects the new PlanDay.
 */
export default function PlanDayEditor({
  day,
  onSave,
  onCancel,
}: {
  day: PlanDay;
  onSave: (next: PlanDay) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(day.date);
  const [topic, setTopic] = useState(day.topic ?? "");
  const [task, setTask] = useState(day.task ?? "");
  const [practice, setPractice] = useState(day.practice ?? "");
  const [est, setEst] = useState(day.est_time ?? "");
  const [resources, setResources] = useState<DraftResource[]>(
    (day.resources ?? []).map((r) => ({
      kind: r.kind ?? "doc",
      title: r.title ?? "",
      url: r.url ?? "",
    }))
  );

  function setResource(i: number, field: "title" | "url", value: string) {
    setResources((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r))
    );
  }

  function build(): PlanDay {
    const res: PlanResource[] = resources
      .filter((r) => r.title.trim() || r.url.trim())
      .map((r) => ({ kind: r.kind || "doc", title: r.title.trim(), url: r.url.trim() }));
    return {
      date: date || day.date,
      topic,
      task,
      practice: practice || undefined,
      est_time: est || undefined,
      resources: res.length ? res : undefined,
    };
  }

  return (
    <div className="space-y-1.5 rounded-md border border-gold/40 bg-gold/5 p-1.5">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className={`${dateClass} w-full`}
      />
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Topic"
        className={inputClass}
      />
      <input
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Task"
        className={inputClass}
      />
      <input
        value={practice}
        onChange={(e) => setPractice(e.target.value)}
        placeholder="Practice (optional)"
        className={inputClass}
      />
      <input
        value={est}
        onChange={(e) => setEst(e.target.value)}
        placeholder="Est. time, e.g. 2h (optional)"
        className={inputClass}
      />
      <div>
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink/45">
          Resources
        </span>
        {resources.map((r, ri) => (
          <div key={ri} className="mt-1 flex items-center gap-1.5">
            <input
              value={r.title}
              onChange={(e) => setResource(ri, "title", e.target.value)}
              placeholder="Title"
              className={`${inputClass} flex-1`}
            />
            <input
              value={r.url}
              onChange={(e) => setResource(ri, "url", e.target.value)}
              placeholder="https://…"
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => setResources((prev) => prev.filter((_, x) => x !== ri))}
              aria-label="Remove resource"
              className="shrink-0 font-mono text-ink/30 hover:text-ink/60"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setResources((prev) => [...prev, { kind: "doc", title: "", url: "" }])
          }
          className="mt-1 font-mono text-[10px] uppercase tracking-wide text-gold-deep hover:underline"
        >
          + resource
        </button>
      </div>
      <div className="flex items-center justify-end gap-3 pt-0.5">
        <button
          onClick={onCancel}
          className="font-sans text-xs text-ink/50 transition hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={() => void onSave(build())}
          className="rounded-full bg-ink px-3 py-1 font-sans text-xs font-medium text-cream transition hover:bg-gold-deep"
        >
          Save
        </button>
      </div>
    </div>
  );
}
