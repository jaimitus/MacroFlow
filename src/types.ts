export type TabId = 'dashboard' | 'designer' | 'settings';

export type NodeCategory = 'trigger' | 'action';
export type TriggerKind = 'hotkey' | 'window_focus' | 'startup' | 'schedule' | 'clipboard';
export type ActionKind =
  | 'send_keys'
  | 'mouse_click'
  | 'mouse_move'
  | 'powershell'
  | 'delay'
  | 'condition'
  | 'notification'
  | 'open_app'
  | 'focus_window'
  | 'clipboard_set';
export type NodeKind = TriggerKind | ActionKind;

export interface FlowNode {
  id: string;
  kind: NodeKind;
  category: NodeCategory;
  label: string;
  x: number;
  y: number;
  config: Record<string, string>;
  color: string;
  icon: string;
}

export interface FlowEdge {
  from: string;
  to: string;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface HookEvent {
  id: number;
  key: string;
  code: string;
  modifiers: string[];
  timestamp: string;
  latency: string;
  handled: boolean;
}

export type LogLevel = 'info' | 'warn' | 'ok' | 'err' | 'inject';

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  msg: string;
}

export interface PaletteItem {
  kind: NodeKind;
  label: string;
  cat: NodeCategory;
  icon: string;
  color: string;
  desc: string;
}

export interface Settings {
  startWithWindows: boolean;
  minimizeToTray: boolean;
  startMinimized: boolean;
  notificationsEnabled: boolean;
  killSwitch: string;
}
