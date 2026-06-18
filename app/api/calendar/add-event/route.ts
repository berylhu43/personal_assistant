import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuth, calendarClient } from "@/lib/google";

export const dynamic = "force-dynamic";

interface AddEventBody {
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm (24h)
  endTime?: string; // HH:mm (24h)
  description?: string;
}

export async function POST(req: NextRequest) {
  const auth = await getGoogleAuth();
  if (!auth) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: AddEventBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, date, startTime, endTime, description } = body;
  if (!title || !date) {
    return NextResponse.json(
      { error: "title and date are required" },
      { status: 400 }
    );
  }

  // The browser's IANA timezone is the most sensible default for a single-user app.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // If times are given, create a timed event; otherwise an all-day event.
  const requestBody: any = {
    summary: title,
    description: description ?? undefined,
  };

  if (startTime && endTime) {
    requestBody.start = { dateTime: `${date}T${startTime}:00`, timeZone };
    requestBody.end = { dateTime: `${date}T${endTime}:00`, timeZone };
  } else {
    // All-day event spans a single day; end date is exclusive.
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const endDate = next.toISOString().slice(0, 10);
    requestBody.start = { date };
    requestBody.end = { date: endDate };
  }

  try {
    const calendar = calendarClient(auth);
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody,
    });

    return NextResponse.json({
      ok: true,
      eventId: res.data.id,
      htmlLink: res.data.htmlLink,
    });
  } catch (err: any) {
    console.error("calendar/add-event error", err?.message ?? err);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
