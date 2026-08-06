// Hide the console window in release builds (GUI app, no stdout terminal).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, ShortcutState};
use std::sync::Mutex;
use sysinfo::System;
use std::os::windows::process::CommandExt;
use enigo::{Enigo, Key, KeyboardControllable};

const CREATE_NO_WINDOW: u32 = 0x08000000;

struct AppState {
    sys: Mutex<System>,
}

fn send_keys_str(enigo: &mut Enigo, keys: &str) {
    let mut current_literal = String::new();
    let mut in_bracket = false;
    let mut bracket_content = String::new();

    for c in keys.chars() {
        if c == '{' {
            if !current_literal.is_empty() {
                enigo.key_sequence(&current_literal);
                current_literal.clear();
            }
            in_bracket = true;
        } else if c == '}' && in_bracket {
            match bracket_content.as_str() {
                "ENTER" => enigo.key_click(Key::Return),
                "TAB" => enigo.key_click(Key::Tab),
                "SPACE" => enigo.key_click(Key::Space),
                "BACKSPACE" => enigo.key_click(Key::Backspace),
                "ESC" => enigo.key_click(Key::Escape),
                "UP" => enigo.key_click(Key::UpArrow),
                "DOWN" => enigo.key_click(Key::DownArrow),
                "LEFT" => enigo.key_click(Key::LeftArrow),
                "RIGHT" => enigo.key_click(Key::RightArrow),
                _ => {
                    enigo.key_sequence(&format!("{{{}}}", bracket_content));
                }
            }
            bracket_content.clear();
            in_bracket = false;
        } else {
            if in_bracket {
                bracket_content.push(c);
            } else {
                current_literal.push(c);
            }
        }
    }
    if !current_literal.is_empty() {
        enigo.key_sequence(&current_literal);
    }
}

fn resolve_variables(text: &str, is_send_keys: bool) -> String {
    let mut result = text.to_string();
    if result.contains("{DATE}") {
        result = result.replace("{DATE}", &chrono::Local::now().format("%Y-%m-%d").to_string());
    }
    if result.contains("{TIME}") {
        result = result.replace("{TIME}", &chrono::Local::now().format("%H:%M:%S").to_string());
    }
    if result.contains("{USER}") {
        if let Ok(user) = std::env::var("USERNAME") {
            result = result.replace("{USER}", &user);
        }
    }
    if result.contains("{DOCS_PATH}") {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            result = result.replace("{DOCS_PATH}", &format!("{}\\Documents", userprofile));
        }
    }
    if !is_send_keys && result.contains("{CLIPBOARD}") {
        if let Ok(output) = std::process::Command::new("powershell").args(&["-Command", "Get-Clipboard"]).output() {
            let cb = String::from_utf8_lossy(&output.stdout).trim_end().to_string();
            result = result.replace("{CLIPBOARD}", &cb);
        }
    }
    result
}

