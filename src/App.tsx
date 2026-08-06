import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './components/Icon';
import Dashboard from './components/Dashboard';
import Designer from './components/Designer';
import Settings from './components/Settings';
import { useSafeTimers } from './hooks/useSafeTimers';
import { useTheme } from './hooks/useTheme';
import { useFlowHistory } from './hooks/useFlowHistory';
import {
  bindTauriEvents,
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
  executeNode,
  getSystemStats,
  getAiConfig,
  setAiConfig,
} from './lib/tauri';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_FLOWS, PALETTE } from './data';
import type { Flow, HookEvent, LogEntry, LogLevel, NodeKind, Settings as AppSettings, TabId } from './types';
import { autoLayout } from './utils/layout';

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
  aiProvider: 'auto',
  aiEndpoint: 'http://localhost:11434',
  aiModel: 'llama3.2',
  aiVisionModel: 'llava',
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
      aiProvider: (stored.aiProvider === 'ollama' || stored.aiProvider === 'openai' || stored.aiProvider === 'anthropic' || stored.aiProvider === 'auto') ? stored.aiProvider : DEFAULT_SETTINGS.aiProvider,
      aiEndpoint: typeof stored.aiEndpoint === 'string' ? stored.aiEndpoint : DEFAULT_SETTINGS.aiEndpoint,
      aiModel: typeof stored.aiModel === 'string' ? stored.aiModel : DEFAULT_SETTINGS.aiModel,
      aiVisionModel: typeof stored.aiVisionModel === 'string' ? stored.aiVisionModel : DEFAULT_SETTINGS.aiVisionModel,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const FLOWS_STORAGE_KEY = 'macroflow.flows';

function readStoredFlows(): Flow[] {
  if (typeof localStorage === 'undefined') return DEFAULT_FLOWS;
  try {
    const stored = JSON.parse(localStorage.getItem(FLOWS_STORAGE_KEY) ?? 'null') as Flow[] | null;
    if (!stored || !Array.isArray(stored) || stored.length === 0) return DEFAULT_FLOWS;
    // Merge new default example flows for existing users without wiping their custom flows
    const merged = [...stored];
    let changed = false;
    for (const df of DEFAULT_FLOWS) {
      if (!merged.some(f => f.id === df.id)) {
        merged.push(df);
        changed = true;
      }
    }
    // keep merged for next save (will be persisted via useEffect)
    if (changed) {
      try { localStorage.setItem(FLOWS_STORAGE_KEY, JSON.stringify(merged)); } catch {}
    }
    return merged;
  } catch {
    return DEFAULT_FLOWS;
  }
}

