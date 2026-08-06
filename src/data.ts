import type { Flow, PaletteItem } from './types';

export const PALETTE: PaletteItem[] = [
  { kind: 'hotkey', label: 'Global Hotkey', cat: 'trigger', icon: 'keyboard', color: '#0078D4', desc: 'Ctrl+Alt+?' },
  { kind: 'window_focus', label: 'Window Focus', cat: 'trigger', icon: 'window', color: '#0078D4', desc: 'window activated' },
  { kind: 'schedule', label: 'Scheduled', cat: 'trigger', icon: 'clock', color: '#0078D4', desc: 'interval / time' },
  { kind: 'startup', label: 'On Startup', cat: 'trigger', icon: 'power', color: '#0078D4', desc: 'app launch' },
  { kind: 'clipboard', label: 'Clipboard Change', cat: 'trigger', icon: 'copy', color: '#0078D4', desc: 'text copied' },
  { kind: 'send_keys', label: 'Send Keystrokes', cat: 'action', icon: 'type', color: '#4A5568', desc: 'type text' },
  { kind: 'mouse_click', label: 'Mouse Click', cat: 'action', icon: 'mouse', color: '#2B3A55', desc: 'click at x,y' },
  { kind: 'mouse_move', label: 'Mouse Move', cat: 'action', icon: 'move', color: '#2B3A55', desc: 'move cursor' },
  { kind: 'close_app', label: 'Close App', cat: 'action', icon: 'x', color: '#D13438', desc: 'kill process' },
  { kind: 'open_url', label: 'Open URL', cat: 'action', icon: 'globe', color: '#0078D4', desc: 'launch browser' },
  { kind: 'take_screenshot', label: 'Screenshot', cat: 'action', icon: 'camera', color: '#E01765', desc: 'save display' },
  { kind: 'powershell', label: 'Run Script', cat: 'action', icon: 'terminal', color: '#0F6CBD', desc: 'PowerShell' },
  { kind: 'delay', label: 'Wait', cat: 'action', icon: 'timer', color: '#5C6370', desc: 'pause ms' },
  { kind: 'condition', label: 'Condition', cat: 'action', icon: 'branch', color: '#D83B01', desc: 'if / else' },
  { kind: 'notification', label: 'Notification', cat: 'action', icon: 'bell', color: '#107C10', desc: 'toast' },
  { kind: 'open_app', label: 'Launch App', cat: 'action', icon: 'send', color: '#8764B8', desc: 'open program' },
  { kind: 'focus_window', label: 'Focus Window', cat: 'action', icon: 'eye', color: '#8764B8', desc: 'bring to front' },
  { kind: 'clipboard_set', label: 'Set Clipboard', cat: 'action', icon: 'clipboard', color: '#8764B8', desc: 'write text' },
];

export const VARIABLES = [
  { token: '{CLIPBOARD}', type: 'string', desc: 'current clipboard text' },
  { token: '{DATE}', type: 'string', desc: 'system date · yyyy-MM-dd' },
  { token: '{TIME}', type: 'string', desc: 'system time · HH:mm:ss' },
  { token: '{ACTIVE_WINDOW}', type: 'string', desc: 'focused window title' },
  { token: '{USER}', type: 'string', desc: 'current username' },
  { token: '{DOCS_PATH}', type: 'string', desc: 'Documents folder path' },
];

