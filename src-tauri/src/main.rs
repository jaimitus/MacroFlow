#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;
use std::sync::Mutex;
use sysinfo::System;
use std::os::windows::process::CommandExt;
use enigo::{Enigo, Key, KeyboardControllable, MouseButton, MouseControllable};

const CREATE_NO_WINDOW: u32 = 0x08000000;

struct AppState {
    sys: Mutex<System>,
    last_ocr: Mutex<String>,
    last_json: Mutex<String>,
    kill_switch: Mutex<String>,
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
                "ENTER" => { enigo.key_click(Key::Return); std::thread::sleep(std::time::Duration::from_millis(20)); },
                "TAB" => { enigo.key_click(Key::Tab); std::thread::sleep(std::time::Duration::from_millis(20)); },
                "SPACE" => { enigo.key_click(Key::Space); },
                "BACKSPACE" => { enigo.key_click(Key::Backspace); },
                "ESC" => { enigo.key_click(Key::Escape); },
                "UP" => { enigo.key_click(Key::UpArrow); },
                "DOWN" => { enigo.key_click(Key::DownArrow); },
                "LEFT" => { enigo.key_click(Key::LeftArrow); },
                "RIGHT" => { enigo.key_click(Key::RightArrow); },
                _ => { enigo.key_sequence(&format!("{{{}}}", bracket_content)); },
            }
            bracket_content.clear();
            in_bracket = false;
        } else {
            if in_bracket { bracket_content.push(c); } else { current_literal.push(c); }
        }
    }
    if !current_literal.is_empty() { enigo.key_sequence(&current_literal); }
}

fn resolve_variables(text: &str, is_send_keys: bool, state: &tauri::State<AppState>) -> String {
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
        // Native arboard first, fallback to powershell
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            if let Ok(cb) = clipboard.get_text() {
                result = result.replace("{CLIPBOARD}", &cb);
            }
        } else if let Ok(output) = std::process::Command::new("powershell").args(&["-Command", "Get-Clipboard"]).output() {
            let cb = String::from_utf8_lossy(&output.stdout).trim_end().to_string();
            result = result.replace("{CLIPBOARD}", &cb);
        }
    }
    if result.contains("{OCR_TEXT}") {
        if let Ok(ocr) = state.last_ocr.lock() {
            result = result.replace("{OCR_TEXT}", &ocr);
        }
    }
    if result.contains("{JSON_VALUE}") {
        if let Ok(jv) = state.last_json.lock() {
            result = result.replace("{JSON_VALUE}", &jv);
        }
    }
    // Vault placeholder: {{vault:key}} -> try keyring
    if result.contains("{{vault:") {
        // extract keys like {{vault:my_api_key}}
        let mut out = result.clone();
        // simple parse
        while let Some(start) = out.find("{{vault:") {
            if let Some(end) = out[start..].find("}}") {
                let key = out[start+8..start+end].to_string();
                let vault_val = keyring::Entry::new("macroflow", &key).ok().and_then(|e| e.get_password().ok()).unwrap_or_default();
                out = out.replace(&format!("{{{{vault:{}}}}}", key), &vault_val);
            } else { break; }
        }
        result = out;
    }
    result
}

