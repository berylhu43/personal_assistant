import { NextResponse } from "next/server";
import { getGoogleAuth, calendarClient } from "@/lib/google";
import type { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getGoogleAuth();
  if (!auth) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Window: start of today through end of tomorrow (local server time).
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfTomorrow = new Date(startOfToday);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 2); // exclusive upper bound

  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  try {
    const calendar = calendarClient(auth);
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfToday.toISOString(),
      timeMax: endOfTomorrow.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const items = res.data.items ?? [];
    const events: CalendarEvent[] = items.map((e) => {
      const allDay = !e.start?.dateTime;
      const startRaw = e.start?.dateTime ?? e.start?.date ?? "";
      const endRaw = e.end?.dateTime ?? e.end?.date ?? "";
      const startDate = new Date(startRaw);
      const day: "today" | "tomorrow" =
        startDate < startOfTomorrow ? "today" : "tomorrow";

      return {
        id: e.id ?? Math.random().toString(36).slice(2),
        title: e.summary ?? "(no title)",
        start: startRaw,
        end: endRaw,
        allDay,
        location: e.location ?? undefined,
        description: e.description ?? undefined,
        day,
      };
    });

    return NextResponse.json({ events });
  } catch (err: any) {
    console.error("calendar/today error", err?.message ?? err);
    return NextResponse.json(
      { error: "Failed to fetch calendar events" },
      { status: 500 }
    );
  }
}