export const DEFAULT_FLOWS: Flow[] = [
  {
    id: 'flow-1',
    name: 'Web Search Automation',
    description: 'Opens a browser, waits to load, and performs a search automatically',
    enabled: true,
    nodes: [
      { id: 't1', kind: 'hotkey', category: 'trigger', label: 'Trigger', x: 40, y: 150, config: { hotkey: 'Run' }, color: '#0078D4', icon: 'keyboard' },
      { id: 'a1', kind: 'open_url', category: 'action', label: 'Open Google', x: 260, y: 150, config: { url: 'https://google.com' }, color: '#8764B8', icon: 'send' },
      { id: 'a2', kind: 'delay', category: 'action', label: 'Wait for load', x: 480, y: 150, config: { ms: '2000' }, color: '#5C6370', icon: 'timer' },
      { id: 'a3', kind: 'send_keys', category: 'action', label: 'Search query', x: 700, y: 150, config: { keys: 'MacroFlow automation tool{ENTER}' }, color: '#4A5568', icon: 'type' },
    ],
    edges: [
      { from: 't1', to: 'a1' },
      { from: 'a1', to: 'a2' },
      { from: 'a2', to: 'a3' },
    ],
  },
  {
    id: 'flow-2',
    name: 'Logic & Calculator Demo',
    description: 'Sets clipboard, checks condition, and uses Calculator robustly',
    enabled: true,
    nodes: [
      { id: 't1', kind: 'hotkey', category: 'trigger', label: 'Trigger', x: 40, y: 150, config: { hotkey: 'Run' }, color: '#0078D4', icon: 'keyboard' },
      { id: 'a1', kind: 'clipboard_set', category: 'action', label: 'Set Clipboard', x: 260, y: 150, config: { value: '777' }, color: '#8764B8', icon: 'clipboard' },
      { id: 'a2', kind: 'condition', category: 'action', label: 'Clipboard has text?', x: 480, y: 150, config: { expr: 'len({CLIPBOARD}) > 0', then: 'a3', else: 'a5' }, color: '#D83B01', icon: 'branch' },
      { id: 'a3', kind: 'open_app', category: 'action', label: 'Open CMD (THEN)', x: 740, y: 40, config: { exe: 'cmd.exe' }, color: '#8764B8', icon: 'send' },
      { id: 'a3_delay', kind: 'delay', category: 'action', label: 'Wait for CMD', x: 960, y: 40, config: { ms: '1000' }, color: '#5C6370', icon: 'timer' },
      { id: 'a3_focus', kind: 'focus_window', category: 'action', label: 'Focus CMD', x: 1180, y: 40, config: { title: 'cmd.exe' }, color: '#8764B8', icon: 'eye' },
      { id: 'a4', kind: 'send_keys', category: 'action', label: 'Type command', x: 1400, y: 40, config: { keys: 'color 0A{ENTER}echo HELLO FROM MACROFLOW!{ENTER}' }, color: '#4A5568', icon: 'type' },
      { id: 'a5', kind: 'notification', category: 'action', label: 'Notify (ELSE)', x: 740, y: 220, config: { title: 'Empty', body: 'Clipboard was empty' }, color: '#107C10', icon: 'bell' },
    ],
    edges: [
      { from: 't1', to: 'a1' },
      { from: 'a1', to: 'a2' },
      { from: 'a2', to: 'a3' },
      { from: 'a3', to: 'a3_delay' },
      { from: 'a3_delay', to: 'a3_focus' },
      { from: 'a3_focus', to: 'a4' },
      { from: 'a2', to: 'a5' },
    ],
  },
  {
    id: 'flow-3',
    name: 'Daily Report (Background)',
    description: 'Exports clipboard to Documents silently and notifies',
    enabled: false,
    nodes: [
      { id: 't1', kind: 'hotkey', category: 'trigger', label: 'Trigger', x: 40, y: 150, config: { hotkey: 'Run' }, color: '#0078D4', icon: 'keyboard' },
      { id: 'a2', kind: 'powershell', category: 'action', label: 'Export via script', x: 300, y: 150, config: { script: 'Get-Clipboard | Out-File "$env:USERPROFILE\\Documents\\macro_report.txt"', timeout_ms: '5000' }, color: '#0F6CBD', icon: 'terminal' },
      { id: 'a4', kind: 'notification', category: 'action', label: 'Notify success', x: 560, y: 150, config: { title: 'Report saved', body: 'Written to Documents!' }, color: '#107C10', icon: 'bell' },
    ],
    edges: [
      { from: 't1', to: 'a2' },
      { from: 'a2', to: 'a4' },
    ],
  },
];
