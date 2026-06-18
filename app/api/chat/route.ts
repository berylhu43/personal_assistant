import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { CalendarEvent, PendingEmail, ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";

interface ChatBody {
  messages: ChatMessage[];
  calendarEvents?: CalendarEvent[];
  pendingEmails?: PendingEmail[];
}

function formatEvents(events: CalendarEvent[]): string {
  if (!events.length) return "  (no events on the calendar)";
  return events
    .map((e) => {
      const when = e.allDay
        ? "all day"
        : new Date(e.start).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
      return `  - [${e.day}] ${when} — ${e.title}${
        e.location ? ` @ ${e.location}` : ""
      }`;
    })
    .join("\n");
}

function formatEmails(emails: PendingEmail[]): string {
  if (!emails.length) return "  (no pending emails)";
  return emails
    .map((e) => `  - [${e.tag}] from ${e.from}: "${e.subject}" — ${e.snippet}`)
    .join("\n");
}

function buildSystemPrompt(
  calendarEvents: CalendarEvent[],
  pendingEmails: PendingEmail[]
): string {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `You are a proactive personal assistant embedded in a memo-style dashboard.

Today's date is ${dateStr}.

The user's calendar (today and tomorrow):
${formatEvents(calendarEvents)}

Pending emails needing attention (last 48h):
${formatEmails(pendingEmails)}

Your responsibilities:
- Help the user plan goals. When they mention a goal (e.g. "I want to learn AI agents this month"), break it into a concrete weekly plan and suggest specific calendar time blocks.
- Detect dependencies and surface reminders (e.g. "baking a cake Sunday" → "buy ingredients Saturday").
- Be proactive: if a meeting tomorrow likely needs preparation, mention it unprompted.
- When you suggest scheduling time, offer to add it to the calendar. To request an event be created, end your message with a fenced code block tagged \`add-event\` containing JSON:
\`\`\`add-event
{ "title": "...", "date": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm", "description": "..." }
\`\`\`
The dashboard will offer the user a button to confirm creating it.

Keep replies concise, warm, and practical. Use plain language. Reference the user's actual calendar and emails when relevant.`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, calendarEvents = [], pendingEmails = [] } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(calendarEvents, pendingEmails),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const reply = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error("chat error", err?.message ?? err);
    return NextResponse.json(
      { error: "Failed to generate a reply" },
      { status: 500 }
    );
  }
}
