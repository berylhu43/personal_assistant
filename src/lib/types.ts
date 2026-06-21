// ---- DB row shapes ----

export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export interface GoogleTokensRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO datetime
  updated_at: string;
}

export interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  progress: number;
  done: number; // 0 | 1
  plan: string | null; // JSON
  created_at: string;
}

export interface MemoryRow {
  id: string;
  user_id: string;
  kind: string; // 'fact' | 'preference' | 'goal_note'
  content: string;
  source: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  user_id: string;
  role: string; // 'user' | 'assistant'
  content: string;
  created_at: string;
}

export interface BriefingRow {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  summary: string;
  notes: string | null; // JSON array
  created_at: string;
}

// ---- App-facing shapes ----

export interface Goal {
  id: string;
  title: string;
  progress: number;
  done: boolean;
  plan: WeeklyPlanItem[] | null;
  createdAt: string;
}

export interface WeeklyPlanItem {
  week: number;
  focus: string;
}

export type MemoryKind = "fact" | "preference" | "goal_note";

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  source: string | null;
  createdAt: string; // ISO/SQLite datetime
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type EmailTag = "reply needed" | "prep needed" | "review" | "unread";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  day: "today" | "tomorrow";
}

export interface PendingEmail {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  tag: EmailTag;
}

export interface Briefing {
  date: string;
  summary: string;
  notes: string[];
}

export interface NewEvent {
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  description?: string;
}
