import { fetch } from "@tauri-apps/plugin-http";
import { getValidMsAccessToken } from "./msAuth";
import type { TeamsMessage } from "./types";

// Microsoft Graph client. Surfaces only the high-signal slice of Teams: 1:1
// direct messages (inherently directed at the user) and group-chat messages
// where the user is @mentioned. Everything else is filtered out HERE, before it
// ever reaches the LLM prompt — so the assistant only pays tokens for messages
// that plausibly need a reply. See AGENTS.md (Teams integration).

const GRAPH = "https://graph.microsoft.com/v1.0";

// Only look at activity from the last week; cap total surfaced messages.
const LOOKBACK_DAYS = 7;
const MAX_CHATS_SCANNED = 40; // recent chats to consider
const MAX_GROUP_FETCHES = 15; // group chats we'll pull messages from (for mentions)
const MAX_RESULTS = 25;

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getValidMsAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function graphGet(path: string): Promise<any> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "GET",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Graph API error ${res.status} on ${path}`);
  return res.json();
}

/** Teams message bodies are HTML (or text); reduce to a tidy plain-text snippet. */
function toText(body: any): string {
  const raw = String(body?.content ?? "");
  const text =
    body?.contentType === "html"
      ? raw
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
      : raw;
  return text.replace(/\s+/g, " ").trim();
}

function senderName(msg: any): string {
  return msg?.from?.user?.displayName ?? "Someone";
}

function isRecent(iso: string | undefined, cutoffMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= cutoffMs;
}

/**
 * Recent 1:1 DMs + group-chat @mentions for the signed-in user, newest first.
 * Returns [] (does not throw) for an empty/quiet inbox; throws only on auth or
 * unexpected Graph failures so callers can decide whether to surface them.
 */
export async function getTeamsMessages(): Promise<TeamsMessage[]> {
  const cutoffMs = Date.now() - LOOKBACK_DAYS * 86_400_000;

  // Who am I — needed to skip my own messages and match @mentions.
  const me = await graphGet("/me");
  const myId: string = me?.id ?? "";

  // One call gets every chat plus a preview of its latest message.
  const chatsRes = await graphGet(
    `/me/chats?$expand=lastMessagePreview&$top=${MAX_CHATS_SCANNED}`
  );
  const chats: any[] = chatsRes?.value ?? [];

  const out: TeamsMessage[] = [];
  const groupChats: any[] = [];

  for (const chat of chats) {
    const preview = chat?.lastMessagePreview;
    const previewWhen = preview?.createdDateTime;
    if (!isRecent(previewWhen, cutoffMs)) continue;

    if (chat?.chatType === "oneOnOne") {
      // A direct message — high-signal by nature. Skip if I sent the last one.
      const fromId = preview?.from?.user?.id;
      if (fromId && fromId === myId) continue;
      const text = toText(preview?.body);
      if (!text) continue;
      out.push({
        id: preview?.id ?? `${chat.id}-preview`,
        chatId: chat.id,
        from: senderName(preview),
        preview: text.slice(0, 400),
        date: previewWhen,
        reason: "dm",
      });
    } else {
      // group / meeting chat — candidate for mention scanning.
      groupChats.push(chat);
    }
  }

  // For group chats, pull recent messages and keep only ones that @mention me.
  const groupsToScan = groupChats
    .sort(
      (a, b) =>
        new Date(b?.lastMessagePreview?.createdDateTime ?? 0).getTime() -
        new Date(a?.lastMessagePreview?.createdDateTime ?? 0).getTime()
    )
    .slice(0, MAX_GROUP_FETCHES);

  const mentionLists = await Promise.all(
    groupsToScan.map(async (chat) => {
      try {
        const res = await graphGet(`/me/chats/${chat.id}/messages?$top=20`);
        const msgs: any[] = res?.value ?? [];
        return msgs
          .filter(
            (m) =>
              isRecent(m?.createdDateTime, cutoffMs) &&
              m?.from?.user?.id !== myId &&
              (m?.mentions ?? []).some(
                (mn: any) => mn?.mentioned?.user?.id === myId
              )
          )
          .map((m): TeamsMessage => {
            const text = toText(m?.body);
            return {
              id: m.id,
              chatId: chat.id,
              from: senderName(m),
              preview: (text || "(mentioned you)").slice(0, 400),
              date: m.createdDateTime,
              reason: "mention",
            };
          });
      } catch {
        return [] as TeamsMessage[];
      }
    })
  );

  for (const list of mentionLists) out.push(...list);

  return out
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, MAX_RESULTS);
}
