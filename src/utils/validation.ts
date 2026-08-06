import type { FlowNode, FlowEdge } from '../types';

export interface NodeIssue {
  level: 'error' | 'warn';
  msg: string;
}

export function validateNode(node: FlowNode, edges: FlowEdge[], allNodes: FlowNode[]): NodeIssue[] {
  const issues: NodeIssue[] = [];
  const cfg = node.config || {};
  const isEmpty = (v?: string) => !v || String(v).trim() === '';

  switch (node.kind) {
    case 'delay': {
      const ms = cfg.ms;
      if (isEmpty(ms)) issues.push({ level: 'error', msg: 'ms required' });
      else if (isNaN(Number(ms)) || Number(ms) < 0) issues.push({ level: 'error', msg: 'ms must be >=0' });
      break;
    }
    case 'send_keys': {
      if (isEmpty(cfg.keys)) issues.push({ level: 'error', msg: 'keys empty' });
      break;
    }
    case 'powershell': {
      if (isEmpty(cfg.script)) issues.push({ level: 'error', msg: 'script empty' });
      break;
    }
    case 'notification': {
      if (isEmpty(cfg.title) && isEmpty(cfg.body)) issues.push({ level: 'warn', msg: 'title/body empty' });
      break;
    }
    case 'open_url': {
      if (isEmpty(cfg.url)) issues.push({ level: 'error', msg: 'url required' });
      else if (!/^https?:\/\//i.test(cfg.url.trim())) issues.push({ level: 'warn', msg: 'url should start with http' });
      break;
    }
    case 'open_app':
    case 'close_app': {
      if (isEmpty(cfg.exe)) issues.push({ level: 'error', msg: 'exe required' });
      break;
    }
    case 'focus_window': {
      if (isEmpty(cfg.title)) issues.push({ level: 'error', msg: 'window title required' });
      break;
    }
    case 'mouse_move': {
      if (isEmpty(cfg.x) || isEmpty(cfg.y)) issues.push({ level: 'error', msg: 'x,y required' });
      else if (isNaN(Number(cfg.x)) || isNaN(Number(cfg.y))) issues.push({ level: 'error', msg: 'x,y must be numbers' });
      break;
    }
    case 'mouse_click': {
      if (cfg.button && !['left','right','middle'].includes(cfg.button.toLowerCase())) issues.push({ level: 'warn', msg: 'button left/right' });
      break;
    }
    case 'take_screenshot': {
      if (isEmpty(cfg.filename)) issues.push({ level: 'warn', msg: 'filename empty' });
      break;
    }
    case 'http_request': {
      if (isEmpty(cfg.url)) issues.push({ level: 'error', msg: 'url required' });
      break;
    }
    case 'file_write': {
      if (isEmpty(cfg.path)) issues.push({ level: 'error', msg: 'path required' });
      if (isEmpty(cfg.content)) issues.push({ level: 'warn', msg: 'content empty' });
      break;
    }
    case 'web_search': {
      if (isEmpty(cfg.query)) issues.push({ level: 'error', msg: 'query empty' });
      break;
    }
    case 'repeat': {
      const c = cfg.count;
      if (isEmpty(c)) issues.push({ level: 'error', msg: 'count required' });
      else if (isNaN(Number(c)) || Number(c) < 1 || Number(c) > 100) issues.push({ level: 'error', msg: 'count 1-100' });
      break;
    }
    case 'condition': {
      if (isEmpty(cfg.expr)) issues.push({ level: 'error', msg: 'expr required' });
      if (!cfg.then && !cfg.else) issues.push({ level: 'warn', msg: 'no branches' });
      if (cfg.then && !allNodes.some(n=>n.id===cfg.then)) issues.push({ level: 'warn', msg: `then target ${cfg.then} missing` });
      if (cfg.else && !allNodes.some(n=>n.id===cfg.else)) issues.push({ level: 'warn', msg: `else target ${cfg.else} missing` });
      break;
    }
    default: break;
  }

  // Orphan warning: no incoming and no outgoing (except trigger alone)
  const hasIn = edges.some(e=>e.to===node.id);
  const hasOut = edges.some(e=>e.from===node.id);
  if (!hasIn && !hasOut && allNodes.length>1) {
    issues.push({ level: 'warn', msg: 'orphan node' });
  }

  return issues;
}

export function hasNodeError(node: FlowNode, edges: FlowEdge[], allNodes: FlowNode[]): boolean {
  return validateNode(node, edges, allNodes).some(i=>i.level==='error');
}
