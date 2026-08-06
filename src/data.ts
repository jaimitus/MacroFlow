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
  { kind: 'powershell', label: 'Run Script', cat: 'action', icon: 'terminal', color: '#0F6CBD', desc: 'PowerShell' },
  { kind: 'delay', label: 'Wait', cat: 'action', icon: 'timer', color: '#5C6370', desc: 'pause ms' },
  { kind: 'condition', label: 'Condition', cat: 'action', icon: 'branch', color: '#D83B01', desc: 'if / else' },
  { kind: 'notification', label: 'Notification', cat: 'action', icon: 'bell', color: '#107C10', desc: 'toast' },
  { kind: 'open_app', label: 'Launch App', cat: 'action', icon: 'send', color: '#8764B8', desc: 'open program' },
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
    name: 'Daily Report',
    description: 'Ctrl+Alt+R → build report, export to Documents, notify',
    enabled: true,
    nodes: [
      { id: 't1', kind: 'hotkey', category: 'trigger', label: 'Ctrl + Alt + R', x: 40, y: 150, config: { hotkey: 'Ctrl+Alt+R', debounce_ms: '120' }, color: '#0078D4', icon: 'keyboard' },
      { id: 'a1', kind: 'clipboard_set', category: 'action', label: 'Copy {DATE} to clipboard', x: 300, y: 80, config: { value: '{DATE} {TIME} — report for {ACTIVE_WINDOW}', destination: 'CLIPBOARD' }, color: '#8764B8', icon: 'clipboard' },
      { id: 'a2', kind: 'powershell', category: 'action', label: 'Export via script', x: 560, y: 80, config: { script: 'Get-Clipboard | Out-File "$env:USERPROFILE\\Documents\\report_{DATE}.txt"', timeout_ms: '5000' }, color: '#0F6CBD', icon: 'terminal' },
      { id: 'a3', kind: 'condition', category: 'action', label: 'Clipboard non-empty?', x: 560, y: 250, config: { expr: 'len({CLIPBOARD}) > 0', then: 'a4', else: 'a5' }, color: '#D83B01', icon: 'branch' },
      { id: 'a4', kind: 'notification', category: 'action', label: 'Notify success', x: 820, y: 80, config: { title: 'Report saved', body: 'Written to Documents at {TIME}' }, color: '#107C10', icon: 'bell' },
      { id: 'a5', kind: 'mouse_click', category: 'action', label: 'Fallback click', x: 820, y: 260, config: { x: '1240', y: '780', button: 'left', clicks: '1' }, color: '#2B3A55', icon: 'mouse' },
    ],
    edges: [
      { from: 't1', to: 'a1' },
      { from: 'a1', to: 'a2' },
      { from: 'a2', to: 'a3' },
      { from: 'a3', to: 'a4' },
      { from: 'a3', to: 'a5' },
    ],
  },
  {
    id: 'flow-2',
    name: 'SAP Auto-Login',
    description: 'When the login window gains focus, type credentials',
    enabled: true,
    nodes: [
      { id: 't1', kind: 'window_focus', category: 'trigger', label: 'Login window focused', x: 40, y: 150, config: { exe: 'saplogon.exe' }, color: '#0078D4', icon: 'window' },
      { id: 'a1', kind: 'delay', category: 'action', label: 'Wait 800 ms', x: 300, y: 150, config: { ms: '800' }, color: '#5C6370', icon: 'timer' },
      { id: 'a2', kind: 'send_keys', category: 'action', label: 'Type {USER} + Tab', x: 560, y: 150, config: { keys: '{USER}{TAB}********{ENTER}' }, color: '#4A5568', icon: 'type' },
    ],
    edges: [
      { from: 't1', to: 'a1' },
      { from: 'a1', to: 'a2' },
    ],
  },
  {
    id: 'flow-3',
    name: 'Snippet Paste',
    description: 'Ctrl+Shift+J → paste a saved text snippet',
    enabled: false,
    nodes: [
      { id: 't1', kind: 'hotkey', category: 'trigger', label: 'Ctrl + Shift + J', x: 40, y: 150, config: { hotkey: 'Ctrl+Shift+J', debounce_ms: '120' }, color: '#0078D4', icon: 'keyboard' },
      { id: 'a1', kind: 'send_keys', category: 'action', label: 'Paste snippet', x: 300, y: 150, config: { keys: 'Bug template — Steps: 1..2..3' }, color: '#4A5568', icon: 'type' },
    ],
    edges: [{ from: 't1', to: 'a1' }],
  },
];
