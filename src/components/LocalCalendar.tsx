import { useCallback, useEffect, useState } from "react";
import {
  listUpcoming,
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

  const refresh = useCallback(() => {
    listUpcoming(userId).then(setItems).catch(() => setItems([]));
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
      <p className="font-sans text-sm italic text-ink/35">
        No upcoming commitments.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {items.map((c) => {
        const overdue = c.date < today;
        return (
          <li key={c.id} className="group flex items-start gap-2">
            <button
              onClick={() => toggle(c)}
              aria-label={c.done ? "Mark not done" : "Mark done"}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition ${
                c.done ? "border-done bg-done text-cream" : "border-ink/30"
              }`}
            >
              {c.done && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2.5 6.5L5 9l4.5-5.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-sm text-ink">{c.title}</p>
              <p
                className={`font-sans text-[11px] ${
                  overdue ? "font-medium text-gold" : "text-ink/45"
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
              className="text-ink/25 opacity-0 transition group-hover:opacity-100 hover:text-ink/60"
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
