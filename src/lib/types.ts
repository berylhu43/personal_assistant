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

// Microsoft (Teams/Graph) OAuth tokens — same shape as GoogleTokensRow, stored
// in the separate microsoft_tokens table.
export interface MicrosoftTokensRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO datetime
  updated_at: string;
}

// One configurable LLM provider. Exactly one row has is_active = 1 at a time
// (enforced by setActiveProvider). api_key is NULL until the user sets it.
export interface LlmProviderRow {
  id: string; // 'anthropic' | 'openai' | 'deepseek' | 'qwen'
  display_name: string;
  api_format: string; // 'anthropic' | 'openai_compatible'
  base_url: string;
  default_model: string;
  api_key: string | null;
  supports_web_search: number; // 0 | 1
  is_active: number; // 0 | 1
  created_at: string;
  updated_at: string;
}

export interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  progress: number;
  done: number; // 0 | 1
  plan: string | null; // JSON
  start_date: string | null; // optional YYYY-MM-DD
  target_date: string | null; // optional YYYY-MM-DD
  task_total: number; // # of linked tasks (0 = manual progress)
  granularity: string; // 'daily' | 'weekly'
  note: string | null; // free-form user detail (how-to + links)
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
  note: string | null; // free-form user detail (how-to + links)
  created_at: string;
}

// ---- App-facing shapes ----

export interface Goal {
  id: string;
  title: string;
  progress: number;
  done: boolean;
  plan: WeeklyPlanItem[] | null;
  startDate: string | null; // optional YYYY-MM-DD
  targetDate: string | null; // optional YYYY-MM-DD
  taskTotal: number; // # of linked tasks (0 = manual progress)
  granularity: "daily" | "weekly";
  note: string | null; // free-form user detail (how-to + links)
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
  note: string | null; // free-form user detail (how-to + links)
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

// Why a Teams message surfaced: it's a 1:1 direct message, or the user was
// @mentioned in a group chat.
export type TeamsReason = "dm" | "mention";

export interface TeamsMessage {
  id: string;
  chatId: string;
  from: string; // sender display name
  preview: string; // plain-text snippet of the message body
  date: string; // ISO datetime
  reason: TeamsReason;
}

// A task candidate surfaced from an external source and shown in the Inbox for
// the user to confirm (Add) or dismiss. Email and Teams both produce this shape
// so they merge into one Inbox list.
export interface InboxTaskCandidate {
  source: "email" | "teams";
  sourceId: string; // email id or Teams message id (React key + traceability)
  from: string; // sender
  subject: string; // email subject, or a short Teams context ("Direct message" / "@mention")
  task: {
    title: string;
    date?: string; // absolute YYYY-MM-DD
    kind: "commitment" | "goal";
  };
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
