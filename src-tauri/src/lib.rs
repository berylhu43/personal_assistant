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
    }]
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
        .plugin(tauri_plugin_google_auth::init())
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
