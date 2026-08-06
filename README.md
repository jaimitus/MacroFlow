# MacroFlow

[![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111111)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**MacroFlow** is a lightweight, tray-based visual automation workspace for Windows. Design flows as nodes, inspect execution activity, test global shortcuts, and stop an in-progress run with a global emergency shortcut.

> **Project status:** MacroFlow v1.4.2 includes a fully native robust execution engine. It acts as a visual automation workspace with real OS-level macros, conditional branching logic, dynamic DAG execution, and Windows-native interactions.

## Why MacroFlow?

- **Visual by default** — compose triggers and actions on a node canvas instead of maintaining a large script.
- **Fast and small** — Tauri uses the operating system WebView2 runtime instead of bundling Chromium.
- **Safety-first** — `Ctrl + Shift + Esc` is available globally on Windows and the UI exposes a prominent stop control.
- **Tray resident** — minimize the window to the system tray and bring it back from the tray menu.
- **Low-noise observability** — bounded activity logs, hook events, latency history, and resource charts.
- **Desktop-friendly UI** — Windows-inspired light/dark/system themes with keyboard and responsive layout support.

## Current capabilities

| Area | Included today |
| --- | --- |
| Flow designer | Drag nodes, edit node configuration, connect/delete links, select flows |
| Node palette | Hotkeys, window focus, clipboard, keystrokes, mouse move/click, screenshot, PowerShell, delay, condition, notification, app launch/close, open URL, clipboard set |
| Execution | Real dynamic DAG runner that follows logical condition branches and triggers native Rust/PowerShell system interops. |
| Safety | Global `Ctrl + Shift + Esc` shortcut, tray kill action, UI emergency stop |
| Desktop shell | Tauri 2 window controls, tray menu, minimize-to-tray close action |
| Diagnostics | Bounded logs/hooks/history, hook-latency sparkline, resource heartbeat |
| Appearance | Light, dark, and system theme preference |

### Important scope note

MacroFlow's execution engine interacts deeply with the Windows OS. While the React frontend provides a beautiful layout, all heavy lifting (such as PowerShell injection, C# interoperability for mouse events, and hardware metrics) happens safely and asynchronously through the Rust backend.

## Architecture

```text
.
├── src/
│   ├── App.tsx                 # app state, execution lifecycle, kill switch
│   ├── components/             # dashboard, designer, settings, icons, charts
│   ├── data.ts                 # palette and sample flows
│   ├── hooks/
│   │   ├── useSafeTimers.ts    # tracked timeout/interval lifecycle
│   │   └── useTheme.ts          # persisted theme preference
│   └── lib/tauri.ts             # optional native bridge and window controls
├── src-tauri/
│   ├── src/main.rs              # tray, global shortcut, native event emitter
│   ├── icons/                   # generated application icons
│   └── tauri.conf.json          # native window, CSP, installer settings
├── public/macroflow.svg         # browser favicon
└── BUILD.md                     # Windows packaging notes
```

## Requirements

### Browser UI

- Node.js **20.19+** or **22.12+**
- npm 10+

### Native Windows app

- Windows 10 or Windows 11
- Rust stable with the `x86_64-pc-windows-msvc` toolchain
- Microsoft C++ Build Tools with the Windows SDK
- WebView2 Runtime (included with Windows 11; the configured installer can download it on Windows 10)

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the platform-specific setup.

## Quick start

```bash
# Clone the repository
git clone https://github.com/jaimitus/MacroFlow.git
cd MacroFlow

# Install the exact locked dependency tree
npm ci

# Start the browser UI
npm run dev
```

Open the URL printed by Vite. The browser preview is intentionally safe: it only simulates execution and does not install global native hooks.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run typecheck` | Run TypeScript strict type checking |
| `npm run build` | Build the single-file production frontend |
| `npm run check` | Run type checking and the production build |
| `npm run tauri -- dev` | Open the native Tauri development window |
| `npm run tauri -- build` | Build the Windows NSIS/MSI installers |
| `npm audit` | Audit development and production dependencies |

Before opening a pull request, run:

```bash
npm ci
npm run check
npm audit
```

## Building the Windows installers

Run this on a Windows development machine with the native prerequisites installed:

```bash
npm ci
npm run tauri -- build
```

Artifacts are written below:

```text
src-tauri/target/release/bundle/
├── nsis/MacroFlow_1.4.2_x64-setup.exe
└── msi/MacroFlow_1.4.2_x64_en-US.msi
```

The checked-in icons under `src-tauri/icons` were generated from the project mark. If the mark changes, regenerate them with:

```bash
npm run tauri -- icon public/macroflow.svg -o src-tauri/icons
```

For more detail, read [BUILD.md](BUILD.md).

## Reliability and memory-safety notes

MacroFlow is designed so that UI activity stays bounded during a long idle session:

- Logs are capped at **60** entries.
- Hook events are capped at **6** entries.
- CPU, RAM, and latency histories keep only the latest **40** samples.
- Every UI timer is registered through `useSafeTimers` and cleared on unmount.
- Abortable execution delays remove their `AbortSignal` listener after completion.
- The execution lock prevents two same-tick run requests from creating competing runners.
- Unmounting aborts the current runner and releases its controller reference.
- Tauri event registration has async cleanup guards, so a listener that resolves after an effect cleanup is immediately removed.
- Native tray/window resources are owned by Tauri and Rust values are scoped through normal ownership.

These controls prevent known retention paths; they are not a substitute for a native soak test. For a release candidate, leave the Windows build idle for at least one hour, repeatedly run/abort flows, open/close the window, toggle themes, and verify in Task Manager that working set and handle count remain stable.

## Security notes

- Do not place passwords, API keys, or other secrets in sample flows or issue reports.
- Treat future PowerShell, clipboard, and input actions as privileged operations. Any native executor must validate timeouts, scope process creation, and surface failures to the user.
- The emergency stop is cooperative: it stops the MacroFlow runner between actions. A future native action that blocks synchronously must have its own cancellation/timeout strategy.
- The Tauri CSP is intentionally restrictive and allows only the local app plus Tauri IPC.

## Contributing

1. Create a focused branch from `main`.
2. Keep UI changes, native changes, and documentation changes easy to review.
3. Add or update a regression check for every bug fix where practical.
4. Run `npm run check` and `npm audit` before opening a pull request.
5. Describe Windows-specific behavior and manual verification steps in the pull request.

Bug reports and feature requests are welcome in [GitHub Issues](https://github.com/jaimitus/MacroFlow/issues).

## License

MacroFlow is released under the [MIT License](LICENSE).
