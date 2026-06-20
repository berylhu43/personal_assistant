import { fetch } from "@tauri-apps/plugin-http";
import { getValidAccessToken } from "./auth";
import type { CalendarEvent, PendingEmail, EmailTag, NewEvent } from "./types";

const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getValidAccessToken();
  return { Authorization: `Bearer ${token}` };
}

/** Local calendar date as YYYY-MM-DD (no UTC shift). */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Today's + tomorrow's events from the primary calendar. */
export async function getTodayEvents(): Promise<CalendarEvent[]> {
  const headers = await authHeaders();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const endOfTomorrow = new Date(startOfToday);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);

  const todayStr = localDateStr(startOfToday);
  const tomorrowStr = localDateStr(startOfTomorrow);

  const params = new URLSearchParams({
    timeMin: startOfToday.toISOString(),
    timeMax: endOfTomorrow.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  const res = await fetch(`${CAL_BASE}/calendars/primary/events?${params}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) throw new Error(`Calendar API error ${res.status}`);
  const data = await res.json();

  return (data.items ?? []).map((e: any): CalendarEvent => {
    const allDay = !e.start?.dateTime;
    const start = e.start?.dateTime ?? e.start?.date ?? "";
    const end = e.end?.dateTime ?? e.end?.date ?? "";
    // For all-day events `start` is a bare YYYY-MM-DD (parsing it as a Date
    // would treat it as UTC midnight and misclassify near the day boundary in
    // non-UTC zones); for timed events use the local date of the timestamp.
    const eventDateStr = allDay ? start : localDateStr(new Date(start));
    const day: "today" | "tomorrow" =
      eventDateStr === todayStr
        ? "today"
        : eventDateStr === tomorrowStr
          ? "tomorrow"
          : "today";
    return {
      id: e.id ?? crypto.randomUUID(),
      title: e.summary ?? "(no title)",
      start,
      end,
      allDay,
      location: e.location ?? undefined,
      description: e.description ?? undefined,
      day,
    };
  });
}

function deriveTag(subject: string, snippet: string, starred: boolean): EmailTag {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (/\?|please reply|let me know|can you|could you|rsvp|confirm/.test(text)) {
    return "reply needed";
  }
  if (/agenda|prep|prepare|review|deck|doc|before our|ahead of/.test(text)) {
    return "prep needed";
  }
  if (starred) return "review";
  return "unread";
}

function header(headers: any[], name: string): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

/** Unread/starred inbox threads from the last 48h that likely need action. */
export async function getPendingEmails(): Promise<PendingEmail[]> {
  const headers = await authHeaders();

  const listParams = new URLSearchParams({
    q: "(is:unread OR is:starred) in:inbox newer_than:2d",
    maxResults: "20",
  });
  const listRes = await fetch(`${GMAIL_BASE}/users/me/messages?${listParams}`, {
    method: "GET",
    headers,
  });
  if (!listRes.ok) throw new Error(`Gmail API error ${listRes.status}`);
  const list = await listRes.json();
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id);

  const details = await Promise.all(
    ids.map(async (id) => {
      const p = new URLSearchParams({ format: "metadata" });
      ["From", "Subject", "Date"].forEach((h) => p.append("metadataHeaders", h));
      const r = await fetch(`${GMAIL_BASE}/users/me/messages/${id}?${p}`, {
        method: "GET",
        headers,
      });
      return r.ok ? r.json() : null;
    })
  );

  return details
    .filter(Boolean)
    .map((msg: any): PendingEmail => {
      const hs = msg.payload?.headers ?? [];
      const subject = header(hs, "Subject") || "(no subject)";
      const from = header(hs, "From");
      const dateHeader = header(hs, "Date");
      const starred = (msg.labelIds ?? []).includes("STARRED");
      return {
        id: msg.id,
        from,
        subject,
        snippet: msg.snippet ?? "",
        date: dateHeader ? new Date(dateHeader).toISOString() : "",
        tag: deriveTag(subject, msg.snippet ?? "", starred),
      };
    });
}

/** Create an event on the primary calendar. */
export async function createEvent(ev: NewEvent): Promise<{ htmlLink?: string }> {
  const headers = {
    ...(await authHeaders()),
    "Content-Type": "application/json",
  };

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body: any = { summary: ev.title, description: ev.description };

  if (ev.startTime && ev.endTime) {
    body.start = { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone };
    body.end = { dateTime: `${ev.date}T${ev.endTime}:00`, timeZone };
  } else {
    // All-day end date is exclusive. Compute it from local date components —
    // toISOString().slice(0,10) would shift the date east of UTC (off-by-one).
    const d = new Date(`${ev.date}T12:00:00`); // noon avoids DST edges
    d.setDate(d.getDate() + 1);
    const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
    body.start = { date: ev.date };
    body.end = { date: end };
  }

  const res = await fetch(`${CAL_BASE}/calendars/primary/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to create event (${res.status})`);
  return res.json();
}