export default function App() {
  const { pref, resolved, setPref, toggle } = useTheme();
  const timers = useSafeTimers();

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [flows, setFlowsRaw] = useState<Flow[]>(() => readStoredFlows());
  const [flowId, setFlowId] = useState('flow-matrix');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [executingFlowId, setExecutingFlowId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => readStoredSettings());

  const history = useFlowHistory(flows);

  // Wrapped setFlows that also pushes to history
  const setFlows = useCallback((updater: Flow[] | ((prev: Flow[]) => Flow[])) => {
    setFlowsRaw(prev => {
      const next = typeof updater === 'function' ? (updater as (prev: Flow[])=>Flow[])(prev) : updater;
      // only push if not during undo/redo
      if (!history.isApplying()) {
        // Use a microtask to push after state committed? Push now synchronously
        // But history.push expects Flow[] snapshot. We'll call after.
        // Since setFlowsRaw is async, we push cloned next
        queueMicrotask(() => history.push(next));
      }
      return next;
    });
  }, [history]);

  // Keep history synced on first mount (already initialized with initial)
  // But we need to handle pushes for future updates via effect watching flows would duplicate.
  // Instead we rely on setFlows wrapper above. Also ensure initial is not duplicated.
  // For external pushes (undo/redo) we need to apply without pushing.

  const handleUndo = useCallback(() => {
    const prev = history.undo();
    if (prev) {
      setFlowsRaw(prev);
    }
  }, [history]);

  const handleRedo = useCallback(() => {
    const nxt = history.redo();
    if (nxt) {
      setFlowsRaw(nxt);
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(FLOWS_STORAGE_KEY, JSON.stringify(flows));
    } catch {}
  }, [flows]);

  // Sync AI provider between frontend and Rust (hybrid Ollama/OpenAI)
  useEffect(() => {
    getAiConfig().then(([p,e,m,v]) => {
      if (p !== settings.aiProvider || e !== settings.aiEndpoint || m !== settings.aiModel || v !== settings.aiVisionModel) {
        setSettings(s => ({ ...s, aiProvider: p as any, aiEndpoint: e, aiModel: m, aiVisionModel: v }));
      }
    }).catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setAiConfig(settings.aiProvider, settings.aiEndpoint, settings.aiModel, settings.aiVisionModel).catch(()=>{});
  }, [settings.aiProvider, settings.aiEndpoint, settings.aiModel, settings.aiVisionModel]);

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
  const copyBufferRef = useRef<Flow['nodes'] | null>(null);

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

  // Global keyboard: kill switch + hook simulation + designer hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // kill switch
      if (e.ctrlKey && e.shiftKey && e.code === 'Escape') {
        e.preventDefault();
        killSwitchRef.current('Ctrl+Shift+Esc');
        return;
      }
      // Undo/Redo only when designer active or not typing in input
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!isInput) {
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          handleUndo();
          appendLog('info', '[history] undo');
          return;
        }
        if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
          e.preventDefault();
          handleRedo();
          appendLog('info', '[history] redo');
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'd' && selectedNodeId) {
          e.preventDefault();
          handleDuplicateNodes([selectedNodeId]);
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'c' && selectedIds.length>0) {
          // copy
          const curFlow = flows.find(f=>f.id===flowId);
          if (curFlow) {
            const toCopy = curFlow.nodes.filter(n=> selectedIds.includes(n.id) || n.id===selectedNodeId);
            if (toCopy.length>0) {
              copyBufferRef.current = JSON.parse(JSON.stringify(toCopy));
              appendLog('info', `[copy] ${toCopy.length} node(s) copied`);
            }
          }
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'v' && copyBufferRef.current) {
          e.preventDefault();
          handlePaste();
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput && (selectedNodeId || selectedIds.length>0)) {
          // delete selected nodes via Designer handler? We'll let Designer handle Delete, but also here as fallback
        }
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
  }, [recordLatency, handleUndo, handleRedo, selectedNodeId, selectedIds, flows, flowId, appendLog]);

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
    [flowId, setFlows]
  );
  const handleEdgesChange = useCallback(
    (edges: Flow['edges']) => setFlows((fs) => fs.map((f) => (f.id === flowId ? { ...f, edges } : f))),
    [flowId, setFlows]
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
              ? { script: 'Write-Output \"ok\"', timeout_ms: '5000' }
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
                            : kind === 'http_request'
                              ? { url: 'https://api.example.com', method: 'GET', headers: '', body: '' }
                              : kind === 'file_write'
                                ? { path: '{DOCS_PATH}\\output.txt', content: 'Hello {DATE}' }
                                : kind === 'web_search'
                                  ? { query: 'MacroFlow', engine: 'google' }
                                  : kind === 'repeat'
                                    ? { count: '3' }
                                    : kind === 'condition'
                                      ? { expr: 'len({CLIPBOARD}) > 0', then: '', else: '' }
                                      : kind === 'ocr_screen'
                                        ? { lang: 'eng', psm: '6', region: 'full' }
                                        : kind === 'find_image'
                                          ? { template: 'button.png', threshold: '0.8' }
                                          : kind === 'for_each'
                                            ? { items: '{CLIPBOARD}', delimiter: '\\n' }
                                            : kind === 'json_parse'
                                              ? { json: '{"key":"value"}', path: '$.key' }
                                              : kind === 'lock_pc'
                                                ? {}
                                                : kind === 'volume_control'
                                                  ? { level: '50' }
                                                  : kind === 'file_watcher'
                                                    ? { path: '{DOCS_PATH}\\watch.txt', interval: '1000' }
                                                    : kind === 'at_time'
                                                      ? { cron: '0 9 * * 1', timezone: 'local' }
                                                      : kind === 'ai_prompt'
                                                        ? { provider: 'auto', model: 'llama3.2', prompt: 'Summarize: {OCR_TEXT}', temperature: '0.2' }
                                                        : kind === 'ai_condition'
                                                          ? { provider: 'auto', model: 'llama3.2', question: 'Is this invoice total > 100? {OCR_TEXT}' }
                                                          : kind === 'ai_vision'
                                                            ? { provider: 'auto', model: 'llava', prompt: 'Describe this image' }
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
      // Track recent palette usage
      try {
        const key = 'macroflow.recent';
        const raw = JSON.parse(localStorage.getItem(key) || '[]') as string[];
        const updated = [kind, ...raw.filter(k=>k!==kind)].slice(0,6);
        localStorage.setItem(key, JSON.stringify(updated));
      } catch {}
      // Determine primary selection for auto-connect
      const connectFrom = selectedIds.length===1 ? selectedIds[0] : selectedNodeId;
      setFlows((fs) =>
        fs.map((f) => {
          if (f.id !== flowId) return f;
          const edges = connectFrom ? [...f.edges, { from: connectFrom, to: id }] : f.edges;
          return { ...f, nodes: [...f.nodes, node], edges };
        })
      );
      setSelectedNodeId(id);
      setSelectedIds([id]);
      appendLog('info', `[designer] added ${tpl.label}`);
    },
    [flowId, selectedNodeId, selectedIds, flows, appendLog, setFlows]
  );

  const handleDuplicateNodes = useCallback((ids: string[]) => {
    const cur = flows.find(f=>f.id===flowId);
    if (!cur) return;
    const toDup = cur.nodes.filter(n=>ids.includes(n.id));
    if (toDup.length===0) return;
    const idMap = new Map<string,string>();
    const newNodes = toDup.map(n=>{
      let nid = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
      while (cur.nodes.some(x=>x.id===nid) || Array.from(idMap.values()).includes(nid)) {
        nid = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
      }
      idMap.set(n.id, nid);
      return { ...n, id: nid, x: n.x + 24, y: n.y + 24, label: n.label + ' copy' };
    });
    // duplicate internal edges
    const internalEdges = cur.edges.filter(e=> idMap.has(e.from) && idMap.has(e.to)).map(e=> ({ from: idMap.get(e.from)!, to: idMap.get(e.to)!}));
    setFlows(fs=> fs.map(f=> f.id!==flowId ? f : { ...f, nodes: [...f.nodes, ...newNodes], edges: [...f.edges, ...internalEdges]}));
    const newIds = newNodes.map(n=>n.id);
    setSelectedIds(newIds);
    setSelectedNodeId(newIds[0]||null);
    appendLog('info', `[designer] duplicated ${newNodes.length} node(s)`);
  }, [flows, flowId, appendLog, setFlows]);

  const handlePaste = useCallback(()=>{
    const buf = copyBufferRef.current;
    if (!buf || buf.length===0) return;
    const cur = flows.find(f=>f.id===flowId);
    if (!cur) return;
    const idMap = new Map<string,string>();
    const newNodes = buf.map(n=>{
      let nid = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
      while (cur.nodes.some(x=>x.id===nid) || Array.from(idMap.values()).includes(nid)) nid = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
      idMap.set(n.id, nid);
      return { ...JSON.parse(JSON.stringify(n)), id: nid, x: n.x + 32, y: n.y + 32, label: n.label };
    });
    const internalEdges = buf.length>1 ? (() => {
      // Reconstruct edges among buffered nodes by looking at original flow edges that were among buffered ids
      const origFlow = flows.find(f=> buf.every(b=> f.nodes.some(nn=>nn.id===b.id))) || cur;
      return origFlow.edges.filter(e=> idMap.has(e.from) && idMap.has(e.to)).map(e=> ({ from: idMap.get(e.from)!, to: idMap.get(e.to)!}));
    })() : [];
    setFlows(fs=> fs.map(f=> f.id!==flowId ? f : { ...f, nodes: [...f.nodes, ...newNodes], edges: [...f.edges, ...internalEdges]}));
    const newIds = newNodes.map(n=>n.id);
    setSelectedIds(newIds);
    setSelectedNodeId(newIds[0]||null);
    appendLog('info', `[paste] ${newNodes.length} node(s)`);
  }, [flows, flowId, appendLog, setFlows]);

  const handleAutoLayout = useCallback(()=>{
    const cur = flows.find(f=>f.id===flowId);
    if (!cur) return;
    const laid = autoLayout(cur.nodes, cur.edges);
    setFlows(fs=> fs.map(f=> f.id===flowId ? { ...f, nodes: laid } : f));
    appendLog('info', '[layout] auto-arranged');
  }, [flows, flowId, setFlows, appendLog]);

  const handleDragStateChange = useCallback((dragging: boolean)=>{
    if (dragging) history.pause();
    else history.resume();
  }, [history]);

  const runFlow = useCallback(async (overrideFlowId?: string) => {
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
        if (node.kind === 'repeat' || node.kind === 'for_each') {
          let maxLoops: number;
          if (node.kind === 'for_each') {
            const raw = node.config.items || '';
            // Resolve simple vars for accurate loop count (OCR_TEXT, CLIPBOARD)
            let resolved = raw;
            // crude front-end var resolve for demo (Rust does real resolve)
            if (resolved.includes('{OCR_TEXT}')) resolved = resolved.replaceAll('{OCR_TEXT}', 'line1\nline2\nline3');
            if (resolved.includes('{CLIPBOARD}')) resolved = resolved.replaceAll('{CLIPBOARD}', 'a,b,c');
            const delimRaw = node.config.delimiter || ',';
            const delim = delimRaw === '\\n' ? '\n' : delimRaw;
            const parts = resolved.split(delim).filter(s=> s.trim().length>0);
            maxLoops = Math.max(1, parts.length);
            // cap for safety
            maxLoops = Math.min(maxLoops, 20);
          } else {
            maxLoops = parseInt(node.config.count || '3', 10);
          }
          const currentLoop = (repeatCounts.get(id) || 0) + 1;
          repeatCounts.set(id, currentLoop);
          if (currentLoop > maxLoops) {
            seen.add(id);
            continue;
          }
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
          if (node.kind === 'condition' || node.kind === 'ai_condition') {
             // ai_condition returns true/false via AI
             const isTrue = result.trim().toLowerCase().startsWith('true');
             const branchId = isTrue ? node.config.then : node.config.else;
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
  }, [appendLog, setFlows]);

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
  }, [flows.length, appendLog, setFlows]);

  const handleDeleteFlow = useCallback((id: string) => {
    setFlows(fs => fs.filter(f => f.id !== id));
    if (flowId === id) {
      const remaining = flows.filter(f => f.id !== id);
      if (remaining.length > 0) setFlowId(remaining[0].id);
    }
    appendLog('info', `[dashboard] deleted flow`);
  }, [flows, flowId, appendLog, setFlows]);

  const handleDuplicateFlow = useCallback((id?: string) => {
    const srcId = id || flowId;
    const src = flows.find(f=>f.id===srcId);
    if (!src) return;
    const clone: Flow = JSON.parse(JSON.stringify(src));
    clone.id = `flow-${Date.now()}`;
    clone.name = src.name + ' Copy';
    // regenerate node ids to avoid collisions? Keep same ids within cloned flow is fine because flow is isolated
    // But to be safe, regenerate
    const idMap = new Map<string,string>();
    clone.nodes = clone.nodes.map(n=>{
      const nid = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
      idMap.set(n.id, nid);
      return { ...n, id: nid };
    });
    clone.edges = clone.edges.map(e=> ({ from: idMap.get(e.from)||e.from, to: idMap.get(e.to)||e.to}));
    // fix condition then/else references
    clone.nodes = clone.nodes.map(n=>{
      if (n.kind==='condition') {
        const nc = { ...n.config };
        if (nc.then) nc.then = idMap.get(nc.then) || nc.then;
        if (nc.else) nc.else = idMap.get(nc.else) || nc.else;
        return { ...n, config: nc };
      }
      return n;
    });
    setFlows(fs=> [...fs, clone]);
    setFlowId(clone.id);
    appendLog('info', `[flow] duplicated "${src.name}"`);
  }, [flows, flowId, appendLog, setFlows]);

  const handleRenameFlow = useCallback((id: string, name: string, description?: string)=>{
    setFlows(fs=> fs.map(f=> f.id===id ? { ...f, name: name.trim()||f.name, description: description!==undefined ? description : f.description } : f));
    appendLog('info', `[flow] renamed to "${name}"`);
  }, [appendLog, setFlows]);

  const handleRestoreExamples = useCallback(() => {
    const missing = DEFAULT_FLOWS.filter(df => !flows.some(f=> f.id===df.id));
    if (missing.length===0) {
      appendLog('info', '[examples] all 7 already present');
      return;
    }
    setFlows(fs => [...fs, ...missing]);
    appendLog('ok', `[examples] restored ${missing.length} flows`);
  }, [flows, setFlows, appendLog]);

  const handleResetExamples = useCallback(() => {
    setFlows(DEFAULT_FLOWS);
    setFlowId(DEFAULT_FLOWS[0].id);
    setSelectedNodeId(null);
    setSelectedIds([]);
    appendLog('warn', '[examples] reset to 7 defaults');
  }, [setFlows, appendLog]);

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
            {(history.canUndo || history.canRedo) && (
              <span className="hidden xl:inline-flex items-center gap-1 text-[10px] text-ink-3 ml-2">
                <span className="w-px h-4 bg-line mx-1" />
                Ctrl+Z / Ctrl+Y
              </span>
            )}
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
            <button type="button" onClick={() => void minimizeWindow()} aria-label="Minimize" className="w-9 h-8 grid place-items-center hover:bg-ink/[0.06] rounded-lg text-ink-2 transition-colors"><Icon name="minus" size={14} /></button>
            <button type="button" onClick={() => void toggleMaximizeWindow()} aria-label="Maximize" className="w-9 h-8 grid place-items-center hover:bg-ink/[0.06] rounded-lg text-ink-2 transition-colors"><Icon name="square" size={12} /></button>
            <button type="button" onClick={() => void closeWindow(settings.minimizeToTray)} aria-label={settings.minimizeToTray ? 'Hide to tray' : 'Close'} className="w-9 h-8 grid place-items-center hover:bg-danger hover:text-white rounded-lg text-ink-2 transition-colors"><Icon name="x" size={14} /></button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
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
                <button onClick={() => triggerKillSwitch('Sidebar')} className="mt-2 w-full bg-white/95 hover:bg-white text-danger text-[10.5px] font-black py-1.5 rounded-lg transition-colors">TEST STOP</button>
              </div>
              <div className="flex items-center gap-2 px-1 mt-2.5 text-[10.5px] text-ink-3"><span className="w-1.5 h-1.5 rounded-full bg-success" /> v1.6.0 · Win 10/11</div>
            </div>
          </div>

          <div className="flex-1 min-w-0 bg-canvas relative overflow-hidden flex flex-col">
            {killFlash && (
              <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center">
                <div className="absolute inset-0 bg-danger/15 backdrop-blur-[1.5px] kill-flash" />
                <div className="relative bg-danger text-white px-7 py-4 rounded-2xl shadow-pop flex items-center gap-4 kill-flash">
                  <Icon name="shield" size={28} strokeWidth={2.2} />
                  <div><div className="font-black text-[15px] tracking-wide">EMERGENCY STOP</div><div className="text-[12px] opacity-90 mt-0.5">Aborting all running macros…</div></div>
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
                    onEditFlow={(id) => { setFlowId(id); setSelectedNodeId(null); setSelectedIds([]); setActiveTab('designer'); }}
                    onImportFlow={handleImportFlow}
                    onCreateFlow={handleCreateFlow}
                    onDeleteFlow={handleDeleteFlow}
                    onExportFlow={handleExportFlow}
                    onDuplicateFlow={handleDuplicateFlow}
                    onRenameFlow={handleRenameFlow}
                  />
                )}
                {activeTab === 'designer' && (
                  <Designer
                    flows={flows}
                    flowId={flowId}
                    nodes={flow.nodes}
                    edges={flow.edges}
                    selectedNodeId={selectedNodeId}
                    selectedIds={selectedIds}
                    isExecuting={isExecuting}
                    currentExecNode={currentExecNode}
                    canUndo={history.canUndo}
                    canRedo={history.canRedo}
                    onSelectFlow={setFlowId}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={handleEdgesChange}
                    onSelectNode={setSelectedNodeId}
                    onSelectIds={setSelectedIds}
                    onAddNode={handleAddNode}
                    onRun={(id) => runFlow(id)}
                    onKill={() => triggerKillSwitch('Designer')}
                    onExportFlow={handleExportFlow}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    onDuplicateNodes={handleDuplicateNodes}
                    onPaste={handlePaste}
                    onAutoLayout={handleAutoLayout}
                    onDuplicateFlow={handleDuplicateFlow}
                    onRenameFlow={handleRenameFlow}
                    onDragStateChange={handleDragStateChange}
                  />
                )}
                {activeTab === 'settings' && (
                  <Settings themePref={pref} onThemeChange={setPref} settings={settings} onSettingsChange={setSettings} onRestoreExamples={handleRestoreExamples} onResetExamples={handleResetExamples} flowsCount={flows.length} examplesCount={DEFAULT_FLOWS.length} />
                )}
              </div>
            </div>

            <div className="h-[28px] bg-elevated border-t border-line flex items-center px-3 gap-3 text-[11px] shrink-0">
              <span className="inline-flex items-center gap-1.5 text-ink-2"><span className={`w-2 h-2 rounded-full ${isExecuting ? 'bg-warn animate-pulse' : 'bg-success'}`} />{isExecuting ? 'Running macro…' : 'Listening for triggers'}</span>
              <span className="hidden md:inline-flex items-center gap-1.5 text-ink-3 ml-3">Ctrl+K palette · Ctrl+Z/Y undo · Shift+click multi-select</span>
              <span className="ml-auto flex items-center gap-2"><span className="hidden sm:flex items-center gap-1.5 bg-surface border border-line px-2 py-0.5 rounded-full font-mono text-[10px] text-ink-2"><Icon name="shield" size={10} className="text-danger" /> Ctrl+Shift+X</span></span>
            </div>
          </div>
        </div>
    </div>
  );
}
