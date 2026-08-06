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
 *
 * The listener registration is asynchronous. The `disposed` guard is important:
 * React can unmount an effect before the dynamic import/listen calls finish.
 * Without it, a late subscription would survive the effect cleanup forever.
 */
export async function bindTauriEvents(handlers: TauriHandlers): Promise<() => void> {
  if (!isTauri()) return () => {};

  let disposed = false;
  const disposers: Array<() => void> = [];

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposers.splice(0).forEach((remove) => remove());
  };

  try {
    const { listen } = await import('@tauri-apps/api/event');
    const subscribe = async <T>(event: string, callback: (payload: T) => void) => {
      const remove = await listen<T>(event, (e) => callback(e.payload));
      if (disposed) {
        remove();
      } else {
        disposers.push(remove);
      }
    };

    const subscriptions: Promise<void>[] = [];
    if (handlers.onKillSwitch) {
      subscriptions.push(
        subscribe<string>('kill-switch', (source) => handlers.onKillSwitch?.(source || 'global'))
      );
    }
    if (handlers.onRunFlow) {
      subscriptions.push(subscribe('run-flow', () => handlers.onRunFlow?.()));
    }
    await Promise.all(subscriptions);
  } catch {
    // If one subscription fails, remove every subscription that succeeded
    // before the failure. The bridge is optional in browser/demo mode.
    dispose();
  }

  return dispose;
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow(minimizeToTray: boolean): Promise<void> {
  if (!isTauri()) return;
  const current = (await import('@tauri-apps/api/window')).getCurrentWindow();
  if (minimizeToTray) {
    await current.hide();
  } else {
    await current.close();
  }
}

/** Reads the live JS heap usage (available in Chromium/WebView2). */
export function readHeapMB(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (!mem) return null;
  return +(mem.usedJSHeapSize / 1024 / 1024).toFixed(1);
}

export async function executeNode(kind: string, config: Record<string, string>): Promise<string> {
  if (!isTauri()) return 'Simulated';
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<string>('execute_node', { kind, config });
  } catch (err: any) {
    throw new Error(err.toString());
  }
}

export async function getSystemStats(): Promise<[number, number]> {
  if (!isTauri()) return [0.0, 0.0];
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<[number, number]>('get_system_stats');
  } catch {
    return [0.0, 0.0];
  }
}

export async function openUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank');
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_url', { url });
}