#[tauri::command]
fn execute_node(kind: String, mut config: std::collections::HashMap<String, String>) -> Result<String, String> {
    let is_send_keys = kind == "send_keys";
    for val in config.values_mut() {
        *val = resolve_variables(val, is_send_keys);
    }
    match kind.as_str() {
        "delay" => {
            let ms: u64 = config.get("ms").and_then(|s| s.parse().ok()).unwrap_or(500);
            std::thread::sleep(std::time::Duration::from_millis(ms));
            Ok(format!("Delayed {} ms", ms))
        }
        "powershell" => {
            let script = config.get("script").cloned().unwrap_or_default();
            let output = std::process::Command::new("powershell")
                .args(&["-NoProfile", "-NonInteractive", "-Command", &script])
                .output()
                .map_err(|e| e.to_string())?;
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).into_owned())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).into_owned())
            }
        }
        "notification" => {
            let title = config.get("title").cloned().unwrap_or_default();
            let body = config.get("body").cloned().unwrap_or_default();
            let script = format!(
                "Add-Type -AssemblyName System.Windows.Forms; \
                $notify = New-Object System.Windows.Forms.NotifyIcon; \
                $notify.Icon = [System.Drawing.SystemIcons]::Information; \
                $notify.Visible = $true; \
                $notify.ShowBalloonTip(3000, '{}', '{}', [System.Windows.Forms.ToolTipIcon]::Info); \
                Start-Sleep -Seconds 4",
                title.replace("'", "''"), body.replace("'", "''")
            );
            let _ = std::process::Command::new("powershell")
                .args(&["-WindowStyle", "Hidden", "-Command", &script])
                .spawn();
            Ok("Notification sent".to_string())
        }
        "send_keys" => {
            let keys = config.get("keys").cloned().unwrap_or_default();
            let mut enigo = Enigo::new();
            send_keys_str(&mut enigo, &keys);
            Ok("Keys sent".to_string())
        }
        "clipboard_set" => {
            let value = config.get("value").cloned().unwrap_or_default();
            let script = format!("Set-Clipboard -Value '{}'", value.replace("'", "''"));
            let _ = std::process::Command::new("powershell")
                .args(&["-NoProfile", "-NonInteractive", "-Command", &script])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            Ok("Clipboard updated".to_string())
        }
        "focus_window" => {
            let title = config.get("title").cloned().unwrap_or_default();
            let script = format!("(New-Object -ComObject WScript.Shell).AppActivate('{}')", title.replace("'", "''"));
            let _ = std::process::Command::new("powershell")
                .args(&["-NoProfile", "-NonInteractive", "-Command", &script])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            Ok("Window focused".to_string())
        }
        "open_app" => {
            let app = config.get("exe").cloned().unwrap_or_default();
            let _ = std::process::Command::new("cmd")
                .args(&["/C", "start", &app])
                .spawn();
            Ok("App launched".to_string())
        }
        "close_app" => {
            let app = config.get("exe").cloned().unwrap_or_default();
            let app_name = app.replace(".exe", "");
            let script = format!("Stop-Process -Name '{}' -Force -ErrorAction SilentlyContinue", app_name.replace("'", "''"));
            let _ = std::process::Command::new("powershell")
                .args(&["-WindowStyle", "Hidden", "-Command", &script])
                .status();
            Ok("App closed".to_string())
        }
        "open_url" => {
            let url = config.get("url").cloned().unwrap_or_default();
            let _ = std::process::Command::new("cmd")
                .args(&["/C", "start", &url])
                .spawn();
            Ok("URL opened".to_string())
        }
        "mouse_move" => {
            let x: i32 = config.get("x").and_then(|s| s.parse().ok()).unwrap_or(0);
            let y: i32 = config.get("y").and_then(|s| s.parse().ok()).unwrap_or(0);
            let script = format!(
                "Add-Type -AssemblyName System.Windows.Forms; \
                [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point({}, {})",
                x, y
            );
            let _ = std::process::Command::new("powershell")
                .args(&["-WindowStyle", "Hidden", "-Command", &script])
                .status();
            Ok(format!("Mouse moved to {}, {}", x, y))
        }
        "mouse_click" => {
            let button = config.get("button").cloned().unwrap_or_else(|| "left".to_string());
            let btn_code = if button.to_lowercase() == "right" { 1 } else { 0 };
            if let (Some(x), Some(y)) = (config.get("x"), config.get("y")) {
                let script_move = format!("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point({}, {})", x, y);
                let _ = std::process::Command::new("powershell").args(&["-WindowStyle", "Hidden", "-Command", &script_move]).status();
            }
            let script = format!(
                "$Code = @'\nusing System.Runtime.InteropServices;\npublic class Mouse {{\n[DllImport(\"user32.dll\")]\npublic static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);\npublic static void Click(int button) {{\nif (button == 0) {{ mouse_event(0x02, 0, 0, 0, 0); mouse_event(0x04, 0, 0, 0, 0); }}\nelse {{ mouse_event(0x08, 0, 0, 0, 0); mouse_event(0x10, 0, 0, 0, 0); }}\n}}\n}}\n'@\nAdd-Type -TypeDefinition $Code; [Mouse]::Click({})",
                btn_code
            );
            let _ = std::process::Command::new("powershell")
                .args(&["-WindowStyle", "Hidden", "-Command", &script])
                .status();
            Ok("Mouse clicked".to_string())
        }
        "take_screenshot" => {
            let filename = config.get("filename").cloned().unwrap_or_else(|| "screenshot.png".to_string());
            let script = format!(
                "Add-Type -AssemblyName System.Windows.Forms; \
                Add-Type -AssemblyName System.Drawing; \
                $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
                $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; \
                $g = [System.Drawing.Graphics]::FromImage($bmp); \
                $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); \
                $bmp.Save(\"$env:USERPROFILE\\Documents\\{}\"); \
                $g.Dispose(); $bmp.Dispose();",
                filename.replace("\"", "")
            );
            let _ = std::process::Command::new("powershell")
                .args(&["-WindowStyle", "Hidden", "-Command", &script])
                .status();
            Ok(format!("Screenshot saved to Documents\\{}", filename))
        }
        "condition" => {
            let expr = config.get("expr").cloned().unwrap_or_default();
            let mut result = true;
            
            // Basic condition evaluation engine
            if expr.contains("len(") && expr.contains(") > 0") {
                // e.g. len(value) > 0
                let start = expr.find("len(").unwrap() + 4;
                let end = expr.find(") > 0").unwrap();
                let inner = &expr[start..end];
                result = !inner.trim().is_empty();
            } else if expr.contains("==") {
                let parts: Vec<&str> = expr.split("==").collect();
                if parts.len() == 2 {
                    result = parts[0].trim() == parts[1].trim();
                }
            } else if expr.contains("!=") {
                let parts: Vec<&str> = expr.split("!=").collect();
                if parts.len() == 2 {
                    result = parts[0].trim() != parts[1].trim();
                }
            }

            if result { Ok("true".to_string()) } else { Ok("false".to_string()) }
        }
        _ => Ok("Simulated (Not fully implemented yet)".into())
    }
}

