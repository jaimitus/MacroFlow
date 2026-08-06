# Building MacroFlow for Windows

MacroFlow ships as a native Windows desktop app through **Tauri 2**. Tauri uses the installed **WebView2** runtime rather than bundling a second Chromium runtime, which keeps the installer smaller than an equivalent Electron app.

> The current repository contains the Tauri shell, tray integration, global kill-switch bridge, and a safe UI execution simulator. Native mouse/keyboard/window/PowerShell action execution is not enabled yet.

## Prerequisites

Install the following on a Windows 10/11 machine:

1. [Node.js 20.19+](https://nodejs.org/) or Node.js 22.12+
2. [Rust stable](https://rustup.rs/), using the MSVC toolchain
3. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the Windows SDK
4. [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) — already included with current Windows 11 installations

Tauri's complete prerequisite list is available in the [official documentation](https://v2.tauri.app/start/prerequisites/).

## Development

```powershell
# From the repository root
npm ci

# Browser-only UI preview; native actions remain simulated
npm run dev

# Native Tauri window with tray and global shortcut
npm run tauri -- dev
```

The Vite development server is configured by Tauri to use `http://localhost:5173` locally. Do not expose this development server to an untrusted network.

## Production build

```powershell
npm ci
npm run check
npm run tauri -- build
```

`npm run check` runs strict TypeScript checking and the Vite production build. The native installers are created at:

```text
src-tauri/target/release/bundle/
├── nsis/MacroFlow_1.4.2_x64-setup.exe
└── msi/MacroFlow_1.4.2_x64_en-US.msi
```

The NSIS installer is configured for a per-user installation. Its WebView2 bootstrapper can download the runtime on machines where it is missing.

## Application icons

The source mark is `public/macroflow.svg`. The checked-in Windows/Tauri icon set lives in `src-tauri/icons`. Regenerate it after changing the mark:

```powershell
npm run tauri -- icon public/macroflow.svg -o src-tauri/icons
```

## Release checklist

- [ ] `npm ci` completes from a clean checkout.
- [ ] `npm run check` passes.
- [ ] `npm audit` reports no vulnerabilities.
- [ ] `npm run tauri -- build` succeeds on Windows.
- [ ] Launch the generated installer on a clean Windows VM.
- [ ] Confirm the tray menu can show the window, run the active flow, trigger the kill switch, and exit.
- [ ] Confirm `Ctrl + Shift + Esc` works while the window is unfocused.
- [ ] Run and abort flows repeatedly; inspect Task Manager for stable working set and handle count.
- [ ] Verify uninstall removes the application cleanly.

## Memory and lifecycle design

The frontend uses explicit lifecycle ownership:

- `useSafeTimers` tracks every interval and timeout and clears them during unmount.
- The execution delay removes its abort listener when it resolves, preventing retained timer closures.
- The native event bridge handles the race where an async Tauri listener finishes after React has already cleaned up the effect.
- The runner uses one `AbortController` at a time, clears its ref in `finally`, and aborts during teardown.
- UI histories and activity buffers are capped rather than appended indefinitely.

For native action work, each process, OS hook, and event subscription must follow the same ownership rule: acquire once, release on cancellation and in the owning type's destructor/drop path, and add a bounded soak test before release.