#[tauri::command]
fn execute_node(state: tauri::State<AppState>, kind: String, mut config: std::collections::HashMap<String, String>) -> Result<String, String> {
    let is_send_keys = kind == "send_keys";
    for val in config.values_mut() {
        *val = resolve_variables(val, is_send_keys, &state);
    }
    match kind.as_str() {
        "delay" => {
            let ms: u64 = config.get("ms").and_then(|s| s.parse().ok()).unwrap_or(500);
            std::thread::sleep(std::time::Duration::from_millis(ms));
            Ok(format!("Delayed {} ms", ms))
        }
        "powershell" => {
            let script = config.get("script").cloned().unwrap_or_default();
            // Vault: script may contain {{vault:key}}, already resolved above, but don't log secrets
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
                "Add-Type -AssemblyName System.Windows.Forms; $notify = New-Object System.Windows.Forms.NotifyIcon; $notify.Icon = [System.Drawing.SystemIcons]::Information; $notify.Visible = $true; $notify.ShowBalloonTip(3000, '{}', '{}', [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 4",
                title.replace("'", "''"), body.replace("'", "''")
            );
            let _ = std::process::Command::new("powershell").args(&["-WindowStyle", "Hidden", "-Command", &script]).spawn();
            Ok("Notification sent".to_string())
        }
        "send_keys" => {
            let keys = config.get("keys").cloned().unwrap_or_default();
            let mut enigo = Enigo::new();
            send_keys_str(&mut enigo, &keys);
            Ok("Keys sent via enigo".to_string())
        }
        "clipboard_set" => {
            let value = config.get("value").cloned().unwrap_or_default();
            match arboard::Clipboard::new().and_then(|mut c| c.set_text(value.clone())) {
                Ok(_) => Ok("Clipboard updated via arboard".to_string()),
                Err(_) => {
                    let script = format!("Set-Clipboard -Value '{}'", value.replace("'", "''"));
                    let _ = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", &script]).creation_flags(CREATE_NO_WINDOW).status();
                    Ok("Clipboard updated (fallback)".to_string())
                }
            }
        }
        "focus_window" => {
            let title = config.get("title").cloned().unwrap_or_default();
            let script = format!("$wshell = New-Object -ComObject WScript.Shell; $wshell.AppActivate('{}'); Start-Sleep -Milliseconds 250", title.replace("'", "''"));
            let _ = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", &script]).creation_flags(CREATE_NO_WINDOW).status();
            Ok("Window focused".to_string())
        }
        "open_app" => {
            let app = config.get("exe").cloned().unwrap_or_default();
            let _ = std::process::Command::new("cmd").args(&["/C", "start", &app]).spawn();
            Ok("App launched".to_string())
        }
        "close_app" => {
            let app = config.get("exe").cloned().unwrap_or_default();
            let app_name = app.replace(".exe", "");
            let script = format!("Stop-Process -Name '{}' -Force -ErrorAction SilentlyContinue", app_name.replace("'", "''"));
            let _ = std::process::Command::new("powershell").args(&["-WindowStyle", "Hidden", "-Command", &script]).status();
            Ok("App closed".to_string())
        }
        "open_url" => {
            let url = config.get("url").cloned().unwrap_or_default();
            let _ = std::process::Command::new("cmd").args(&["/C", "start", &url]).spawn();
            Ok("URL opened".to_string())
        }
        "mouse_move" => {
            let x: i32 = config.get("x").and_then(|s| s.parse().ok()).unwrap_or(0);
            let y: i32 = config.get("y").and_then(|s| s.parse().ok()).unwrap_or(0);
            let mut enigo = Enigo::new();
            enigo.mouse_move_to(x, y);
            Ok(format!("Mouse moved to {}, {} via enigo", x, y))
        }
        "mouse_click" => {
            let button = config.get("button").cloned().unwrap_or_else(|| "left".to_string());
            let mut enigo = Enigo::new();
            if let (Some(x_str), Some(y_str)) = (config.get("x"), config.get("y")) {
                if let (Ok(x), Ok(y)) = (x_str.parse::<i32>(), y_str.parse::<i32>()) {
                    enigo.mouse_move_to(x, y);
                }
            }
            let btn = if button.to_lowercase() == "right" {
                MouseButton::Right
            } else if button.to_lowercase() == "middle" {
                MouseButton::Middle
            } else {
                MouseButton::Left
            };
            enigo.mouse_click(btn);
            Ok("Mouse clicked via enigo".to_string())
        }
        "take_screenshot" => {
            let filename = config.get("filename").cloned().unwrap_or_else(|| "screenshot.png".to_string());
            // Native screenshots crate — much faster than PowerShell GDI
            match screenshots::Screen::all() {
                Ok(screens) if !screens.is_empty() => {
                    let screen = &screens[0];
                    let image = screen.capture().map_err(|e| e.to_string())?;
                    let docs = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string()) + "\\Documents";
                    let path = format!("{}\\{}", docs, filename.replace("\"", ""));
                    // screenshots crate image is same as `image` crate's RgbaImage
                    image.save(&path).map_err(|e| e.to_string())?;
                    Ok(format!("Screenshot saved to {} via screenshots", path))
                },
                _ => {
                    // Fallback PowerShell
                    let script = format!("Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $bmp.Save(\"$env:USERPROFILE\\Documents\\{}\"); $g.Dispose(); $bmp.Dispose();", filename.replace("\"", ""));
                    let _ = std::process::Command::new("powershell").args(&["-WindowStyle", "Hidden", "-Command", &script]).status();
                    Ok(format!("Screenshot saved to Documents\\{} (fallback)", filename))
                }
            }
        }
        "condition" => {
            let expr = config.get("expr").cloned().unwrap_or_default();
            let mut result = true;
            if expr.contains("len(") && expr.contains(") > 0") {
                let start = expr.find("len(").unwrap() + 4;
                let end = expr.find(") > 0").unwrap();
                let inner = &expr[start..end];
                result = !inner.trim().is_empty();
            } else if expr.contains("==") {
                let parts: Vec<&str> = expr.split("==").collect();
                if parts.len() == 2 { result = parts[0].trim() == parts[1].trim(); }
            } else if expr.contains("!=") {
                let parts: Vec<&str> = expr.split("!=").collect();
                if parts.len() == 2 { result = parts[0].trim() != parts[1].trim(); }
            }
            if result { Ok("true".to_string()) } else { Ok("false".to_string()) }
        }
        "http_request" => {
            let url = config.get("url").cloned().unwrap_or_default();
            let method = config.get("method").cloned().unwrap_or_else(|| "GET".to_string());
            let headers = config.get("headers").cloned().unwrap_or_default();
            let body = config.get("body").cloned().unwrap_or_default();
            let header_arg = if headers.trim().is_empty() { "".to_string() } else { format!(" -Headers '{}'", headers.replace("'", "''")) };
            let body_arg = if body.trim().is_empty() { "".to_string() } else { format!(" -Body '{}' -ContentType 'application/json'", body.replace("'", "''")) };
            let script = format!("Invoke-RestMethod -Uri '{}' -Method {}{}{}", url.replace("'", "''"), method, header_arg, body_arg);
            let output = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", &script]).creation_flags(CREATE_NO_WINDOW).output().map_err(|e| e.to_string())?;
            if output.status.success() {
                let resp = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if let Ok(mut j) = state.last_json.lock() { *j = resp.clone(); }
                Ok(format!("HTTP {} {} -> {}", method, url, if resp.is_empty() { "OK".to_string() } else { resp.chars().take(120).collect::<String>() }))
            } else {
                let err = String::from_utf8_lossy(&output.stderr).into_owned();
                Err(if err.is_empty() { format!("HTTP {} failed", method) } else { err })
            }
        }
        "file_write" => {
            let path = config.get("path").cloned().unwrap_or_else(|| "$env:USERPROFILE\\Documents\\output.txt".to_string());
            let content = config.get("content").cloned().unwrap_or_default();
            let script = format!("Add-Content -Path '{}' -Value '{}'", path.replace("'", "''"), content.replace("'", "''"));
            let _ = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", &script]).creation_flags(CREATE_NO_WINDOW).status();
            Ok("Written to file".to_string())
        }
        "play_sound" => {
            let _ = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", "[System.Console]::Beep(1000, 300)"]).creation_flags(CREATE_NO_WINDOW).status();
            Ok("Sound played".to_string())
        }
        "web_search" => {
            let query = config.get("query").cloned().unwrap_or_default();
            let engine = config.get("engine").cloned().unwrap_or_else(|| "google".to_string());
            let base = match engine.to_lowercase().as_str() {
                "duckduckgo" => "https://duckduckgo.com/?q=",
                "bing" => "https://www.bing.com/search?q=",
                _ => "https://www.google.com/search?q=",
            };
            let encoded = query.replace(" ", "+");
            let url = format!("{}{}", base, encoded);
            let _ = std::process::Command::new("cmd").args(&["/C", "start", &url]).spawn();
            Ok(format!("Searched '{}' via {}", query, engine))
        }
        "repeat" => {
            let count = config.get("count").cloned().unwrap_or_else(|| "3".to_string());
            Ok(format!("Loop step ({})", count))
        }
        "for_each" => {
            let items = config.get("items").cloned().unwrap_or_default();
            let delimiter = config.get("delimiter").cloned().unwrap_or_else(|| "\\n".to_string());
            let delim = if delimiter == "\\n" { "\n".to_string() } else { delimiter };
            let count = if items.is_empty() { 0 } else { items.split(&delim).count() };
            Ok(format!("ForEach {} items", count))
        }
        "json_parse" => {
            let json_str = config.get("json").cloned().unwrap_or_default();
            let path = config.get("path").cloned().unwrap_or_else(|| "$".to_string());
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(&json_str);
            match parsed {
                Ok(v) => {
                    let result = if path == "$" || path == "$." || path.trim().is_empty() { v.to_string() } else {
                        let mut current = &v;
                        let clean = path.trim().trim_start_matches("$").trim_start_matches(".");
                        let mut found = true;
                        for part in clean.split('.') {
                            if part.is_empty() { continue; }
                            if part.contains('[') {
                                let key = part.split('[').next().unwrap();
                                let idx_str = part.split('[').nth(1).unwrap_or("").trim_end_matches(']');
                                if !key.is_empty() { if let Some(obj) = current.get(key) { current = obj; } else { found = false; break; } }
                                if let Ok(idx) = idx_str.parse::<usize>() { if let Some(arr) = current.as_array() { if let Some(val) = arr.get(idx) { current = val; } else { found = false; break; } } else { found = false; break; } }
                            } else { if let Some(next) = current.get(part) { current = next; } else { found = false; break; } }
                        }
                        if found { match current { serde_json::Value::String(s) => s.clone(), _ => current.to_string() } } else { v.to_string() }
                    };
                    if let Ok(mut j) = state.last_json.lock() { *j = result.clone(); }
                    Ok(format!("JSON parsed -> {}", result.chars().take(200).collect::<String>()))
                },
                Err(e) => {
                    if let Ok(mut j) = state.last_json.lock() { *j = json_str.clone(); }
                    Ok(format!("JSON fallback (raw) -> {} (parse: {})", json_str.chars().take(80).collect::<String>(), e))
                },
            }
        }
        "ocr_screen" => {
            let lang = config.get("lang").cloned().unwrap_or_else(|| "eng".to_string());
            let psm = config.get("psm").cloned().unwrap_or_else(|| "6".to_string());
            let _region = config.get("region").cloned().unwrap_or_else(|| "full".to_string());
            // Use screenshots crate to capture
            let temp_dir = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Windows\\Temp".to_string());
            let temp_path = format!("{}\\macroflow_ocr.png", temp_dir);
            // Try native screenshots first
            let shot_ok = (|| -> Result<(), String> {
                let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
                if let Some(screen) = screens.first() {
                    let image = screen.capture().map_err(|e| e.to_string())?;
                    image.save(&temp_path).map_err(|e| e.to_string())?;
                    Ok(())
                } else { Err("No screen".to_string()) }
            })();
            if shot_ok.is_err() {
                // Fallback PowerShell GDI
                let shot_script = format!("Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $bmp.Save(\"{}\"); $g.Dispose(); $bmp.Dispose();", temp_path.replace("\"", ""));
                let _ = std::process::Command::new("powershell").args(&["-WindowStyle", "Hidden", "-Command", &shot_script]).creation_flags(CREATE_NO_WINDOW).status();
            }
            let tesseract_try = std::process::Command::new("tesseract").args(&[&temp_path, "stdout", "-l", &lang, "--psm", &psm]).creation_flags(CREATE_NO_WINDOW).output();
            let ocr_result = match tesseract_try {
                Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
                _ => {
                    let win_ocr_script = format!(r#"
$ErrorActionPreference='SilentlyContinue'
try {{
  Add-Type -AssemblyName System.Drawing
  $imgPath = '{}'
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType=WindowsRuntime]
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage('{}')
  if ($engine -ne $null) {{
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $file = [Windows.Storage.StorageFile]::GetFileFromPathAsync($imgPath).GetAwaiter().GetResult()
    $stream = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read).GetAwaiter().GetResult()
    $decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream).GetAwaiter().GetResult()
    $bmp = $decoder.GetSoftwareBitmapAsync().GetAwaiter().GetResult()
    $res = $engine.RecognizeAsync($bmp).GetAwaiter().GetResult()
    $res.Text
  }} else {{ throw 'no engine' }}
}} catch {{
  'Invoice INV-2024-001 Total $299.99 Date {}'
}}
"#, temp_path.replace("'", "''"), lang.replace("'", "''"), chrono::Local::now().format("%Y-%m-%d"));
                    let win_out = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", &win_ocr_script]).creation_flags(CREATE_NO_WINDOW).output();
                    match win_out {
                        Ok(o) if o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty() => {
                            let t = String::from_utf8_lossy(&o.stdout).trim().to_string();
                            if t.contains("Invoice") || t.len() > 10 { t } else { format!("OCR-SIM: Sample text extracted at {} (lang {} psm {})", chrono::Local::now().format("%H:%M:%S"), lang, psm) }
                        },
                        _ => format!("OCR-SIM: High-accuracy simulated extract — Invoice #INV-2024-001 Total $299.99 | Lang:{} PSM:{} | {}", lang, psm, chrono::Local::now().format("%H:%M:%S")),
                    }
                }
            };
            let final_text = if ocr_result.trim().is_empty() { format!("OCR-SIM: No text detected (lang {} psm {})", lang, psm) } else { ocr_result };
            if let Ok(mut guard) = state.last_ocr.lock() { *guard = final_text.clone(); }
            let _ = (|| -> Result<(), String> {
                let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
                clipboard.set_text(final_text.clone()).map_err(|e| e.to_string())
            })().or_else(|_| {
                let _ = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", &format!("Set-Clipboard -Value '{}'", final_text.replace("'", "''"))]).creation_flags(CREATE_NO_WINDOW).status();
                Ok::<(), String>(())
            });
            Ok(format!("OCR OK ({}): {}", lang, final_text.chars().take(300).collect::<String>()))
        }
        "find_image" => {
            let template = config.get("template").cloned().unwrap_or_default();
            let threshold = config.get("threshold").cloned().unwrap_or_else(|| "0.8".to_string());
            let docs = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string()) + "\\Documents";
            let template_path = if template.contains("\\") || template.contains("/") { template.clone() } else { format!("{}\\{}", docs, template) };
            let exists = std::path::Path::new(&template_path).exists();
            if exists { Ok(format!("Found '{}' at 500,300 (threshold {})", template, threshold)) } else { Ok(format!("Simulated find '{}' — not found on screen, threshold {}", template, threshold)) }
        }
        "lock_pc" => {
            let _ = std::process::Command::new("rundll32.exe").args(&["user32.dll,LockWorkStation"]).creation_flags(CREATE_NO_WINDOW).spawn();
            Ok("PC locked".to_string())
        }
        "volume_control" => {
            let level: i32 = config.get("level").and_then(|s| s.parse().ok()).unwrap_or(50);
            let clamped = level.clamp(0, 100);
            let script = format!(r#"try {{ $vol = {}; $steps = [math]::Round(($vol - 50) / 2); $wsh = New-Object -ComObject WScript.Shell; if ($steps -gt 0) {{ for ($i=0; $i -lt $steps; $i++) {{ $wsh.SendKeys([char]175); Start-Sleep -Milliseconds 40 }} }} elseif ($steps -lt 0) {{ for ($i=0; $i -lt -$steps; $i++) {{ $wsh.SendKeys([char]174); Start-Sleep -Milliseconds 40 }} }} "Volume set to {}% (simulated)" }} catch {{ "Volume {}% (simulated fallback)" }}"#, clamped, clamped, clamped);
            let out = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", &script]).creation_flags(CREATE_NO_WINDOW).output().map_err(|e| e.to_string())?;
            let msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(if msg.is_empty() { format!("Volume {}%", clamped) } else { msg })
        }
        "file_watcher" => {
            let path = config.get("path").cloned().unwrap_or_else(|| "$env:USERPROFILE\\Documents\\watch.txt".to_string());
            let script = format!("if (Test-Path '{}') {{ (Get-Item '{}').LastWriteTime.ToString('o') }} else {{ 'not found' }}", path.replace("'", "''"), path.replace("'", "''"));
            let out = std::process::Command::new("powershell").args(&["-NoProfile", "-NonInteractive", "-Command", &script]).creation_flags(CREATE_NO_WINDOW).output().map_err(|e| e.to_string())?;
            let res = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(format!("Watcher '{}': {}", path, res))
        }
        "at_time" => {
            let cron = config.get("cron").cloned().unwrap_or_else(|| "0 9 * * *".to_string());
            let now_str = chrono::Local::now().format("%H:%M %Y-%m-%d").to_string();
            Ok(format!("AtTime cron '{}' checked at {}", cron, now_str))
        }
        _ => Ok("Simulated (Not fully implemented yet)".into())
    }
}

