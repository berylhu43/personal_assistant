import { useCallback, useEffect, useRef, useState } from "react";
import {
  listThroughTomorrow,
  listLaterThisWeek,
  createCommitment,
  updateCommitment,
  setCommitmentDone,
  deleteCommitment,
} from "../lib/localCalendar";
import { getPlanByGoal, savePlanDay } from "../lib/plans";
import { openExternal } from "../lib/openExternal";
import LinkifiedText from "./LinkifiedText";
import PencilIcon from "./PencilIcon";
import PlanDayEditor from "./PlanDayEditor";
import type { Commitment, PlanDay } from "../lib/types";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Week of Jun 22 – Jun 28" for a weekly task (Monday → Sunday). */
function formatWeek(weekStart: string): string {
  return `Week of ${formatDay(weekStart)} – ${formatDay(addDays(weekStart, 6))}`;
}

// On completion, a task shows its crossed-out state, then fades out and is
// removed — matching the goals panel.
const FADE_START_MS = 800;
const REMOVE_MS = 1150;

export default function LocalCalendar({
  userId,
  refreshKey,
  onTaskToggled,
}: {
  userId: string;
  refreshKey: number;
  onTaskToggled?: () => void;
}) {
  const [items, setItems] = useState<Commitment[]>([]);
  // Single (non-plan) commitments due later this week — surfaced so a one-off
  // due Thursday isn't hidden until the day before.
  const [later, setLater] = useState<Commitment[]>([]);
  // Ids fading out just before removal (the opacity transition). Completing
  // tasks stay rendered via their optimistic done flag until the removal refresh.
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayKey());
  // Add composer: optional time + detail on first add.
  const [addTime, setAddTime] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  // The plan-day detail matched to each expanded task (undefined = not loaded).
  const [dayById, setDayById] = useState<Record<string, PlanDay | null>>({});
  // Cache of full plan documents by goal id, so sibling days don't refetch.
  const docCache = useRef<Map<string, PlanDay[]>>(new Map());

  // Inline edit state (one task at a time).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eDate, setEDate] = useState("");
  const [eTime, setETime] = useState("");
  const [eNote, setENote] = useState("");
  // When the edited task is backed by a plan-day, edit that rich detail instead.
  const [editPlanDay, setEditPlanDay] = useState<PlanDay | null>(null);
  const [editGoalId, setEditGoalId] = useState<string | null>(null);

  /** A task is expandable if it has a note or a linked plan day. */
  function expandable(c: Commitment): boolean {
    return !!(c.note && c.note.trim()) || !!c.goalId;
  }

  // Load (and cache) a task's plan-day detail from its goal's plan document.
  const loadDayDetail = useCallback(async (c: Commitment) => {
    if (!c.goalId) return;
    try {
      let days = docCache.current.get(c.goalId);
      if (!days) {
        const row = await getPlanByGoal(c.goalId);
        const parsed = row ? (JSON.parse(row.content) as PlanDay[]) : [];
        days = Array.isArray(parsed) ? parsed : [];
        docCache.current.set(c.goalId, days);
      }
      const day = days.find((d) => d.date === c.date) ?? null;
      setDayById((m) => ({ ...m, [c.id]: day }));
    } catch {
      setDayById((m) => ({ ...m, [c.id]: null }));
    }
  }, []);

  async function toggleExpand(c: Commitment) {
    if (!expandable(c)) return;
    const willOpen = !expanded.has(c.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
      return next;
    });
    if (willOpen && c.goalId && dayById[c.id] === undefined) {
      void loadDayDetail(c);
    }
  }

  const refresh = useCallback(() => {
    listThroughTomorrow(userId).then(setItems).catch(() => setItems([]));
    listLaterThisWeek(userId).then(setLater).catch(() => setLater([]));
  }, [userId]);

  useEffect(() => {
    refresh();
    // An external refresh (refreshKey) may include plan-day edits — drop cached
    // plan docs + matched detail so expanded tasks re-load fresh content.
    docCache.current.clear();
    setDayById({});
  }, [refresh, refreshKey]);

  // Keep expanded tasks' plan-day detail loaded — re-fetches after the cache is
  // cleared above, so an edit made elsewhere shows live without re-toggling.
  useEffect(() => {
    const all = [...items, ...later];
    for (const id of expanded) {
      const c = all.find((x) => x.id === id);
      if (c && c.goalId && dayById[c.id] === undefined) {
        void loadDayDetail(c);
      }
    }
  }, [items, later, expanded, dayById, loadDayDetail]);

  async function toggle(c: Commitment) {
    if (c.done) {
      await setCommitmentDone(c.id, false);
      refresh();
      onTaskToggled?.();
      return;
    }
    // Optimistic cross-out, then linger → fade → remove.
    const mark = (x: Commitment) => (x.id === c.id ? { ...x, done: true } : x);
    setItems((prev) => prev.map(mark));
    setLater((prev) => prev.map(mark));
    await setCommitmentDone(c.id, true);
    onTaskToggled?.(); // a linked task may move its goal's progress
    window.setTimeout(
      () => setFadingIds((p) => new Set(p).add(c.id)),
      FADE_START_MS
    );
    window.setTimeout(() => {
      setFadingIds((p) => {
        const n = new Set(p);
        n.delete(c.id);
        return n;
      });
      refresh();
    }, REMOVE_MS);
  }

  async function remove(id: string) {
    await deleteCommitment(id);
    refresh();
  }

  // Fetch the plan-day that backs a goal-linked task (matched by date), if any.
  async function getPlanDayFor(c: Commitment): Promise<PlanDay | null> {
    if (!c.goalId) return null;
    let days = docCache.current.get(c.goalId);
    if (!days) {
      try {
        const row = await getPlanByGoal(c.goalId);
        const parsed = row ? (JSON.parse(row.content) as PlanDay[]) : [];
        days = Array.isArray(parsed) ? parsed : [];
        docCache.current.set(c.goalId, days);
      } catch {
        days = [];
      }
    }
    return days.find((d) => d.date === c.date) ?? null;
  }

  async function startEdit(c: Commitment) {
    setEditingId(c.id);
    setETitle(c.title);
    setEDate(c.date);
    setETime(c.time ?? "");
    setENote(c.note ?? "");
    setEditPlanDay(null);
    setEditGoalId(null);
    // If this task is backed by a plan-day (study plan), edit that rich detail
    // (description + practice + links) instead of just the note.
    const day = await getPlanDayFor(c);
    if (day && c.goalId) {
      setEditPlanDay(day);
      setEditGoalId(c.goalId);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditPlanDay(null);
    setEditGoalId(null);
  }

  async function saveEdit(c: Commitment) {
    await updateCommitment(c.id, {
      title: eTitle.trim() || c.title,
      // Weekly tasks anchor on their Monday; leave that date alone here.
      date: c.span === "week" ? c.date : eDate || c.date,
      time: eTime || null,
      note: eNote,
    });
    setEditingId(null);
    refresh();
  }

  // Save the plan-day detail edited from a task: rewrite the plan doc + sync the
  // task (shared helper), invalidate caches so both panels show the new detail.
  async function savePlanDayFromTask(next: PlanDay) {
    if (!editGoalId || !editPlanDay) return;
    await savePlanDay(editGoalId, editPlanDay.date, next);
    docCache.current.delete(editGoalId);
    setDayById({});
    cancelEdit();
    refresh();
    onTaskToggled?.(); // let the goals panel pick up the change too
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    await createCommitment({
      userId,
      title: t,
      date: date || todayKey(),
      time: addTime || null,
      source: "manual",
      note: addNote,
    });
    setTitle("");
    setAddTime("");
    setAddNote("");
    setAddOpen(false);
    refresh();
  }

  const today = todayKey();

  const editInput =
    "selectable w-full rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-sans text-sm text-ink transition focus:border-gold focus:outline-none";

  function renderTask(c: Commitment) {
    if (editingId === c.id) {
      // Plan-backed task: edit the rich plan-day detail (description + links).
      if (editPlanDay) {
        return (
          <li key={c.id}>
            <PlanDayEditor
              day={editPlanDay}
              onSave={(next) => void savePlanDayFromTask(next)}
              onCancel={cancelEdit}
            />
          </li>
        );
      }
      return (
        <li key={c.id}>
          <div className="space-y-1.5 rounded-lg border border-gold/40 bg-gold/5 p-2">
            <input
              value={eTitle}
              onChange={(e) => setETitle(e.target.value)}
              placeholder="Task"
              className={editInput}
            />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={eDate}
                disabled={c.span === "week"}
                onChange={(e) => setEDate(e.target.value)}
                className="selectable flex-1 rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-mono text-[11px] text-ink/70 transition focus:border-gold focus:outline-none disabled:opacity-50"
              />
              <input
                type="time"
                value={eTime}
                onChange={(e) => setETime(e.target.value)}
                className="selectable shrink-0 rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-mono text-[11px] text-ink/70 transition focus:border-gold focus:outline-none"
              />
            </div>
            <textarea
              value={eNote}
              onChange={(e) => setENote(e.target.value)}
              placeholder="Detail — how to do it, links…"
              rows={3}
              className={`${editInput} resize-none`}
            />
            <div className="flex items-center justify-end gap-3 pt-0.5">
              <button
                onClick={() => setEditingId(null)}
                className="font-sans text-xs text-ink/50 transition hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveEdit(c)}
                className="rounded-full bg-ink px-3 py-1 font-sans text-xs font-medium text-cream transition hover:bg-gold-deep"
              >
                Save
              </button>
            </div>
          </div>
        </li>
      );
    }

    const isWeekly = c.span === "week";
    const overdue = isWeekly ? addDays(c.date, 6) < today : c.date < today;
    const canExpand = expandable(c);
    return (
      <li
        key={c.id}
        className={`group flex items-start gap-2.5 transition-opacity duration-300 ${
          fadingIds.has(c.id) ? "opacity-0" : ""
        }`}
      >
        <button
          onClick={() => toggle(c)}
          aria-label={c.done ? "Mark not done" : "Mark done"}
          className={`mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[6px] border transition ${
            c.done ? "border-done bg-done" : "border-ink/25 hover:border-gold"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p
            onClick={() => void toggleExpand(c)}
            title={canExpand ? "Click to expand" : undefined}
            className={`font-sans text-sm leading-snug ${
              c.done ? "text-ink/40 line-through" : "text-ink"
            } ${canExpand ? "cursor-pointer" : ""} ${
              expanded.has(c.id) ? "whitespace-normal break-words" : "truncate"
            }`}
          >
            {c.title}
          </p>
          <p
            className={`mt-0.5 font-mono text-[10px] uppercase tracking-wide ${
              overdue ? "font-bold text-gold-deep" : "text-ink/40"
            }`}
          >
            {isWeekly ? formatWeek(c.date) : formatDate(c.date)}
            {c.time ? ` · ${c.time}` : ""}
            {overdue ? " · overdue" : ""}
          </p>

          {/* Expanded detail: user's note + any linked plan-day detail */}
          {expanded.has(c.id) && (
            <div className="mt-1.5 border-l border-gold/40 pl-2.5">
              {c.note && c.note.trim() && (
                <div className="mb-1">
                  <LinkifiedText text={c.note} />
                </div>
              )}
              {dayById[c.id] && (
                <>
                  {dayById[c.id]!.task && (
                    <p className="font-sans text-[11px] leading-snug text-ink/65">
                      {dayById[c.id]!.task}
                    </p>
                  )}
                  {dayById[c.id]!.practice && (
                    <p className="font-sans text-[11px] leading-snug text-ink/55">
                      Practice: {dayById[c.id]!.practice}
                    </p>
                  )}
                  {dayById[c.id]!.est_time && (
                    <p className="font-mono text-[10px] text-ink/40">
                      {dayById[c.id]!.est_time}
                    </p>
                  )}
                  {dayById[c.id]!.resources?.length ? (
                    <ul className="mt-0.5 space-y-1">
                      {dayById[c.id]!.resources!.map((r, j) => (
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
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => void startEdit(c)}
          aria-label="Edit task"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/35 opacity-0 transition hover:bg-ink/5 hover:text-gold-deep group-hover:opacity-100"
        >
          <PencilIcon />
        </button>
        <button
          onClick={() => remove(c.id)}
          aria-label="Remove task"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-base leading-none text-ink/35 opacity-0 transition hover:bg-ink/5 hover:text-ink/70 group-hover:opacity-100"
        >
          ×
        </button>
      </li>
    );
  }

  return (
    <div>
      {items.length === 0 ? (
        <p className="font-sans text-[13px] italic text-ink/35">
          No upcoming tasks.
        </p>
      ) : (
        <ul className="space-y-2.5">{items.map(renderTask)}</ul>
      )}

      {later.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-ink/20" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-ink/40">
              Later this week
            </span>
          </div>
          <ul className="space-y-2.5 opacity-90">{later.map(renderTask)}</ul>
        </div>
      )}

      <form onSubmit={add} className="no-drag mt-4">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task…"
            className="selectable min-w-0 flex-1 border-b border-ink/15 bg-transparent pb-1 font-sans text-sm text-ink transition placeholder:text-ink/30 focus:border-gold focus:outline-none"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="selectable shrink-0 border-b border-ink/15 bg-transparent pb-1 font-mono text-[11px] text-ink/70 transition focus:border-gold focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            aria-label="More options"
            title="Time & detail"
            className={`shrink-0 rounded-full px-2 py-1 font-mono text-[11px] transition ${
              addOpen
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

        {addOpen && (
          <div className="mt-2 space-y-2 rounded-lg border border-ink/15 bg-white/40 p-2.5">
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink/45">
                Time
              </span>
              <input
                type="time"
                value={addTime}
                onChange={(e) => setAddTime(e.target.value)}
                className="selectable rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-mono text-[11px] text-ink/70 transition focus:border-gold focus:outline-none"
              />
            </div>
            <textarea
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
              placeholder="Detail — how to do it, links…"
              rows={2}
              className="selectable w-full resize-none rounded-md border border-ink/20 bg-white/70 px-2 py-1 font-sans text-sm text-ink transition focus:border-gold focus:outline-none"
            />
          </div>
        )}
      </form>
    </div>
  );
}
