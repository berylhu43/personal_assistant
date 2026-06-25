import { useCallback, useEffect, useState } from "react";
import {
  listGoals,
  createGoal,
  updateGoal,
  setGoalProgress,
  setGoalDone,
  setGoalGranularity,
  setGoalTaskTotal,
  deleteGoal,
} from "../lib/goals";
import {
  createCommitment,
  listByGoal,
  updateCommitment,
  setTasksDoneByGoal,
} from "../lib/localCalendar";
import { getPlanByGoal, updatePlanContent } from "../lib/plans";
import { openExternal } from "../lib/openExternal";
import LinkifiedText from "./LinkifiedText";
import PencilIcon from "./PencilIcon";
import type { Goal, PlanDay, PlanResource, Commitment } from "../lib/types";

interface DraftResource {
  kind: string;
  title: string;
  url: string;
}

// On completion, an item shows its green/crossed state, then fades out and is
// removed — so checking it off feels deliberate rather than an instant vanish.
const FADE_START_MS = 800;
const REMOVE_MS = 1150;

/** A goal has expandable detail if it has a note, a weekly plan, or linked tasks. */
function hasDetails(g: Goal): boolean {
  return (
    !!(g.note && g.note.trim()) ||
    (g.plan != null && g.plan.length > 0) ||
    g.taskTotal > 0
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** "2026-07-01" → "Jul 1". */
function formatTarget(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Date label for a goal row: a range when both dates are set, else whichever exists. */
function formatRange(start: string | null, end: string | null): string | null {
  if (start && end) return `${formatTarget(start)}–${formatTarget(end)}`;
  if (end) return formatTarget(end);
  if (start) return `from ${formatTarget(start)}`;
  return null;
}

interface DraftTask {
  title: string;
  date: string;
  note: string;
}

export default function GoalTracker({
  userId,
  refreshKey,
  onTasksChanged,
}: {
  userId: string;
  refreshKey: number;
  onTasksChanged?: () => void;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  // Ids mid-completion: kept visible (crossed/green) during the linger, and
  // fadingIds get the opacity transition just before removal.
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  // Cache of loaded plan documents (LLM learning-plan goals) by goal id.
  const [planDocs, setPlanDocs] = useState<Record<string, PlanDay[]>>({});
  // Cache of linked daily tasks (manual goals, which have no plan document).
  const [linkedTasks, setLinkedTasks] = useState<Record<string, Commitment[]>>({});

  // ---- Add composer state ----
  const [title, setTitle] = useState("");
  const [aEnd, setAEnd] = useState("");
  const [aStart, setAStart] = useState("");
  const [aNote, setANote] = useState("");
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([]);
  const [stTitle, setStTitle] = useState("");
  const [stDate, setStDate] = useState("");
  const [stDetail, setStDetail] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);

  // ---- Inline edit state (one goal at a time) ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");
  const [eNote, setENote] = useState("");

  // ---- Inline edit state for a goal's linked task (one at a time) ----
  const [teId, setTeId] = useState<string | null>(null);
  const [teTitle, setTeTitle] = useState("");
  const [teDate, setTeDate] = useState("");
  const [teNote, setTeNote] = useState("");

  // ---- Inline edit state for an LLM plan-document day (one at a time) ----
  // pdKey is `${goalId}|${originalDate}` so we can locate the day to replace.
  const [pdKey, setPdKey] = useState<string | null>(null);
  const [pdGoalId, setPdGoalId] = useState("");
  const [pdOrigDate, setPdOrigDate] = useState("");
  const [pdDate, setPdDate] = useState("");
  const [pdTopic, setPdTopic] = useState("");
  const [pdTask, setPdTask] = useState("");
  const [pdPractice, setPdPractice] = useState("");
  const [pdEst, setPdEst] = useState("");
  const [pdResources, setPdResources] = useState<DraftResource[]>([]);

  async function toggleOpen(goal: Goal) {
    const willOpen = openPlan !== goal.id;
    setOpenPlan(willOpen ? goal.id : null);
    if (willOpen && planDocs[goal.id] === undefined && goal.taskTotal > 0) {
      try {
        const row = await getPlanByGoal(goal.id);
        const days = row ? (JSON.parse(row.content) as PlanDay[]) : [];
        const list = Array.isArray(days) ? days : [];
        setPlanDocs((m) => ({ ...m, [goal.id]: list }));
        // No LLM plan document → it's a manual goal; show its linked daily tasks.
        if (list.length === 0) {
          const tasks = await listByGoal(goal.id);
          setLinkedTasks((m) => ({ ...m, [goal.id]: tasks }));
        }
      } catch {
        setPlanDocs((m) => ({ ...m, [goal.id]: [] }));
      }
    }
  }

  const refresh = useCallback(() => {
    listGoals(userId).then(setGoals).catch(() => setGoals([]));
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  function addDraftTask() {
    const t = stTitle.trim();
    const d = stDate || aStart || todayKey();
    if (!t) return;
    setDraftTasks((prev) => [...prev, { title: t, date: d, note: stDetail }]);
    setStTitle("");
    setStDetail("");
    setStDate(d);
  }

  function removeDraftTask(i: number) {
    setDraftTasks((prev) => prev.filter((_, idx) => idx !== i));
  }

  function resetComposer() {
    setTitle("");
    setAEnd("");
    setAStart("");
    setANote("");
    setDraftTasks([]);
    setStTitle("");
    setStDate("");
    setStDetail("");
    setComposerOpen(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const goalId = await createGoal({
      userId,
      title: t,
      startDate: aStart || null,
      targetDate: aEnd || null,
      note: aNote,
    });
    // Wire dated sub-tasks as linked daily tasks — same shape as LLM goals, so
    // they surface in Upcoming and drive the goal's progress.
    if (draftTasks.length > 0) {
      for (const st of draftTasks) {
        await createCommitment({
          userId,
          title: st.title,
          date: st.date,
          time: null,
          source: "goal",
          goalId,
          note: st.note,
        });
      }
      await setGoalGranularity(goalId, "daily");
      await setGoalTaskTotal(goalId, draftTasks.length);
      onTasksChanged?.();
    }
    resetComposer();
    refresh();
  }

  function startEdit(g: Goal) {
    setEditingId(g.id);
    setETitle(g.title);
    setEStart(g.startDate ?? "");
    setEEnd(g.targetDate ?? "");
    setENote(g.note ?? "");
    setOpenPlan(null);
  }

  async function saveEdit(g: Goal) {
    await updateGoal(g.id, {
      title: eTitle.trim() || g.title,
      startDate: eStart || null,
      targetDate: eEnd || null,
      note: eNote,
    });
    setEditingId(null);
    refresh();
  }

  function startTaskEdit(t: Commitment) {
    setTeId(t.id);
    setTeTitle(t.title);
    setTeDate(t.date);
    setTeNote(t.note ?? "");
  }

  async function saveTaskEdit(goalId: string, t: Commitment) {
    await updateCommitment(t.id, {
      title: teTitle.trim() || t.title,
      date: teDate || t.date,
      note: teNote,
    });
    setTeId(null);
    // Reload this goal's linked tasks, and refresh the Upcoming panel (same row).
    const tasks = await listByGoal(goalId);
    setLinkedTasks((m) => ({ ...m, [goalId]: tasks }));
    onTasksChanged?.();
  }

  function startDayEdit(goalId: string, d: PlanDay) {
    setPdKey(`${goalId}|${d.date}`);
    setPdGoalId(goalId);
    setPdOrigDate(d.date);
    setPdDate(d.date);
    setPdTopic(d.topic ?? "");
    setPdTask(d.task ?? "");
    setPdPractice(d.practice ?? "");
    setPdEst(d.est_time ?? "");
    setPdResources(
      (d.resources ?? []).map((r) => ({
        kind: r.kind ?? "doc",
        title: r.title ?? "",
        url: r.url ?? "",
      }))
    );
  }

  function setResource(i: number, field: "title" | "url", value: string) {
    setPdResources((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r))
    );
  }

  /**
   * Save an edited plan day: rewrite the plan JSON AND sync the matching daily
   * task (commitment, joined by date) so the change reflects in Upcoming too.
   */
  async function saveDayEdit() {
    const goalId = pdGoalId;
    const origDate = pdOrigDate;
    const row = await getPlanByGoal(goalId);
    if (!row) {
      setPdKey(null);
      return;
    }
    let days: PlanDay[] = [];
    try {
      const parsed = JSON.parse(row.content);
      days = Array.isArray(parsed) ? parsed : [];
    } catch {
      days = [];
    }
    const resources: PlanResource[] = pdResources
      .filter((r) => r.title.trim() || r.url.trim())
      .map((r) => ({ kind: r.kind || "doc", title: r.title.trim(), url: r.url.trim() }));
    const newDay: PlanDay = {
      date: pdDate || origDate,
      topic: pdTopic,
      task: pdTask,
      practice: pdPractice || undefined,
      est_time: pdEst || undefined,
      resources: resources.length ? resources : undefined,
    };
    const idx = days.findIndex((d) => d.date === origDate);
    if (idx >= 0) days[idx] = newDay;
    else days.push(newDay);
    days.sort((a, b) => a.date.localeCompare(b.date));

    await updatePlanContent(row.id, JSON.stringify(days));

    // Keep the linked daily task (matched by the old date) in sync.
    const tasks = await listByGoal(goalId);
    const c = tasks.find((t) => t.date === origDate);
    if (c) {
      const title = (newDay.topic || newDay.task || c.title).slice(0, 120);
      await updateCommitment(c.id, { title, date: newDay.date });
    }

    setPlanDocs((m) => ({ ...m, [goalId]: days }));
    setPdKey(null);
    onTasksChanged?.();
  }

  async function toggle(g: Goal) {
    if (g.done) {
      // Un-completing (rare — completed goals are hidden after the linger).
      await setGoalDone(g.id, false);
      refresh();
      return;
    }
    // Optimistic green + cross-out; complete the goal AND its linked tasks.
    setGoals((prev) =>
      prev.map((x) => (x.id === g.id ? { ...x, done: true, progress: 100 } : x))
    );
    setCompletingIds((p) => new Set(p).add(g.id));
    await setGoalDone(g.id, true);
    await setTasksDoneByGoal(g.id, true);
    onTasksChanged?.(); // linked tasks drop out of Upcoming
    // Linger → fade → remove.
    window.setTimeout(
      () => setFadingIds((p) => new Set(p).add(g.id)),
      FADE_START_MS
    );
    window.setTimeout(() => {
      setCompletingIds((p) => {
        const n = new Set(p);
        n.delete(g.id);
        return n;
      });
      setFadingIds((p) => {
        const n = new Set(p);
        n.delete(g.id);
        return n;
      });
      refresh();
    }, REMOVE_MS);
  }

  async function progress(g: Goal, value: number) {
    setGoals((prev) =>
      prev.map((x) => (x.id === g.id ? { ...x, progress: value } : x))
    );
    await setGoalProgress(g.id, value);
  }

  async function remove(id: string) {
    await deleteGoal(id);
    refresh();
  }

  const inputClass =
    "selectable w-full rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-sans text-sm text-ink transition focus:border-gold focus:outline-none";
  const dateClass =
    "selectable rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-mono text-[11px] text-ink/70 transition focus:border-gold focus:outline-none";

  // Hide completed goals once their linger ends (still in DB as done=1).
  const visibleGoals = goals.filter(
    (g) => !g.done || completingIds.has(g.id)
  );

  return (
    <div>
      <ul className="space-y-3.5">
        {visibleGoals.map((goal) => {
          const range = formatRange(goal.startDate, goal.targetDate);
          return (
            <li
              key={goal.id}
              className={`group transition-opacity duration-300 ${
                fadingIds.has(goal.id) ? "opacity-0" : ""
              }`}
            >
              {editingId === goal.id ? (
                /* ---- Inline edit form ---- */
                <div className="space-y-1.5 rounded-lg border border-gold/40 bg-gold/5 p-2">
                  <input
                    value={eTitle}
                    onChange={(e) => setETitle(e.target.value)}
                    placeholder="Goal"
                    className={inputClass}
                  />
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink/45">
                      Start
                    </span>
                    <input
                      type="date"
                      value={eStart}
                      onChange={(e) => setEStart(e.target.value)}
                      className={`${dateClass} flex-1`}
                    />
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink/45">
                      End
                    </span>
                    <input
                      type="date"
                      value={eEnd}
                      onChange={(e) => setEEnd(e.target.value)}
                      className={`${dateClass} flex-1`}
                    />
                  </div>
                  <textarea
                    value={eNote}
                    onChange={(e) => setENote(e.target.value)}
                    placeholder="Detail — how to approach it, links…"
                    rows={3}
                    className={`${inputClass} resize-none`}
                  />
                  <div className="flex items-center justify-end gap-3 pt-0.5">
                    <button
                      onClick={() => setEditingId(null)}
                      className="font-sans text-xs text-ink/50 transition hover:text-ink"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void saveEdit(goal)}
                      className="rounded-full bg-ink px-3 py-1 font-sans text-xs font-medium text-cream transition hover:bg-gold-deep"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                /* ---- Normal row ---- */
                <>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggle(goal)}
                      aria-label={goal.done ? "Mark not done" : "Mark done"}
                      className={`h-[18px] w-[18px] shrink-0 rounded-[6px] border transition ${
                        goal.done
                          ? "border-done bg-done"
                          : "border-ink/25 hover:border-gold"
                      }`}
                    />
                    <span
                      onClick={() => {
                        if (hasDetails(goal)) void toggleOpen(goal);
                      }}
                      title={hasDetails(goal) ? "Click to view detail" : undefined}
                      className={`flex-1 truncate font-sans text-sm ${
                        goal.done ? "text-ink/40 line-through" : "text-ink"
                      } ${hasDetails(goal) ? "cursor-pointer hover:text-gold-deep" : ""}`}
                    >
                      {goal.title}
                    </span>
                    {goal.plan && goal.plan.length > 0 && (
                      <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-gold-deep">
                        {goal.plan.length}wk
                      </span>
                    )}
                    {range && (
                      <span className="shrink-0 font-mono text-[10px] text-ink/40">
                        {range}
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink/45">
                      {goal.progress}%
                    </span>
                    <button
                      onClick={() => startEdit(goal)}
                      aria-label="Edit goal"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/35 opacity-0 transition hover:bg-ink/5 hover:text-gold-deep group-hover:opacity-100"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      onClick={() => remove(goal.id)}
                      aria-label="Remove goal"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-base leading-none text-ink/35 opacity-0 transition hover:bg-ink/5 hover:text-ink/70 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>

                  {goal.taskTotal > 0 ? (
                    <div
                      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink/10"
                      title={`${goal.progress}% — from completed daily tasks`}
                    >
                      <div
                        className="h-full rounded-full transition-[width] duration-300"
                        style={{
                          width: `${goal.progress}%`,
                          backgroundColor: goal.done ? "#1D9E75" : "#D4A853",
                        }}
                      />
                    </div>
                  ) : (
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={goal.progress}
                      onChange={(e) => progress(goal, Number(e.target.value))}
                      className="goal-range mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full"
                      style={{
                        background: `linear-gradient(to right, ${
                          goal.done ? "#1D9E75" : "#D4A853"
                        } ${goal.progress}%, rgba(28,28,30,0.1) ${goal.progress}%)`,
                      }}
                    />
                  )}

                  {openPlan === goal.id && (
                    <div className="mt-2 border-l border-gold/40 pl-3">
                      {goal.note && goal.note.trim() && (
                        <div className="mb-1.5">
                          <LinkifiedText text={goal.note} />
                        </div>
                      )}

                      {goal.plan && goal.plan.length > 0 && (
                        <ul className="space-y-1">
                          {goal.plan.map((p) => (
                            <li
                              key={p.week}
                              className="font-sans text-xs leading-snug text-ink/65"
                            >
                              <span className="font-mono text-[10px] uppercase text-gold-deep">
                                W{p.week}
                              </span>{" "}
                              {p.focus}
                            </li>
                          ))}
                        </ul>
                      )}

                      {planDocs[goal.id]?.length ? (
                        <ul className="space-y-2">
                          {planDocs[goal.id].map((d, i) =>
                            pdKey === `${goal.id}|${d.date}` ? (
                              /* ---- Inline plan-day edit ---- */
                              <li key={i}>
                                <div className="space-y-1.5 rounded-md border border-gold/40 bg-gold/5 p-1.5">
                                  <input
                                    type="date"
                                    value={pdDate}
                                    onChange={(e) => setPdDate(e.target.value)}
                                    className={`${dateClass} w-full`}
                                  />
                                  <input
                                    value={pdTopic}
                                    onChange={(e) => setPdTopic(e.target.value)}
                                    placeholder="Topic"
                                    className={inputClass}
                                  />
                                  <input
                                    value={pdTask}
                                    onChange={(e) => setPdTask(e.target.value)}
                                    placeholder="Task"
                                    className={inputClass}
                                  />
                                  <input
                                    value={pdPractice}
                                    onChange={(e) => setPdPractice(e.target.value)}
                                    placeholder="Practice (optional)"
                                    className={inputClass}
                                  />
                                  <input
                                    value={pdEst}
                                    onChange={(e) => setPdEst(e.target.value)}
                                    placeholder="Est. time, e.g. 2h (optional)"
                                    className={inputClass}
                                  />
                                  <div>
                                    <span className="font-mono text-[10px] uppercase tracking-wide text-ink/45">
                                      Resources
                                    </span>
                                    {pdResources.map((r, ri) => (
                                      <div
                                        key={ri}
                                        className="mt-1 flex items-center gap-1.5"
                                      >
                                        <input
                                          value={r.title}
                                          onChange={(e) =>
                                            setResource(ri, "title", e.target.value)
                                          }
                                          placeholder="Title"
                                          className={`${inputClass} flex-1`}
                                        />
                                        <input
                                          value={r.url}
                                          onChange={(e) =>
                                            setResource(ri, "url", e.target.value)
                                          }
                                          placeholder="https://…"
                                          className={`${inputClass} flex-1`}
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setPdResources((prev) =>
                                              prev.filter((_, x) => x !== ri)
                                            )
                                          }
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
                                        setPdResources((prev) => [
                                          ...prev,
                                          { kind: "doc", title: "", url: "" },
                                        ])
                                      }
                                      className="mt-1 font-mono text-[10px] uppercase tracking-wide text-gold-deep hover:underline"
                                    >
                                      + resource
                                    </button>
                                  </div>
                                  <div className="flex items-center justify-end gap-3 pt-0.5">
                                    <button
                                      onClick={() => setPdKey(null)}
                                      className="font-sans text-xs text-ink/50 transition hover:text-ink"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => void saveDayEdit()}
                                      className="rounded-full bg-ink px-3 py-1 font-sans text-xs font-medium text-cream transition hover:bg-gold-deep"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              </li>
                            ) : (
                              /* ---- Read-only plan day ---- */
                              <li key={i} className="group/day leading-snug">
                                <p className="flex items-center gap-1.5 font-sans text-xs text-ink/80">
                                  <span className="font-mono text-[10px] text-gold-deep">
                                    {d.date}
                                  </span>
                                  <span className="min-w-0 flex-1">{d.topic}</span>
                                  <button
                                    onClick={() => startDayEdit(goal.id, d)}
                                    aria-label="Edit day"
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/35 opacity-0 transition hover:bg-ink/5 hover:text-gold-deep group-hover/day:opacity-100"
                                  >
                                    <PencilIcon size={13} />
                                  </button>
                                </p>
                                {d.task && (
                                  <p className="font-sans text-[11px] text-ink/55">
                                    {d.task}
                                  </p>
                                )}
                                {d.practice && (
                                  <p className="font-sans text-[11px] text-ink/45">
                                    Practice: {d.practice}
                                  </p>
                                )}
                                {d.resources?.length ? (
                                  <ul className="mt-0.5 space-y-1">
                                    {d.resources.map((r, j) => (
                                      <li
                                        key={j}
                                        className="selectable font-mono text-[10px] leading-snug text-ink/55"
                                      >
                                        {r.title} —{" "}
                                        <button
                                          onClick={() => void openExternal(r.url)}
                                          className="break-all text-left text-gold-deep underline-offset-2 hover:underline"
                                          title="Open in browser"
                                        >
                                          {r.url}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </li>
                            )
                          )}
                        </ul>
                      ) : null}

                      {/* Manual goal: its linked daily tasks (date, title, detail) */}
                      {!planDocs[goal.id]?.length &&
                      linkedTasks[goal.id]?.length ? (
                        <ul className="space-y-2">
                          {linkedTasks[goal.id].map((t) =>
                            teId === t.id ? (
                              /* ---- Inline task edit ---- */
                              <li key={t.id}>
                                <div className="space-y-1.5 rounded-md border border-gold/40 bg-gold/5 p-1.5">
                                  <input
                                    value={teTitle}
                                    onChange={(e) => setTeTitle(e.target.value)}
                                    placeholder="Task"
                                    className={inputClass}
                                  />
                                  <input
                                    type="date"
                                    value={teDate}
                                    onChange={(e) => setTeDate(e.target.value)}
                                    className={`${dateClass} w-full`}
                                  />
                                  <textarea
                                    value={teNote}
                                    onChange={(e) => setTeNote(e.target.value)}
                                    placeholder="Detail — how-to, links…"
                                    rows={2}
                                    className={`${inputClass} resize-none`}
                                  />
                                  <div className="flex items-center justify-end gap-3 pt-0.5">
                                    <button
                                      onClick={() => setTeId(null)}
                                      className="font-sans text-xs text-ink/50 transition hover:text-ink"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => void saveTaskEdit(goal.id, t)}
                                      className="rounded-full bg-ink px-3 py-1 font-sans text-xs font-medium text-cream transition hover:bg-gold-deep"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              </li>
                            ) : (
                              /* ---- Read-only task row ---- */
                              <li key={t.id} className="group/task leading-snug">
                                <p className="flex items-center gap-1.5 font-sans text-xs text-ink/80">
                                  <span className="font-mono text-[10px] text-gold-deep">
                                    {t.date}
                                  </span>
                                  <span className="min-w-0 flex-1">{t.title}</span>
                                  <button
                                    onClick={() => startTaskEdit(t)}
                                    aria-label="Edit task"
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/35 opacity-0 transition hover:bg-ink/5 hover:text-gold-deep group-hover/task:opacity-100"
                                  >
                                    <PencilIcon size={13} />
                                  </button>
                                </p>
                                {t.note && t.note.trim() && (
                                  <LinkifiedText text={t.note} />
                                )}
                              </li>
                            )
                          )}
                        </ul>
                      ) : null}

                      {!(goal.plan && goal.plan.length > 0) &&
                        !planDocs[goal.id]?.length &&
                        !linkedTasks[goal.id]?.length &&
                        goal.taskTotal > 0 && (
                          <p className="font-sans text-[11px] italic text-ink/40">
                            {planDocs[goal.id] === undefined
                              ? "Loading…"
                              : "Daily tasks appear in Upcoming as their dates arrive."}
                          </p>
                        )}
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
        {visibleGoals.length === 0 && (
          <li className="font-sans text-[13px] italic text-ink/35">
            No goals yet. Add one below, or ask the assistant.
          </li>
        )}
      </ul>

      {/* ---- Add composer ---- */}
      <form onSubmit={add} className="no-drag mt-4">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a goal…"
            className="selectable min-w-0 flex-1 border-b border-ink/15 bg-transparent pb-1 font-sans text-sm text-ink transition placeholder:text-ink/30 focus:border-gold focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setComposerOpen((o) => !o)}
            aria-label="More options"
            title="Dates, detail & daily tasks"
            className={`shrink-0 rounded-full px-2 py-1 font-mono text-[11px] transition ${
              composerOpen
                ? "bg-gold/20 text-gold-deep"
                : "bg-ink/5 text-ink/45 hover:text-gold-deep"
            }`}
          >
            ⋯
          </button>
          <button
            type="submit"
            className="shrink-0 rounded-full bg-ink/5 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-gold-deep transition hover:bg-gold hover:text-cream"
          >
            Add
          </button>
        </div>

        {composerOpen && (
          <div className="mt-2 space-y-2 rounded-lg border border-ink/15 bg-white/40 p-2.5">
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink/45">
                Start
              </span>
              <input
                type="date"
                value={aStart}
                onChange={(e) => setAStart(e.target.value)}
                className={`${dateClass} flex-1`}
              />
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink/45">
                End
              </span>
              <input
                type="date"
                value={aEnd}
                onChange={(e) => setAEnd(e.target.value)}
                className={`${dateClass} flex-1`}
              />
            </div>

            <textarea
              value={aNote}
              onChange={(e) => setANote(e.target.value)}
              placeholder="Detail — how to approach it, links…"
              rows={2}
              className={`${inputClass} resize-none`}
            />

            <div>
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink/45">
                Daily tasks
              </span>
              {draftTasks.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {draftTasks.map((t, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 font-sans text-xs text-ink/70"
                    >
                      <span className="font-mono text-[10px] text-gold-deep">
                        {formatTarget(t.date)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {t.note.trim() && (
                        <span
                          title="Has detail"
                          className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-gold-deep"
                        >
                          detail
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeDraftTask(i)}
                        aria-label="Remove task"
                        className="font-mono text-ink/30 hover:text-ink/60"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={stTitle}
                  onChange={(e) => setStTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDraftTask();
                    }
                  }}
                  placeholder="A task for a day…"
                  className={`${inputClass} flex-1`}
                />
                <input
                  type="date"
                  value={stDate}
                  onChange={(e) => setStDate(e.target.value)}
                  className={dateClass}
                />
                <button
                  type="button"
                  onClick={addDraftTask}
                  className="shrink-0 rounded-full bg-ink/5 px-2.5 py-1 font-mono text-[11px] font-bold text-gold-deep transition hover:bg-gold hover:text-cream"
                >
                  ＋
                </button>
              </div>
              <textarea
                value={stDetail}
                onChange={(e) => setStDetail(e.target.value)}
                placeholder="Task detail — how-to, links (optional)"
                rows={2}
                className={`${inputClass} mt-1 resize-none`}
              />
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