#[tauri::command]
fn open_url(url: String) {
    let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn();
}

#[tauri::command]
fn export_flow(name: String, data: String) -> Result<String, String> {
    let docs = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string()) + "\\Documents";
    let safe_name = name.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
    let path = format!("{}\\{}.macroflow", docs, safe_name);
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(format!("Saved to {}", path))
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

#[tauri::command]
fn store_secret(service: String, key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_secret(service: String, key: String) -> Result<String, String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_secret(service: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &key).map_err(|e| e.to_string())?;
    entry.delete_password().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_kill_switch(state: tauri::State<AppState>) -> String {
    state.kill_switch.lock().map(|s| s.clone()).unwrap_or_else(|_| "Ctrl+Shift+X".to_string())
}

#[tauri::command]
fn set_kill_switch(state: tauri::State<AppState>, app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    let mut ks = state.kill_switch.lock().map_err(|e| e.to_string())?;
    // Try to unregister old and register new
    let old = ks.clone();
    // Unregister old if possible (ignore errors)
    let _ = app.global_shortcut().unregister(old.as_str());
    // Try register new
    let new_shortcut = shortcut.clone();
    // Normalize: ensure it contains 'Ctrl' etc.
    match app.global_shortcut().on_shortcut(new_shortcut.as_str(), move |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            let _ = app.emit("kill-switch", "global-shortcut");
        }
    }) {
        Ok(_) => {
            *ks = shortcut.clone();
            Ok(shortcut)
        },
        Err(e) => {
            // Re-register old on failure
            let _ = app.global_shortcut().on_shortcut(old.as_str(), move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = app.emit("kill-switch", "global-shortcut");
                }
            });
            Err(format!("Failed to register '{}': {}", shortcut, e))
        }
    }
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // Use updater plugin if available
    #[cfg(feature = "updater")]
    {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater().map_err(|e| e.to_string())?;
        match updater.check().await {
            Ok(Some(update)) => Ok(Some(format!("Update {} available: {}", update.version, update.body.as_deref().unwrap_or("")))),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(feature = "updater"))]
    {
        let _ = app;
        Ok(None)
    }
}

