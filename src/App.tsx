import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './components/Icon';
import Dashboard from './components/Dashboard';
import Designer from './components/Designer';
import Settings from './components/Settings';
import { useSafeTimers } from './hooks/useSafeTimers';
import { useTheme } from './hooks/useTheme';
import {
  bindTauriEvents,
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
  executeNode,
  getSystemStats,
} from './lib/tauri';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_FLOWS, PALETTE } from './data';
import type { Flow, HookEvent, LogEntry, LogLevel, NodeKind, Settings as AppSettings, TabId } from './types';

let logSeq = 0;
const now = () =>
  new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0');

const NAV: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'designer', label: 'Designer', icon: 'nodes' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];

const DEFAULT_SETTINGS: AppSettings = {
  startWithWindows: true,
  minimizeToTray: true,
  startMinimized: false,
  notificationsEnabled: true,
  killSwitch: 'Ctrl + Shift + X',
};

const SETTINGS_STORAGE_KEY = 'macroflow.settings';

function readStoredSettings(): AppSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null') as Partial<AppSettings> | null;
    if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;
    return {
      startWithWindows: typeof stored.startWithWindows === 'boolean' ? stored.startWithWindows : DEFAULT_SETTINGS.startWithWindows,
      minimizeToTray: typeof stored.minimizeToTray === 'boolean' ? stored.minimizeToTray : DEFAULT_SETTINGS.minimizeToTray,
      startMinimized: typeof stored.startMinimized === 'boolean' ? stored.startMinimized : DEFAULT_SETTINGS.startMinimized,
      notificationsEnabled: typeof stored.notificationsEnabled === 'boolean' ? stored.notificationsEnabled : DEFAULT_SETTINGS.notificationsEnabled,
      killSwitch: typeof stored.killSwitch === 'string' ? stored.killSwitch : DEFAULT_SETTINGS.killSwitch,
    };
  } catch {
    // A malformed or unavailable browser storage must not prevent the app from
    // starting with safe defaults.
    return DEFAULT_SETTINGS;
  }
}

const FLOWS_STORAGE_KEY = 'macroflow.flows';

function readStoredFlows(): Flow[] {
  if (typeof localStorage === 'undefined') return DEFAULT_FLOWS;
  try {
    const stored = JSON.parse(localStorage.getItem(FLOWS_STORAGE_KEY) ?? 'null') as Flow[] | null;
    if (!stored || !Array.isArray(stored) || stored.length === 0) return DEFAULT_FLOWS;
    
    // Migration: If they don't have the new flow-matrix demo, reset flows to show the Matrix Patrol demo!
    if (!stored.some(f => f.id === 'flow-matrix')) return DEFAULT_FLOWS;

    return stored;
  } catch {
    return DEFAULT_FLOWS;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', finish);
      resolve();
    };

    const timeoutId = window.setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });

