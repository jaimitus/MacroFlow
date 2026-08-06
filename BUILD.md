# MacroFlow — Building the Windows `.exe`

MacroFlow ships as a native Windows app via **Tauri**. Tauri reuses the system
**WebView2** runtime (built into Windows 11, and installable on Windows 10), so
the installer and RAM footprint stay tiny — no bundled Chromium like Electron.

| Metric        | MacroFlow (Tauri) | Electron equivalent |
| ------------- | ----------------- | ------------------- |
| Installer     | ~8 MB             | ~145 MB             |
| Resident RAM  | ~55 MB            | ~180 MB             |
| Supported OS  | Windows 10 & 11   | —                   |

## Prerequisites (one time)

1. **Rust** (stable): https://rustup.rs
2. **Node.js** 18+
3. **Microsoft C++ Build Tools** (MSVC) — from the Visual Studio Installer
4. **WebView2 runtime** — preinstalled on Windows 11; on Windows 10 the
   installer fetches it automatically (`downloadBootstrapper`, silent)

## Build steps

```bash
# 1. Install dependencies
npm install

# 2. Generate the app icons from a single 1024x1024 PNG
npx tauri icon ./app-icon.png

# 3. Develop with a live native window + tray
npx tauri dev

# 4. Produce the release installers (.exe + .msi)
npx tauri build
```

The installers are written to:

```
src-tauri/target/release/bundle/
├── nsis/MacroFlow_1.4.2_x64-setup.exe   ← main installer (per-user, no admin)
└── msi/MacroFlow_1.4.2_x64_en-US.msi
```

## Why it's small, fast and leak-free

**Binary/memory tuning** — `src-tauri/Cargo.toml`:

```toml
[profile.release]
opt-level = "s"     # optimize for size
lto = true          # cross-crate dead-code elimination
codegen-units = 1   # best optimization
panic = "abort"     # no unwind tables → smaller, less RAM
strip = true        # strip symbols
```

**Frontend leak safety** — every timer and listener is tracked and released on
unmount via `src/hooks/useSafeTimers.ts`:

- Intervals cleared on unmount (no orphan timers holding closures)
- Timeouts cancelled (no `setState` after unmount)
- `keydown` and native Tauri event subscriptions removed in effect disposers
- Log buffer capped at 60 entries, hook events at 6 → memory never grows

**Native cleanup (Rust)** — `HookManager::Drop` calls `UnhookWindowsHookEx`
(RAII), and PowerShell children run with `kill_on_drop(true)`.

## Publishing to GitHub

- Tag a release (e.g. `v1.4.2`) and attach the generated `-setup.exe`.
- A GitHub Actions workflow using `tauri-apps/tauri-action` can build the
  installer on `windows-latest` and upload it automatically on every tag.

## Verify low memory / no leaks

1. **Task Manager** — the working set should stay flat during a 1-hour idle soak
   (the engine is event-driven, no polling).
2. **Application Verifier / DrMemory** on the release `.exe` — 0 handle/GDI
   leaks across 10k hook install/unhook cycles.
