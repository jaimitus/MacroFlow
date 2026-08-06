/**
 * Optional Tauri bridge.
 *
 * The web bundle stays framework-agnostic: nothing here loads unless the app is
 * actually running inside the Tauri WebView. That keeps the browser build lean
 * and lets the exact same `dist/` power both the demo and the native .exe.
 */

export interface TauriHandlers {
  onKillSwitch?: (source: string) => void;
  onRunFlow?: () => void;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Subscribes to native events emitted by the Rust side (global shortcut + tray).
 * Returns a disposer; safe to call in the browser (it just no-ops).
 */
export async function bindTauriEvents(handlers: TauriHandlers): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const disposers: Array<() => void> = [];

    if (handlers.onKillSwitch) {
      disposers.push(
        await listen<string>('kill-switch', (e) => handlers.onKillSwitch!(e.payload || 'global'))
      );
    }
    if (handlers.onRunFlow) {
      disposers.push(await listen('run-flow', () => handlers.onRunFlow!()));
    }

    return () => disposers.forEach((d) => d());
  } catch {
    return () => {};
  }
}

/** Reads the live JS heap usage (available in Chromium/WebView2). */
export function readHeapMB(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (!mem) return null;
  return +(mem.usedJSHeapSize / 1024 / 1024).toFixed(1);
}