export default function App() {
  const { pref, resolved, setPref, toggle } = useTheme();
  const timers = useSafeTimers();

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [flows, setFlows] = useState<Flow[]>(() => readStoredFlows());
  const [flowId, setFlowId] = useState('flow-matrix');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [executingFlowId, setExecutingFlowId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => readStoredSettings());

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage is optional (for example in a locked-down WebView).
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(FLOWS_STORAGE_KEY, JSON.stringify(flows));
    } catch {}
  }, [flows]);

  const [hookEvents, setHookEvents] = useState<HookEvent[]>([
    { id: 1, key: 'Ctrl+Alt+R', code: 'KeyR', modifiers: ['Ctrl', 'Alt'], timestamp: '14:32:01.115', latency: '1.1 ms', handled: true },
  ]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: logSeq++, time: now(), level: 'ok', msg: '[engine] workspace ready · 3 automations loaded' },
    { id: logSeq++, time: now(), level: 'info', msg: '[hooks] keyboard trigger monitor ready · native bridge optional' },
    { id: logSeq++, time: now(), level: 'info', msg: '[tray] desktop shell idle · waiting for events' },
  ]);

  const [isExecuting, setIsExecuting] = useState(false);
  const [currentExecNode, setCurrentExecNode] = useState<string | null>(null);
  const [killFlash, setKillFlash] = useState(false);

  const [cpuHistory, setCpuHistory] = useState<number[]>([0.3, 0.4, 0.3, 0.5, 0.4]);
  const [ramHistory, setRamHistory] = useState<number[]>([28.1, 28.2, 28.2, 28.3, 28.2]);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([0.8, 1.1, 0.7, 1.0, 0.9, 1.2, 0.8]);

  const abortRef = useRef<AbortController | null>(null);
  const executingRef = useRef(false);
  const mountedRef = useRef(true);
  const runFlowRef = useRef<() => void>(() => {});
  const killSwitchRef = useRef<(source: string) => void>(() => {});
  const eventSeq = useRef(1);

  // Abort any in-flight execution when the app is torn down. This also makes
  // the async runner safe during React StrictMode remounts and native window
  // disposal: no continuation can retain the component indefinitely.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      executingRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const flow = flows.find((f) => f.id === flowId) ?? flows[0];

  const appendLog = useCallback((level: LogLevel, msg: string) => {
    setLogs((l) => [{ id: logSeq++, time: now(), level, msg }, ...l].slice(0, 60));
  }, []);

  const recordLatency = useCallback((ms: number) => {
    setLatencyHistory((h) => [...h.slice(-39), +ms.toFixed(2)]);
  }, []);

  const triggerKillSwitch = useCallback(
    (source: string) => {
      setKillFlash(true);
      timers.setTimeout(() => setKillFlash(false), 900);

      if (!executingRef.current) {
        appendLog('warn', `[stop] ${source} · nothing running`);
        return;
      }

      appendLog('err', `[stop] emergency abort from ${source}`);
      abortRef.current?.abort();
    },
    [appendLog, timers]
  );

  useEffect(() => {
    killSwitchRef.current = triggerKillSwitch;
  }, [triggerKillSwitch]);

  // Global kill switch + hook simulation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Escape') {
        e.preventDefault();
        killSwitchRef.current('Ctrl+Shift+Esc');
        return;
      }
      if (e.ctrlKey && e.altKey && e.key.length === 1) {
        const id = ++eventSeq.current;
        setHookEvents((p) =>
          [
            {
              id,
              key: `Ctrl+Alt+${e.key.toUpperCase()}`,
              code: e.code,
              modifiers: ['Ctrl', 'Alt'],
              timestamp: now(),
              latency: (0.6 + Math.random() * 0.9).toFixed(1) + ' ms',
              handled: true,
            },
            ...p,
          ].slice(0, 6)
        );
        recordLatency(0.6 + Math.random() * 0.8);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recordLatency]);

  // Native bridge (Tauri global shortcut + tray) — no-ops in the browser.
  // Refs keep this subscription stable while still calling the latest
  // callbacks; rebinding it on every execution state change is unnecessary and
  // can race with the asynchronous `listen()` registration.
  useEffect(() => {
    let disposed = false;
    let dispose = () => {};
    bindTauriEvents({
      onKillSwitch: (src) => killSwitchRef.current(`native:${src}`),
      onRunFlow: () => runFlowRef.current(),
    }).then((d) => {
      if (disposed) d();
      else dispose = d;
    });
    return () => {
      disposed = true;
      dispose();
    };
  }, []);

  // Resource heartbeat (Real hardware metrics)
  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      const [cpu, ram] = await getSystemStats();
      if (!active) return;
      setCpuHistory((h) => [...h.slice(-39), +cpu.toFixed(1)]);
      setRamHistory((h) => [...h.slice(-39), +ram.toFixed(1)]);
    };
    
    void fetchStats();
    const id = timers.setInterval(() => void fetchStats(), 1200);
    return () => {
      active = false;
      timers.clearInterval(id);
    };
  }, [timers]);

  const handleNodesChange = useCallback(
    (nodes: Flow['nodes']) => setFlows((fs) => fs.map((f) => (f.id === flowId ? { ...f, nodes } : f))),
    [flowId]
  );
  const handleEdgesChange = useCallback(
    (edges: Flow['edges']) => setFlows((fs) => fs.map((f) => (f.id === flowId ? { ...f, edges } : f))),
    [flowId]
  );

  const handleAddNode = useCallback(
    (kind: NodeKind) => {
      const tpl = PALETTE.find((x) => x.kind === kind);
      if (!tpl) return;
      const currentFlow = flows.find((candidate) => candidate.id === flowId);
      if (!currentFlow) return;
      let id = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      while (currentFlow.nodes.some((node) => node.id === id)) {
        id = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      }
      const defaults: Record<string, string> =
        kind === 'delay'
          ? { ms: '500' }
          : kind === 'send_keys'
            ? { keys: 'Hello {CLIPBOARD}' }
            : kind === 'powershell'
              ? { script: 'Write-Output "ok"', timeout_ms: '5000' }
              : kind === 'notification'
                ? { title: 'MacroFlow', body: 'Action completed' }
                : kind === 'open_url'
                  ? { url: 'https://google.com' }
                  : kind === 'close_app'
                    ? { exe: 'notepad' }
                    : kind === 'open_app'
                      ? { exe: 'notepad.exe' }
                      : kind === 'focus_window'
                        ? { title: 'Calculator' }
                        : kind === 'mouse_click'
                        ? { button: 'left' }
                        : kind === 'mouse_move'
                          ? { x: '500', y: '500' }
                          : kind === 'take_screenshot'
                            ? { filename: 'screenshot.png' }
                            : { value: '…' };
      const node: Flow['nodes'][number] = {
        id,
        kind,
        category: tpl.cat,
        label: tpl.label,
        x: 240 + Math.random() * 280,
        y: 140 + Math.random() * 130,
        config: defaults,
        color: tpl.color,
        icon: tpl.icon,
      };
      setFlows((fs) =>
        fs.map((f) => {
          if (f.id !== flowId) return f;
          const edges = selectedNodeId ? [...f.edges, { from: selectedNodeId, to: id }] : f.edges;
          return { ...f, nodes: [...f.nodes, node], edges };
        })
      );
      setSelectedNodeId(id);
      appendLog('info', `[designer] added ${tpl.label}`);
    },
    [flowId, selectedNodeId, flows, appendLog]
  );

  const runFlow = useCallback(async (overrideFlowId?: string) => {
    // State updates are asynchronous, so `isExecuting` alone cannot prevent
    // two same-tick clicks/native events from starting two runners. The ref is
    // the synchronous execution lock; the state remains the render signal.
    if (executingRef.current) return;

    const targetFlow = overrideFlowId ? flows.find(f => f.id === overrideFlowId) : flow;
    if (!targetFlow) return;

    const ctl = new AbortController();
    executingRef.current = true;
    abortRef.current = ctl;
    if (mountedRef.current) {
      setIsExecuting(true);
      setExecutingFlowId(targetFlow.id);
      setCurrentExecNode(null);
      appendLog('info', `[engine] ▶ running "${targetFlow.name}" · ${targetFlow.nodes.length} nodes`);
    }

    try {
      const triggers = targetFlow.nodes.filter((n) => n.category === 'trigger').map((n) => n.id);
      const q = triggers.length > 0 ? [...triggers] : targetFlow.nodes.length > 0 ? [targetFlow.nodes[0].id] : [];
      const seen = new Set<string>();
      const repeatCounts = new Map<string, number>();

      while (q.length > 0) {
        if (ctl.signal.aborted) break;
        const id = q.shift()!;

        const node = targetFlow.nodes.find((n) => n.id === id);
        if (!node) continue;

        if (node.kind === 'repeat') {
          const maxLoops = parseInt(node.config.count || '3', 10);
          const currentLoop = (repeatCounts.get(id) || 0) + 1;
          repeatCounts.set(id, currentLoop);

          if (currentLoop > maxLoops) {
            seen.add(id);
            continue;
          }

          // Unmark target loop nodes so they can execute again
          const loopTargetId = node.config.target || targetFlow.edges.find((e) => e.from === id)?.to;
          if (loopTargetId) {
            const resetStack = [loopTargetId];
            const visited = new Set<string>();
            while (resetStack.length > 0) {
              const cur = resetStack.pop()!;
              if (visited.has(cur) || cur === id) continue;
              visited.add(cur);
              seen.delete(cur);
              targetFlow.edges.filter((e) => e.from === cur).forEach((e) => resetStack.push(e.to));
            }
          }
        } else {
          if (seen.has(id)) continue;
          seen.add(id);
        }

        if (mountedRef.current) {
          setCurrentExecNode(id);
          appendLog('inject', `[run] → ${node.label}`);
        }
        try {
          const t0 = performance.now();
          const result = await executeNode(node.kind, node.config);
          const t1 = performance.now();
          if (ctl.signal.aborted) break;
          if (mountedRef.current) {
            appendLog('ok', `[done] ${node.label} (${result})`);
            recordLatency(t1 - t0);
          }

          let nextNodes: string[] = [];
          if (node.kind === 'condition') {
             const branchId = result === 'true' ? node.config.then : node.config.else;
             if (branchId) nextNodes.push(branchId);
          } else {
             nextNodes = targetFlow.edges.filter((e) => e.from === id).map((e) => e.to);
          }
          q.push(...nextNodes);
        } catch (err: any) {
          if (mountedRef.current) {
            appendLog('err', `[error] ${node.label}: ${err.message}`);
          }
          break;
        }
      }

      if (mountedRef.current) {
        appendLog(
          ctl.signal.aborted ? 'warn' : 'ok',
          ctl.signal.aborted
            ? '[engine] execution aborted safely · handles released'
            : '[engine] ✔ flow finished'
        );
      }
    } finally {
      // Only clear the controller that belongs to this run. This protects the
      // ref if a future runner is ever started during teardown/race handling.
      if (abortRef.current === ctl) abortRef.current = null;
      executingRef.current = false;
      if (mountedRef.current) {
        setCurrentExecNode(null);
        setIsExecuting(false);
        setExecutingFlowId(null);
      }
    }
  }, [flow, flows, appendLog, recordLatency]);

  useEffect(() => {
    runFlowRef.current = runFlow;
  }, [runFlow]);

  const toggleFlow = (id: string) =>
    setFlows((fs) => fs.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)));

  const handleImportFlow = useCallback((flow: Flow) => {
    setFlows((fs) => [...fs, flow]);
    appendLog('ok', `[import] imported flow "${flow.name}"`);
  }, [appendLog]);

  const handleCreateFlow = useCallback(() => {
    const newFlow: Flow = {
      id: `flow-${Date.now()}`,
      name: `New Flow ${flows.length + 1}`,
      description: 'A new empty flow',
      enabled: true,
      nodes: [],
      edges: []
    };
    setFlows(fs => [...fs, newFlow]);
    setFlowId(newFlow.id);
    setActiveTab('designer');
    appendLog('info', `[designer] created "${newFlow.name}"`);
  }, [flows.length, appendLog]);

  const handleDeleteFlow = useCallback((id: string) => {
    setFlows(fs => fs.filter(f => f.id !== id));
    if (flowId === id) {
      const remaining = flows.filter(f => f.id !== id);
      if (remaining.length > 0) setFlowId(remaining[0].id);
    }
    appendLog('info', `[dashboard] deleted flow`);
  }, [flows, flowId, appendLog]);

  const handleExportFlow = useCallback(async (id: string) => {
    const target = flows.find(f => f.id === id);
    if (!target) return;
    try {
      const result = await invoke<string>('export_flow', { 
        name: target.name,
        data: JSON.stringify(target, null, 2)
      });
      appendLog('ok', `[export] ${result}`);
    } catch (e: any) {
      appendLog('err', `[export] Failed: ${e}`);
    }
  }, [flows, appendLog]);

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-surface text-ink">
        {/* Titlebar */}
        <div data-tauri-drag-region className="h-[46px] flex items-center justify-between px-3 select-none shrink-0 bg-elevated border-b border-line">
          <div data-tauri-drag-region className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-brand-strong grid place-items-center text-brand-fg shadow">
              <Icon name="nodes" size={17} />
            </div>
            <span className="text-[13.5px] font-bold tracking-[-0.01em] text-ink hidden sm:inline">MacroFlow</span>
            <span className="ml-1 hidden lg:inline-flex items-center gap-1.5 text-[10.5px] bg-success/12 text-success px-2 py-1 rounded-full font-semibold">
              <span className={`w-1.5 h-1.5 rounded-full ${isExecuting ? 'bg-warn animate-pulse' : 'bg-success'}`} />
              {isExecuting ? 'Running' : 'Idle'} · {(cpuHistory.at(-1) ?? 0.4).toFixed(1)}% CPU
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggle}
              className="flex items-center gap-1.5 mr-1 h-8 px-2.5 rounded-lg hover:bg-ink/[0.06] text-ink-2 transition-colors"
              title={`Theme: ${pref}`}
            >
              <Icon name={resolved === 'dark' ? 'moon' : 'sun'} size={15} />
              <span className="text-[11px] font-medium capitalize hidden sm:inline">{pref}</span>
            </button>
            <div className="w-px h-5 bg-line mx-1" />
            <button
              type="button"
              onClick={() => void minimizeWindow()}
              aria-label="Minimize window"
              className="w-9 h-8 grid place-items-center hover:bg-ink/[0.06] rounded-lg text-ink-2 transition-colors"
            >
              <Icon name="minus" size={14} />
            </button>
            <button
              type="button"
              onClick={() => void toggleMaximizeWindow()}
              aria-label="Maximize window"
              className="w-9 h-8 grid place-items-center hover:bg-ink/[0.06] rounded-lg text-ink-2 transition-colors"
            >
              <Icon name="square" size={12} />
            </button>
            <button
              type="button"
              onClick={() => void closeWindow(settings.minimizeToTray)}
              aria-label={settings.minimizeToTray ? 'Hide to system tray' : 'Close window'}
              className="w-9 h-8 grid place-items-center hover:bg-danger hover:text-white rounded-lg text-ink-2 transition-colors"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[62px] lg:w-[196px] bg-elevated border-r border-line flex flex-col shrink-0">
            <div className="p-2 lg:p-2.5 space-y-1">
              {NAV.map((it) => (
                <button
                  key={it.id}
                  onClick={() => setActiveTab(it.id)}
                  className={`w-full flex items-center gap-2.5 px-2 lg:px-3 py-2 rounded-lg text-left transition-all relative ${
                    activeTab === it.id ? 'bg-surface shadow-card text-brand' : 'hover:bg-ink/[0.05] text-ink-2'
                  }`}
                >
                  {activeTab === it.id && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-brand" />}
                  <span className={`w-8 h-8 grid place-items-center rounded-lg transition-colors ${activeTab === it.id ? 'bg-brand text-brand-fg' : 'bg-surface border border-line text-ink-2'}`}>
                    <Icon name={it.icon} size={15} />
                  </span>
                  <span className={`hidden lg:block text-[12.5px] font-semibold ${activeTab === it.id ? 'text-ink' : 'text-ink-2'}`}>{it.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-auto p-2.5 hidden lg:block">
              <div className="rounded-xl bg-gradient-to-br from-danger to-[#a81c27] p-3 text-white shadow-card">
                <div className="text-[9.5px] font-bold tracking-[0.16em] opacity-85 flex items-center gap-1"><Icon name="shield" size={11} /> KILL SWITCH</div>
                <div className="text-[12px] font-black mt-0.5">Ctrl + Shift + X</div>
                <button
                  onClick={() => triggerKillSwitch('Sidebar')}
                  className="mt-2 w-full bg-white/95 hover:bg-white text-danger text-[10.5px] font-black py-1.5 rounded-lg transition-colors"
                >
                  TEST STOP
                </button>
              </div>
              <div className="flex items-center gap-2 px-1 mt-2.5 text-[10.5px] text-ink-3">
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> v1.5.0 · Win 10/11
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 bg-canvas relative overflow-hidden flex flex-col">
            {killFlash && (
              <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center">
                <div className="absolute inset-0 bg-danger/15 backdrop-blur-[1.5px] kill-flash" />
                <div className="relative bg-danger text-white px-7 py-4 rounded-2xl shadow-pop flex items-center gap-4 kill-flash">
                  <Icon name="shield" size={28} strokeWidth={2.2} />
                  <div>
                    <div className="font-black text-[15px] tracking-wide">EMERGENCY STOP</div>
                    <div className="text-[12px] opacity-90 mt-0.5">Aborting all running macros…</div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto custom-scrollbar">
              <div key={activeTab}>
                {activeTab === 'dashboard' && (
                  <Dashboard
                    flows={flows}
                    hookEvents={hookEvents}
                    logs={logs}
                    nodes={isExecuting && executingFlowId ? (flows.find(f => f.id === executingFlowId)?.nodes || []) : (flow?.nodes || [])}
                    isExecuting={isExecuting}
                    currentExecNode={currentExecNode}
                    cpuHistory={cpuHistory}
                    ramHistory={ramHistory}
                    latencyHistory={latencyHistory}
                    onRun={(id) => runFlow(id)}
                    onKill={triggerKillSwitch}
                    onToggleFlow={toggleFlow}
                    onEditFlow={(id) => {
                      setFlowId(id);
                      setSelectedNodeId(null);
                      setActiveTab('designer');
                    }}
                    onImportFlow={handleImportFlow}
                    onCreateFlow={handleCreateFlow}
                    onDeleteFlow={handleDeleteFlow}
                    onExportFlow={handleExportFlow}
                  />
                )}
                {activeTab === 'designer' && (
                  <Designer
                    flows={flows}
                    flowId={flowId}
                    nodes={flow.nodes}
                    edges={flow.edges}
                    selectedNodeId={selectedNodeId}
                    isExecuting={isExecuting}
                    currentExecNode={currentExecNode}
                    onSelectFlow={setFlowId}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={handleEdgesChange}
                    onSelectNode={setSelectedNodeId}
                    onAddNode={handleAddNode}
                    onRun={(id) => runFlow(id)}
                    onKill={() => triggerKillSwitch('Designer')}
                    onExportFlow={handleExportFlow}
                  />
                )}
                {activeTab === 'settings' && (
                  <Settings themePref={pref} onThemeChange={setPref} settings={settings} onSettingsChange={setSettings} />
                )}
              </div>
            </div>

            {/* Status bar */}
            <div className="h-[28px] bg-elevated border-t border-line flex items-center px-3 gap-3 text-[11px] shrink-0">
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <span className={`w-2 h-2 rounded-full ${isExecuting ? 'bg-warn animate-pulse' : 'bg-success'}`} />
                {isExecuting ? 'Running macro…' : 'Listening for triggers'}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span className="hidden sm:flex items-center gap-1.5 bg-surface border border-line px-2 py-0.5 rounded-full font-mono text-[10px] text-ink-2">
                  <Icon name="shield" size={10} className="text-danger" /> Ctrl+Shift+X
                </span>
              </span>
            </div>
          </div>
        </div>
    </div>
  );
}
