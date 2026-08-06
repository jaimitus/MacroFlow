import type { FlowNode, FlowEdge } from '../types';

/**
 * Simple layered auto-layout without external dagre.
 * Assigns each node to a layer via BFS from triggers / roots.
 */
export function autoLayout(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  if (nodes.length === 0) return nodes;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach(n => { inDegree.set(n.id, 0); adj.set(n.id, []); });
  edges.forEach(e => {
    if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) return;
    adj.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  });

  // Roots: triggers or indegree 0
  const roots = nodes.filter(n => n.category === 'trigger' || (inDegree.get(n.id) || 0) === 0);
  const start = roots.length > 0 ? roots : [nodes[0]];

  const layer = new Map<string, number>();
  const visited = new Set<string>();
  const queue: string[] = [];

  start.forEach(r => { layer.set(r.id, 0); queue.push(r.id); visited.add(r.id); });

  // BFS to assign layers (max parent layer +1)
  while (queue.length) {
    const cur = queue.shift()!;
    const curLayer = layer.get(cur) ?? 0;
    for (const nxt of adj.get(cur) || []) {
      const prev = layer.get(nxt);
      const candidate = curLayer + 1;
      if (prev === undefined || candidate > prev) layer.set(nxt, candidate);
      if (!visited.has(nxt)) {
        visited.add(nxt);
        queue.push(nxt);
      }
    }
  }

  // Unvisited (cycles/disconnected) -> assign incremental layers
  let maxLayer = Math.max(0, ...Array.from(layer.values()));
  for (const n of nodes) {
    if (!layer.has(n.id)) {
      maxLayer += 1;
      layer.set(n.id, maxLayer);
    }
  }

  // Group by layer
  const groups = new Map<number, FlowNode[]>();
  nodes.forEach(n => {
    const l = layer.get(n.id) ?? 0;
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l)!.push(n);
  });

  const GRID_X = 280;
  const GRID_Y = 140;
  const START_X = 40;
  const START_Y = 100;

  const result: FlowNode[] = [];
  const sortedLayers = Array.from(groups.keys()).sort((a,b)=>a-b);
  for (const l of sortedLayers) {
    const group = groups.get(l)!;
    // Preserve original Y ordering within layer
    group.sort((a,b)=>a.y - b.y);
    group.forEach((n, idx) => {
      result.push({
        ...n,
        x: START_X + l * GRID_X,
        y: START_Y + idx * GRID_Y,
      });
    });
  }

  // Keep original order for stable rendering
  const posMap = new Map(result.map(n=>[n.id, n]));
  return nodes.map(n => posMap.get(n.id) || n);
}

export const GRID_SIZE = 20;
export function snapToGrid(v: number, grid = GRID_SIZE): number {
  return Math.round(v / grid) * grid;
}
