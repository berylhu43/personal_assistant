export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO datetime or date
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  // "today" | "tomorrow" — which bucket the event falls into.
  day: "today" | "tomorrow";
}

export type EmailTag = "reply needed" | "prep needed" | "review" | "unread";

export interface PendingEmail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string; // ISO
  tag: EmailTag;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Goal {
  id: string;
  title: string;
  progress: number; // 0-100
  done: boolean;
  createdAt: string; // ISO
}
