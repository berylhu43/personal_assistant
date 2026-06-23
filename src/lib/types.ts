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
  target_date: string | null; // optional YYYY-MM-DD
  task_total: number; // # of linked tasks (0 = manual progress)
  granularity: string; // 'daily' | 'weekly'
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

export interface CommitmentRow {
  id: string;
  user_id: string;
  title: string;
  date: string; // absolute YYYY-MM-DD
  time: string | null; // optional HH:mm
  source: string | null;
  done: number; // 0 | 1
  goal_id: string | null; // links a daily task to its goal
  span: string | null; // 'week' = weekly task; NULL = daily/one-off
  created_at: string;
}

// ---- App-facing shapes ----

export interface Goal {
  id: string;
  title: string;
  progress: number;
  done: boolean;
  plan: WeeklyPlanItem[] | null;
  targetDate: string | null; // optional YYYY-MM-DD
  taskTotal: number; // # of linked tasks (0 = manual progress)
  granularity: "daily" | "weekly";
  createdAt: string;
}

export interface WeeklyPlanItem {
  week: number;
  focus: string;
  done?: boolean;
}

export type MemoryKind = "fact" | "preference" | "goal_note";

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  source: string | null;
  createdAt: string; // ISO/SQLite datetime
}

export interface PlanRow {
  id: string;
  goal_id: string | null;
  title: string;
  content: string; // JSON string: PlanDay[]
  created_at: string;
}

export interface PlanResource {
  kind: "repo" | "article" | "doc" | "code" | string;
  title: string;
  url: string;
}

export interface PlanDay {
  date: string; // YYYY-MM-DD
  topic: string;
  task: string;
  practice?: string;
  resources?: PlanResource[];
  est_time?: string;
}

export interface Commitment {
  id: string;
  title: string;
  date: string; // absolute YYYY-MM-DD
  time: string | null; // optional HH:mm
  done: boolean;
  source: string | null;
  goalId: string | null; // links a daily task to its goal
  span: "week" | null; // 'week' = weekly task; null = daily/one-off
  createdAt: string;
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
