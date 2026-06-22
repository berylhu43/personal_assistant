import { useCallback, useEffect, useState } from "react";
import {
  listThroughTomorrow,
  setCommitmentDone,
  deleteCommitment,
} from "../lib/localCalendar";
import type { Commitment } from "../lib/types";

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

export default function LocalCalendar({
  userId,
  refreshKey,
}: {
  userId: string;
  refreshKey: number;
}) {
  const [items, setItems] = useState<Commitment[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const refresh = useCallback(() => {
    listThroughTomorrow(userId).then(setItems).catch(() => setItems([]));
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  async function toggle(c: Commitment) {
    await setCommitmentDone(c.id, !c.done);
    refresh();
  }

  async function remove(id: string) {
    await deleteCommitment(id);
    refresh();
  }

  const today = todayKey();

  if (items.length === 0) {
    return (
      <p className="font-sans text-[13px] italic text-ink/35">
        No upcoming commitments.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {items.map((c) => {
        const overdue = c.date < today;
        return (
          <li key={c.id} className="group flex items-start gap-2.5">
            <button
              onClick={() => toggle(c)}
              aria-label={c.done ? "Mark not done" : "Mark done"}
              className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition ${
                c.done
                  ? "border-done bg-done text-cream"
                  : "border-ink/25 hover:border-gold"
              }`}
            >
              {c.done && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2.5 6.5L5 9l4.5-5.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p
                onClick={() => toggleExpand(c.id)}
                title="Click to expand"
                className={`cursor-pointer font-sans text-sm leading-snug text-ink ${
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
                {formatDate(c.date)}
                {c.time ? ` · ${c.time}` : ""}
                {overdue ? " · overdue" : ""}
              </p>
            </div>
            <button
              onClick={() => remove(c.id)}
              aria-label="Remove commitment"
              className="text-base leading-none text-ink/25 opacity-0 transition group-hover:opacity-100 hover:text-ink/60"
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
