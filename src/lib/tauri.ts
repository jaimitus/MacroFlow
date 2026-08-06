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

let lastOcrSim = '';
let lastJsonSim = '';

function resolveSimVars(text: string): string {
  return text
    .replaceAll('{DATE}', new Date().toISOString().slice(0,10))
    .replaceAll('{TIME}', new Date().toLocaleTimeString())
    .replaceAll('{USER}', 'demo')
    .replaceAll('{DOCS_PATH}', 'C:\\Users\\Demo\\Documents')
    .replaceAll('{OCR_TEXT}', lastOcrSim || 'Sample OCR text')
    .replaceAll('{JSON_VALUE}', lastJsonSim || '')
    .replaceAll('{CLIPBOARD}', lastOcrSim || 'clipboard');
}

export async function executeNode(kind: string, config: Record<string, string>): Promise<string> {
  if (!isTauri()) {
    // High-quality simulated execution for browser preview
    const cfg = Object.fromEntries(Object.entries(config).map(([k,v])=>[k, resolveSimVars(v)]));
    await new Promise(r=> setTimeout(r, 80 + Math.random()*120));
    switch(kind){
      case 'delay': return `Delayed ${cfg.ms||500} ms`;
      case 'ocr_screen': {
        const lang = cfg.lang||'eng';
        const sample = `Invoice INV-2024-001 Total $299.99 Date ${new Date().toISOString().slice(0,10)} Lang:${lang} — high-accuracy OCR (simulated tesseract+WinRT)`;
        lastOcrSim = sample;
        return `OCR OK (${lang}): ${sample.slice(0,80)}`;
      }
      case 'find_image': return `Found '${cfg.template||'button.png'}' at 500,300 (simulated)`;
      case 'json_parse': {
        try{
          const v = JSON.parse(cfg.json||'{}');
          const path = (cfg.path||'$').replace(/^\$\.?/,'');
          let cur:any = v;
          if(path) for(const p of path.split('.')){ if(p && cur) cur = cur[p]; }
          const res = typeof cur==='string'? cur : JSON.stringify(cur);
          lastJsonSim = res;
          return `JSON parsed -> ${res.slice(0,80)}`;
        }catch(e:any){
          // Fallback: OCR text is often not JSON — don't break the flow
          lastJsonSim = cfg.json || '';
          return `JSON fallback (raw) -> ${(cfg.json||'').slice(0,80)}`;
        }
      }
      case 'for_each': {
        const items = cfg.items||'a,b,c';
        const delim = cfg.delimiter==='\\n'? '\n' : (cfg.delimiter||',');
        const cnt = items.split(delim).filter(Boolean).length;
        return `ForEach ${cnt} items`;
      }
      case 'http_request': {
        const m = cfg.method||'GET';
        return `HTTP ${m} ${cfg.url||''} -> 200 OK (sim)`;
      }
      case 'file_write': return 'Written to file (sim)';
      case 'lock_pc': return 'PC locked (sim)';
      case 'volume_control': return `Volume ${cfg.level||50}% (sim)`;
      case 'file_watcher': return `Watcher '${cfg.path}' -> exists (sim)`;
      case 'at_time': return `AtTime '${cfg.cron}' checked (sim)`;
      case 'powershell': return 'PowerShell OK (sim)';
      case 'condition': {
        // simple: if contains len and >0 => true if not empty
        const expr = cfg.expr||'';
        if(expr.includes('len(') && expr.includes('> 0')) return 'true';
        if(expr.includes('==')) return expr.split('==')[0].trim() === expr.split('==')[1].trim() ? 'true' : 'false';
        return 'true';
      }
      case 'repeat': return `Loop step (${cfg.count||3})`;
      default: return 'Simulated';
    }
  }
  // Tauri path: resolve vars already handled in Rust, but also handle frontend var cache for consistency
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const res = await invoke<string>('execute_node', { kind, config });
    // update sim caches from real result for browser consistency (not needed in Tauri but helps)
    if(kind==='ocr_screen'){
      // try to extract OCR text from res: "OCR OK (eng): <text>"
      const m = res.match(/:\s*(.*)/);
      if(m) lastOcrSim = m[1].slice(0,500);
    }
    if(kind==='json_parse'){
      const m = res.match(/->\s*(.*)/);
      if(m) lastJsonSim = m[1].slice(0,500);
    }
    return res;
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
