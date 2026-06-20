import type { Briefing, CalendarEvent, PendingEmail } from "../lib/types";

const tagStyles: Record<string, string> = {
  "reply needed": "bg-gold/20 text-[#8a6a1f]",
  "prep needed": "bg-ink/10 text-ink",
  review: "bg-done/15 text-done",
  unread: "bg-ink/5 text-ink/60",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function BriefingPanel({
  briefing,
  events,
  emails,
  loading,
}: {
  briefing: Briefing | null;
  events: CalendarEvent[];
  emails: PendingEmail[];
  loading: boolean;
}) {
  const today = events.filter((e) => e.day === "today");
  const tomorrow = events.filter((e) => e.day === "tomorrow");

  return (
    <div className="border-b border-ink/10 bg-cream/40 px-5 py-4">
      <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-gold">
        Today's Briefing
      </p>

      {briefing ? (
        <>
          <p className="mt-1.5 font-serif text-base leading-snug text-ink">
            {briefing.summary}
          </p>
          {briefing.notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {briefing.notes.map((n, i) => (
                <li
                  key={i}
                  className="flex gap-2 font-sans text-xs text-ink/70"
                >
                  <span className="text-gold">›</span>
                  {n}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-1.5 font-sans text-xs italic text-ink/40">
          {loading
            ? "Gathering your day…"
            : "No briefing yet today — it appears each morning at 9."}
        </p>
      )}

      {/* Compact calendar + inbox glance */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Column title="Schedule">
          {today.length + tomorrow.length === 0 ? (
            <Empty>Clear.</Empty>
          ) : (
            <ul className="space-y-1">
              {[...today, ...tomorrow].slice(0, 5).map((e) => (
                <li key={e.id} className="font-sans text-[11px] text-ink/75">
                  <span className="text-ink/40">
                    {e.day === "tomorrow" ? "tmrw " : ""}
                    {e.allDay ? "" : formatTime(e.start) + " "}
                  </span>
                  {e.title}
                </li>
              ))}
            </ul>
          )}
        </Column>
        <Column title="Inbox">
          {emails.length === 0 ? (
            <Empty>Nothing pressing.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {emails.slice(0, 4).map((m) => (
                <li key={m.id}>
                  <div className="flex items-center gap-1">
                    <span
                      className={`rounded px-1 py-0.5 text-[8px] font-medium uppercase ${
                        tagStyles[m.tag] ?? "bg-ink/5"
                      }`}
                    >
                      {m.tag}
                    </span>
                  </div>
                  <p className="truncate font-sans text-[11px] text-ink/75">
                    {m.subject}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Column>
      </div>
    </div>
  );
}

function Column({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-ink/45">
        {title}
      </p>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-[11px] italic text-ink/35">{children}</p>;
}