#[tauri::command]
fn open_url(url: String) {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", &url])
        .spawn();
}

#[tauri::command]
fn get_system_stats(state: tauri::State<AppState>) -> (f32, f32) {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    
    let cpu = sys.global_cpu_info().cpu_usage();
    let total = sys.total_memory() as f32;
    let used = sys.used_memory() as f32;
    let ram = if total > 0.0 { (used / total) * 100.0 } else { 0.0 };
    
    (cpu, ram)
}

fn main() {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    tauri::Builder::default()
        .manage(AppState {
            sys: Mutex::new(sys),
        })
        // Global kill switch — works even when the window is not focused.
        .plugin(
            ShortcutBuilder::new()
                .with_shortcut("CmdOrCtrl+Shift+X")
                .expect("register kill-switch shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        // Tell the UI to abort and show the flash overlay.
                        let _ = app.emit("kill-switch", "global-shortcut");
                    }
                })
                .build(),
        )
        .setup(|app| {
            // ── System tray (resident, ~0% CPU idle) ──
            let show_item = MenuItem::with_id(app, "show", "Show MacroFlow", true, None::<&str>)?;
            let run_item = MenuItem::with_id(app, "run", "Run active flow", true, None::<&str>)?;
            let kill_item = MenuItem::with_id(
                app,
                "kill",
                "Kill Switch (Ctrl+Shift+X)",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &run_item, &kill_item, &quit_item])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("MacroFlow — engine idle")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "run" => {
                        let _ = app.emit("run-flow", ());
                    }
                    "kill" => {
                        let _ = app.emit("kill-switch", "tray");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![execute_node, get_system_stats, open_url])
        .run(tauri::generate_context!())
        .expect("error while running MacroFlow");
}