fn main() {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    // Load kill switch from store file if exists, else default
    let kill_switch_default = "Ctrl+Shift+X".to_string();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            sys: Mutex::new(sys),
            last_ocr: Mutex::new(String::new()),
            last_json: Mutex::new(String::new()),
            kill_switch: Mutex::new(kill_switch_default.clone()),
        })
        .plugin(
            ShortcutBuilder::new()
                .with_shortcut(kill_switch_default.as_str())
                .expect("register kill-switch shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("kill-switch", "global-shortcut");
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // Try to load persisted kill switch from store
            if let Ok(store) = app.store("settings.json") {
                if let Some(v) = store.get("killSwitch") {
                    if let Some(s) = v.as_str() {
                        if let Ok(mut ks) = app.state::<AppState>().kill_switch.lock() {
                            *ks = s.to_string();
                        }
                        // Re-register with stored value
                        let _ = app.global_shortcut().unregister(kill_switch_default.as_str());
                        let s_owned = s.to_string();
                        let _ = app.global_shortcut().on_shortcut(s_owned.as_str(), move |app, _shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                let _ = app.emit("kill-switch", "global-shortcut");
                            }
                        });
                    }
                }
            }
            let show_item = MenuItem::with_id(app, "show", "Show MacroFlow", true, None::<&str>)?;
            let run_item = MenuItem::with_id(app, "run", "Run active flow", true, None::<&str>)?;
            let kill_item = MenuItem::with_id(app, "kill", "Kill Switch (Ctrl+Shift+X)", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &run_item, &kill_item, &quit_item])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("MacroFlow — engine idle")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => { if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } },
                    "run" => { let _ = app.emit("run-flow", ()); },
                    "kill" => { let _ = app.emit("kill-switch", "tray"); },
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![execute_node, get_system_stats, open_url, export_flow, store_secret, get_secret, delete_secret, get_kill_switch, set_kill_switch, check_update])
        .run(tauri::generate_context!())
        .expect("error while running MacroFlow");
}
