import { NextResponse } from "next/server";
import { getGoogleAuth, gmailClient } from "@/lib/google";
import type { PendingEmail, EmailTag } from "@/lib/types";

export const dynamic = "force-dynamic";

function headerValue(headers: any[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** Heuristic tag based on subject/snippet and message flags. */
function deriveTag(subject: string, snippet: string, isStarred: boolean): EmailTag {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (/\?|please reply|let me know|can you|could you|rsvp|confirm/.test(text)) {
    return "reply needed";
  }
  if (/agenda|prep|prepare|review|deck|doc|before our|ahead of/.test(text)) {
    return "prep needed";
  }
  if (isStarred) return "review";
  return "unread";
}

export async function GET() {
  const auth = await getGoogleAuth();
  if (!auth) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const gmail = gmailClient(auth);

    // Unread or starred, in the inbox, from the last 2 days.
    const list = await gmail.users.messages.list({
      userId: "me",
      q: "(is:unread OR is:starred) in:inbox newer_than:2d",
      maxResults: 20,
    });

    const messages = list.data.messages ?? [];

    const details = await Promise.all(
      messages.map((m) =>
        gmail.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        })
      )
    );

    const emails: PendingEmail[] = details.map((d) => {
      const msg = d.data;
      const headers = msg.payload?.headers ?? [];
      const subject = headerValue(headers, "Subject") || "(no subject)";
      const from = headerValue(headers, "From");
      const dateHeader = headerValue(headers, "Date");
      const snippet = msg.snippet ?? "";
      const labels = msg.labelIds ?? [];
      const isStarred = labels.includes("STARRED");

      return {
        id: msg.id ?? "",
        threadId: msg.threadId ?? "",
        from,
        subject,
        snippet,
        date: dateHeader ? new Date(dateHeader).toISOString() : "",
        tag: deriveTag(subject, snippet, isStarred),
      };
    });

    return NextResponse.json({ emails });
  } catch (err: any) {
    console.error("gmail/pending error", err?.message ?? err);
    return NextResponse.json(
      { error: "Failed to fetch emails" },
      { status: 500 }
    );
  }
}
