// Tauri shell only: window management, tray, daily timer, and DB migrations.
// No business logic lives here — SQL queries, Anthropic, Google, and memory
// all run in the React/TypeScript layer.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalSize, Manager,
};
use tauri_plugin_sql::{Migration, MigrationKind};

// Window sizes for the two states.
const COLLAPSED: (f64, f64) = (340.0, 480.0);
const EXPANDED: (f64, f64) = (860.0, 560.0);

/// Tracks whether the chat panel is shown (window expanded).
struct AppState {
    expanded: AtomicBool,
}

fn apply_size(app: &AppHandle, expanded: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let (w, h) = if expanded { EXPANDED } else { COLLAPSED };
    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Resize the window and broadcast the new state so React can render the chat.
#[tauri::command]
fn set_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    apply_size(&app, expanded)?;
    app.state::<AppState>()
        .expanded
        .store(expanded, Ordering::SeqCst);
    let _ = app.emit("expanded-changed", expanded);
    Ok(())
}

fn toggle_expanded(app: &AppHandle) {
    let state = app.state::<AppState>();
    let next = !state.expanded.load(Ordering::SeqCst);
    let _ = set_expanded(app.clone(), next);
}

fn toggle_visibility(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "toggle_visibility", "Show / Hide", true, None::<&str>)?;
    let expand = MenuItem::with_id(app, "toggle_expanded", "Expand / Collapse", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_hide, &expand, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Assistant")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle_visibility" => toggle_visibility(app),
            "toggle_expanded" => toggle_expanded(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Once-a-minute timer. Emits `briefing-due` during the 9 o'clock hour and
/// `briefing-end` during the 10 o'clock hour, at most once per day each. React
/// decides what to do (it guards on whether today's briefing already exists).
fn start_daily_timer(app: AppHandle) {
    thread::spawn(move || {
        use chrono::{Local, NaiveDate, Timelike};
        let mut fired_due: Option<NaiveDate> = None;
        let mut fired_end: Option<NaiveDate> = None;
        loop {
            let now = Local::now();
            let today = now.date_naive();
            let hour = now.hour();

            if hour == 9 && fired_due != Some(today) {
                let _ = app.emit("briefing-due", ());
                fired_due = Some(today);
            }
            if hour == 10 && fired_end != Some(today) {
                let _ = app.emit("briefing-end", ());
                fired_end = Some(today);
            }
            thread::sleep(Duration::from_secs(60));
        }
    });
}

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial schema",
        kind: MigrationKind::Up,
        sql: r#"
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS google_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0, plan TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL, source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, summary TEXT NOT NULL, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);
"#,
        },
        Migration {
            version: 2,
            description: "local calendar (commitments not synced to Google)",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE IF NOT EXISTS calendar (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT,
  source TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#,
        },
        Migration {
            version: 3,
            description: "goal target date",
            kind: MigrationKind::Up,
            // SQLite has no ADD COLUMN IF NOT EXISTS; the migration framework's
            // versioning guarantees this runs exactly once.
            sql: r#"
ALTER TABLE goals ADD COLUMN target_date TEXT;
"#,
        },
        Migration {
            version: 4,
            description: "link daily tasks to goals",
            kind: MigrationKind::Up,
            sql: r#"
ALTER TABLE goals ADD COLUMN task_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendar ADD COLUMN goal_id TEXT;
"#,
        },
        Migration {
            version: 5,
            description: "weekly-granularity goals",
            kind: MigrationKind::Up,
            sql: r#"
ALTER TABLE goals ADD COLUMN granularity TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE calendar ADD COLUMN span TEXT;
"#,
        },
        Migration {
            version: 6,
            description: "learning plan documents",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#,
        },
        Migration {
            version: 7,
            description: "cached daily inbox scans",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE IF NOT EXISTS inbox_scans (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  candidates TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);
"#,
        },
        Migration {
            version: 8,
            description: "microsoft (teams/graph) oauth tokens",
            kind: MigrationKind::Up,
            // Mirrors google_tokens: one row per local user. refresh_token is
            // NOT NULL but an empty string is allowed (same convention as Google).
            sql: r#"
CREATE TABLE IF NOT EXISTS microsoft_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#,
        },
        Migration {
            version: 9,
            description: "llm providers (multi-provider api keys)",
            kind: MigrationKind::Up,
            // Seed rows are inserted with ON CONFLICT DO NOTHING so re-applying
            // never duplicates a row or wipes a key. api_key is left NULL (user
            // fills it in); is_active starts 0 for all — the TS one-time
            // migration flips anthropic active iff a key is copied in.
            sql: r#"
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  api_format TEXT NOT NULL,
  base_url TEXT NOT NULL,
  default_model TEXT NOT NULL,
  api_key TEXT,
  supports_web_search INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO llm_providers
  (id, display_name, api_format, base_url, default_model, supports_web_search, is_active)
VALUES
  ('anthropic', 'Claude',   'anthropic',         'https://api.anthropic.com',                                  'claude-sonnet-4-6', 1, 0),
  ('openai',    'GPT',      'openai_compatible', 'https://api.openai.com/v1',                                  'gpt-5.4',           1, 0),
  ('deepseek',  'DeepSeek', 'openai_compatible', 'https://api.deepseek.com',                                   'deepseek-chat',     0, 0),
  ('qwen',      'Qwen',     'openai_compatible', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',     'qwen-max',          0, 0)
ON CONFLICT(id) DO NOTHING;
"#,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Remember only the position, not the size (we control size).
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:assistant.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_google_auth::init())
        .plugin(tauri_plugin_oauth::init())
        .manage(AppState {
            expanded: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![set_expanded])
        .setup(|app| {
            let handle = app.handle().clone();
            build_tray(&handle)?;
            // Start collapsed.
            let _ = apply_size(&handle, false);
            start_daily_timer(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
