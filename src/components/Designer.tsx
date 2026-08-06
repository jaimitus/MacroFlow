import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import Icon from './Icon';
import { PALETTE, VARIABLES } from '../data';
import type { Flow, FlowEdge, FlowNode, NodeKind } from '../types';

export interface DesignerProps {
  flows: Flow[];
  flowId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  isExecuting: boolean;
  currentExecNode: string | null;
  onSelectFlow: (id: string) => void;
  onNodesChange: (nodes: FlowNode[]) => void;
  onEdgesChange: (edges: FlowEdge[]) => void;
  onSelectNode: (id: string | null) => void;
  onAddNode: (kind: NodeKind) => void;
  onRun: (id?: string) => void;
  onKill: () => void;
  onExportFlow: (id: string) => void;
}

const NODE_W = 168;

export default function Designer(p: DesignerProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<FlowEdge | null>(null);

  const selected = p.nodes.find((n) => n.id === p.selectedNodeId) ?? null;

  const handleCanvasMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - NODE_W / 2;
    const y = e.clientY - rect.top - 26;
    p.onNodesChange(
      p.nodes.map((n) =>
        n.id === dragId
          ? { ...n, x: Math.max(8, Math.min(rect.width - NODE_W - 8, x)), y: Math.max(8, Math.min(rect.height - 80, y)) }
          : n
      )
    );
  };

  const handlePortClick = (id: string) => {
    if (!connectFrom) {
      setConnectFrom(id);
      p.onSelectNode(id);
    } else if (connectFrom !== id) {
      p.onEdgesChange(
        p.edges.some((e) => e.from === connectFrom && e.to === id) ? p.edges : [...p.edges, { from: connectFrom, to: id }]
      );
      setConnectFrom(null);
    } else {
      setConnectFrom(null);
    }
  };

  const edgePath = (from: FlowNode, to: FlowNode) => {
    const x1 = from.x + NODE_W, y1 = from.y + 30, x2 = to.x, y2 = to.y + 30;
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  };

  const currentIdx = p.nodes.findIndex((n) => n.id === p.currentExecNode);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2.5 bg-surface border-b border-line flex flex-wrap items-center gap-2.5">
        <h3 className="text-[13px] font-bold text-ink mr-1">Designer</h3>
        <select
          value={p.flowId}
          onChange={(e) => p.onSelectFlow(e.target.value)}
          className="text-[11.5px] border border-line rounded-lg px-2.5 py-1.5 bg-surface text-ink focus:outline-none focus:border-brand"
        >
          {p.flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}{f.enabled ? '' : ' (paused)'}
            </option>
          ))}
        </select>
        <span className="text-[11px] bg-brand/12 text-brand px-2 py-1 rounded-full font-semibold">
          {p.nodes.length} nodes · {p.edges.length} links
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => p.onExportFlow(p.flowId)}
            className="flex items-center gap-1.5 bg-surface border border-line hover:bg-brand/10 hover:border-brand/40 text-ink-2 hover:text-brand text-[11px] font-semibold px-3.5 py-1.5 rounded-lg transition-colors"
            title="Export this flow"
          >
            <Icon name="upload" size={11} /> Export
          </button>
          <button
            onClick={() => p.onRun()}
            disabled={p.isExecuting}
            className="flex items-center gap-1.5 bg-brand hover:bg-brand-strong disabled:opacity-45 text-brand-fg text-[11px] font-semibold px-3.5 py-1.5 rounded-lg transition-colors"
          >
            <Icon name="play" size={11} /> Run
          </button>
          <button
            onClick={p.onKill}
            className="flex items-center gap-1.5 bg-danger hover:opacity-90 text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-opacity"
          >
            <Icon name="stop" size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-[460px]">
        {/* Palette */}
        <div className="w-[164px] bg-elevated border-r border-line p-2 space-y-1.5 overflow-auto custom-scrollbar hidden md:block">
          <div className="text-[9.5px] font-bold tracking-[0.14em] text-ink-3 px-1 pt-1">TRIGGERS</div>
          {PALETTE.filter((x) => x.cat === 'trigger').map((x) => (
            <PaletteButton key={x.kind} item={x} onAdd={() => p.onAddNode(x.kind)} />
          ))}
          <div className="text-[9.5px] font-bold tracking-[0.14em] text-ink-3 px-1 pt-3">ACTIONS</div>
          {PALETTE.filter((x) => x.cat === 'action').map((x) => (
            <PaletteButton key={x.kind} item={x} onAdd={() => p.onAddNode(x.kind)} />
          ))}
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          onMouseMove={handleCanvasMove}
          onMouseUp={() => setDragId(null)}
          onMouseLeave={() => setDragId(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              p.onSelectNode(null);
              setSelectedEdge(null);
            }
          }}
          className="flex-1 relative dot-grid overflow-hidden select-none bg-canvas"
        >
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {p.edges.map((e, i) => {
              const from = p.nodes.find((n) => n.id === e.from);
              const to = p.nodes.find((n) => n.id === e.to);
              if (!from || !to) return null;
              const isSel = selectedEdge?.from === e.from && selectedEdge?.to === e.to;
              const isActive = p.currentExecNode === e.to;
              return (
                <path
                  key={i}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={isSel || isActive ? 'var(--color-brand)' : 'var(--color-line-strong)'}
                  strokeWidth={isActive ? 2.4 : 1.8}
                  strokeDasharray={isActive ? '7 5' : '0'}
                  className={isActive ? 'edge-running' : ''}
                />
              );
            })}
            {p.edges.map((e, i) => {
              const from = p.nodes.find((n) => n.id === e.from);
              const to = p.nodes.find((n) => n.id === e.to);
              if (!from || !to) return null;
              return (
                <path
                  key={`hit-${i}`}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedEdge(e);
                    p.onSelectNode(null);
                  }}
                />
              );
            })}
          </svg>

          {p.nodes.map((n) => {
            const isRunning = p.currentExecNode === n.id;
            const isSel = p.selectedNodeId === n.id;
            const idx = p.nodes.indexOf(n);
            const done = p.isExecuting && currentIdx !== -1 && idx < currentIdx;
            return (
              <div
                key={n.id}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  p.onSelectNode(n.id);
                  setDragId(n.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onSelectNode(n.id);
                  setSelectedEdge(null);
                }}
                className={`absolute rounded-xl border bg-surface shadow-card cursor-grab active:cursor-grabbing transition-shadow ${isSel ? 'ring-2 ring-brand border-brand/40' : 'border-line'} ${isRunning ? 'node-running border-brand' : ''}`}
                style={{ left: n.x, top: n.y, width: NODE_W }}
              >
                <div className="h-1.5 w-full rounded-t-xl" style={{ background: n.color }} />
                <div className="p-2.5">
                  <div className="flex items-start gap-2">
                    <span className="w-7 h-7 rounded-lg grid place-items-center text-white shrink-0" style={{ background: n.color }}>
                      <Icon name={n.icon} size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-ink leading-tight truncate">{n.label}</div>
                      <div className="text-[9.5px] text-ink-3 font-mono truncate">{n.kind}</div>
                    </div>
                    <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${n.category === 'trigger' ? 'bg-brand' : 'bg-success'}`} />
                  </div>
                  <div className="mt-2 text-[10px] bg-elevated rounded-md px-2 py-1 font-mono text-ink-2 truncate border border-line">
                    {Object.values(n.config)[0] || '—'}
                  </div>
                  {done && (
                    <div className="absolute top-2 right-9 w-4 h-4 rounded-full bg-success text-white grid place-items-center">
                      <Icon name="check" size={9} strokeWidth={3.2} />
                    </div>
                  )}
                </div>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handlePortClick(n.id); }}
                  className={`absolute -right-[7px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] rounded-full border-2 bg-surface transition-colors ${connectFrom === n.id ? 'border-brand bg-brand' : 'border-line-strong hover:border-brand'}`}
                  title="Output"
                />
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handlePortClick(n.id); }}
                  className={`absolute -left-[7px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] rounded-full border-2 bg-surface hover:border-brand transition-colors ${connectFrom ? 'border-brand/50' : 'border-line-strong'}`}
                  title="Input"
                />
              </div>
            );
          })}

          <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-surface/95 backdrop-blur px-3 py-1.5 rounded-full border border-line text-[11px] shadow-card">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-ink-2">Drag nodes · click ports to connect</span>
          </div>
          {connectFrom && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-brand text-brand-fg px-3.5 py-1.5 rounded-full text-[11px] font-semibold shadow-pop flex items-center gap-2">
              Connecting from <span className="font-mono bg-white/20 px-1.5 rounded">{connectFrom}</span> — click a target
              <button onClick={() => setConnectFrom(null)} className="hover:bg-white/20 rounded-full p-0.5"><Icon name="x" size={12} /></button>
            </div>
          )}
          {selectedEdge && (
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-surface/95 backdrop-blur px-3 py-1.5 rounded-full border border-danger/25 shadow-card">
              <span className="text-[11px] text-ink-2 font-mono">{selectedEdge.from} → {selectedEdge.to}</span>
              <button
                onClick={() => {
                  p.onEdgesChange(p.edges.filter((e) => !(e.from === selectedEdge.from && e.to === selectedEdge.to)));
                  setSelectedEdge(null);
                }}
                className="flex items-center gap-1 text-danger text-[11px] font-bold hover:bg-danger/5 rounded-full px-2 py-0.5"
              >
                <Icon name="trash" size={11} /> Delete
              </button>
            </div>
          )}
        </div>

        {/* Inspector */}
        <div className="w-[264px] bg-surface border-l border-line p-3.5 space-y-3 overflow-auto custom-scrollbar hidden lg:block">
          <h4 className="text-[12px] font-bold text-ink flex items-center gap-2">
            <Icon name="sliders" size={13} className="text-ink-3" /> Inspector
          </h4>
          {selected ? (
            <>
              <div className="p-3 rounded-xl border border-line bg-elevated">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-lg grid place-items-center text-white" style={{ background: selected.color }}>
                    <Icon name={selected.icon} size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold text-ink truncate">{selected.label}</div>
                    <div className="text-[10.5px] text-ink-3 font-mono">{selected.id} · {selected.kind}</div>
                  </div>
                </div>
              </div>

              <Field label="Label">
                <input
                  value={selected.label}
                  onChange={(e) => p.onNodesChange(p.nodes.map((n) => (n.id === selected.id ? { ...n, label: e.target.value } : n)))}
                  className="w-full text-[12px] border border-line rounded-lg px-2.5 py-1.5 bg-surface text-ink focus:outline-none focus:border-brand"
                />
              </Field>

              {Object.entries(selected.config).map(([k, v]) => (
                <Field key={k} label={k}>
                  {k === 'script' ? (
                    <textarea
                      value={v}
                      rows={3}
                      onChange={(e) => p.onNodesChange(p.nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, [k]: e.target.value } } : n)))}
                      className="w-full text-[11px] font-mono border border-line rounded-lg px-2.5 py-1.5 bg-surface text-ink focus:outline-none focus:border-brand resize-none"
                    />
                  ) : (
                    <input
                      value={v}
                      onChange={(e) => p.onNodesChange(p.nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, [k]: e.target.value } } : n)))}
                      className="w-full text-[12px] border border-line rounded-lg px-2.5 py-1.5 bg-surface text-ink focus:outline-none focus:border-brand"
                    />
                  )}
                </Field>
              ))}

              <div className="bg-warn/10 rounded-lg p-2.5 border border-warn/25">
                <div className="text-[11px] font-bold text-ink">Variables</div>
                <div className="mt-1.5 space-y-1">
                  {VARIABLES.slice(0, 4).map((vr) => (
                    <div key={vr.token} className="flex items-center gap-2 text-[10.5px]">
                      <code className="bg-surface px-1.5 py-0.5 rounded border border-line font-mono text-ink shrink-0">{vr.token}</code>
                      <span className="text-ink-2 truncate">{vr.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  p.onNodesChange(p.nodes.filter((n) => n.id !== selected.id));
                  p.onEdgesChange(p.edges.filter((e) => e.from !== selected.id && e.to !== selected.id));
                  p.onSelectNode(null);
                }}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] text-danger border border-danger/25 py-1.5 rounded-lg hover:bg-danger/5 transition-colors"
              >
                <Icon name="trash" size={11} /> Delete node
              </button>
            </>
          ) : (
            <div className="py-10 text-center space-y-1.5">
              <Icon name="nodes" size={22} className="mx-auto text-ink-3" />
              <div className="text-[11px] text-ink-3">Select a node to edit</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PaletteButton({ item, onAdd }: { item: (typeof PALETTE)[number]; onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="w-full text-left bg-surface border border-line rounded-lg p-2 hover:border-brand/40 hover:shadow-card transition-all flex gap-2 group"
    >
      <span className="w-7 h-7 rounded-md grid place-items-center text-white shrink-0 group-hover:scale-105 transition-transform" style={{ background: item.color }}>
        <Icon name={item.icon} size={13} />
      </span>
      <span className="leading-tight min-w-0">
        <span className="block text-[11px] font-semibold text-ink truncate">{item.label}</span>
        <span className="block text-[9.5px] text-ink-3 truncate">{item.desc}</span>
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-ink-2 block">{label}</label>
      {children}
    </div>
  );
}
