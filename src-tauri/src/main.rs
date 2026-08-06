// Hide the console window in release builds (GUI app, no stdout terminal).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, ShortcutState};

/// True while a macro is executing. The kill switch flips this and the engine
/// task checks it between actions — cooperative, safe cancellation.
static RUNNING: AtomicBool = AtomicBool::new(false);

fn main() {
    tauri::Builder::default()
        // Global kill switch — works even when the window is not focused.
        .plugin(
            ShortcutBuilder::new()
                .with_shortcut("CmdOrCtrl+Shift+Escape")
                .expect("register kill-switch shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        RUNNING.store(false, Ordering::SeqCst);
                        // Tell the UI to abort and show the flash overlay.
                        let _ = app.emit("kill-switch", "global-shortcut");
                    }
                })
                .build(),
        )
        .setup(|app| {
            // ── System tray (resident, ~0% CPU idle) ──
            let run_item = MenuItem::with_id(app, "run", "Run active flow", true, None::<&str>)?;
            let kill_item = MenuItem::with_id(
                app,
                "kill",
                "Kill Switch (Ctrl+Shift+Esc)",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&run_item, &kill_item, &quit_item])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("MacroFlow — engine idle")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "run" => {
                        let _ = app.emit("run-flow", ());
                    }
                    "kill" => {
                        RUNNING.store(false, Ordering::SeqCst);
                        let _ = app.emit("kill-switch", "tray");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MacroFlow");
}
