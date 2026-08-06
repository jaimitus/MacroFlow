import Icon from './Icon';
import Sparkline from './Sparkline';
import type { Flow, FlowNode, HookEvent, LogEntry, LogLevel } from '../types';

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: 'text-ink-2',
  warn: 'text-warn',
  ok: 'text-success',
  err: 'text-danger',
  inject: 'text-brand',
};

export interface DashboardProps {
  flows: Flow[];
  hookEvents: HookEvent[];
  logs: LogEntry[];
  nodes: FlowNode[];
  isExecuting: boolean;
  currentExecNode: string | null;
  cpuHistory: number[];
  ramHistory: number[];
  latencyHistory: number[];
  onRun: (id?: string) => void;
  onKill: (source: string) => void;
  onToggleFlow: (id: string) => void;
  onEditFlow: (id: string) => void;
  onImportFlow: (flow: Flow) => void;
  onCreateFlow: () => void;
  onDeleteFlow: (id: string) => void;
  onExportFlow: (id: string) => void;
}

export default function Dashboard(p: DashboardProps) {
  const cpu = p.cpuHistory.at(-1) ?? 0.4;
  const ram = p.ramHistory.at(-1) ?? 28;
  const latAvg = p.latencyHistory.length
    ? p.latencyHistory.reduce((a, b) => a + b, 0) / p.latencyHistory.length
    : 0.9;

  return (
    <div className="p-4 md:p-6 space-y-4 rise-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Dashboard</h1>
          <p className="text-[12.5px] text-ink-2 mt-0.5">Background engine status, active automations and live activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => p.onRun()}
            disabled={p.isExecuting}
            className="flex items-center gap-1.5 bg-brand hover:bg-brand-strong disabled:opacity-45 text-brand-fg text-[12px] font-semibold px-3.5 py-2 rounded-lg transition-colors"
          >
            <Icon name="play" size={13} /> Run active flow
          </button>
          <button
            onClick={() => p.onKill('Dashboard')}
            className="flex items-center gap-1.5 bg-surface border border-line text-danger text-[12px] font-semibold px-3 py-2 rounded-lg hover:bg-danger/5 transition-colors"
          >
            <Icon name="stop" size={13} /> Kill
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard icon="cpu" tint="brand" label="ENGINE">
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${p.isExecuting ? 'bg-warn animate-pulse' : 'bg-success'}`} />
            <span className="text-[15px] font-bold text-ink">{p.isExecuting ? 'Running' : 'Listening'}</span>
          </div>
          <div className="text-[11px] text-ink-3 mt-1">event-driven · 0% idle CPU</div>
        </StatCard>

        <StatCard icon="zap" tint="brand" label="HOOK LATENCY">
          <div className="text-[15px] font-bold text-ink mt-1.5">{latAvg.toFixed(2)} ms</div>
          <div className="flex items-end justify-between gap-2 mt-0.5">
            <div className="text-[11px] text-ink-3">target &lt; 2 ms</div>
            <Sparkline data={p.latencyHistory} width={96} height={28} color="var(--color-brand)" />
          </div>
        </StatCard>

        <StatCard icon="hdd" tint="success" label="RESOURCES">
          <div className="text-[15px] font-bold text-ink mt-1.5">{cpu.toFixed(1)}% · {ram.toFixed(0)}% RAM</div>
          <div className="flex items-end justify-between gap-2 mt-0.5">
            <div className="text-[11px] text-ink-3">low footprint</div>
            <Sparkline data={p.cpuHistory} width={96} height={28} color="var(--color-success)" max={100} />
          </div>
        </StatCard>

        <StatCard icon="monitor" tint="brand" label="SYSTEM TRAY">
          <div className="flex items-center gap-2 mt-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-success" />
            <span className="text-[15px] font-bold text-ink">Resident</span>
          </div>
          <div className="text-[11px] text-ink-3 mt-1">runs in background</div>
        </StatCard>
      </div>

      <div className="grid xl:grid-cols-[1.25fr_0.75fr] gap-4">
        {/* Flows */}
        <div className="bg-surface rounded-xl border border-line shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-ink">Automations</h3>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-ink-3 hidden sm:inline">{p.flows.filter((f) => f.enabled).length} of {p.flows.length} enabled</span>
              
              <button
                onClick={p.onCreateFlow}
                className="flex items-center gap-2 bg-success text-white font-black text-[12px] px-4 py-2 rounded-lg hover:bg-success/90 transition-colors shadow-pop uppercase tracking-wide"
              >
                <Icon name="plus" size={15} />
                NEW FLOW
              </button>

              <label className="cursor-pointer flex items-center gap-2 bg-brand text-brand-fg font-black text-[12px] px-4 py-2 rounded-lg hover:bg-brand-strong transition-colors shadow-pop uppercase tracking-wide">
                <Icon name="download" size={15} />
                IMPORT
                <input
                  type="file"
                  accept=".macroflow,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                      try {
                        const flow = JSON.parse(evt.target?.result as string) as Flow;
                        flow.id = `flow-${Date.now()}`; // prevent id collisions
                        p.onImportFlow(flow);
                      } catch {
                        alert("Invalid .macroflow file!");
                      }
                    };
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
          <div className="divide-y divide-line">
            {p.flows.map((f) => {
              const trigger = f.nodes.find((n) => n.category === 'trigger');
              return (
                <div key={f.id} className="px-4 py-3 flex items-center gap-3 hover:bg-elevated transition-colors">
                  <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${f.enabled ? 'bg-brand/12 text-brand' : 'bg-ink/5 text-ink-3'}`}>
                    <Icon name={trigger?.icon ?? 'nodes'} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-ink truncate">{f.name}</div>
                    <div className="text-[11px] text-ink-3 truncate">{f.description}</div>
                  </div>
                  <span className="hidden sm:inline text-[10.5px] font-mono bg-elevated border border-line text-ink-2 px-2 py-1 rounded-md shrink-0">
                    {f.nodes.length} nodes
                  </span>
                  <button
                    onClick={() => p.onRun(f.id)}
                    disabled={p.isExecuting || !f.enabled}
                    className="w-8 h-8 grid place-items-center rounded-lg text-ink-3 hover:text-success hover:bg-success/10 transition-colors shrink-0 disabled:opacity-50"
                    title="Run"
                  >
                    <Icon name="play" size={15} />
                  </button>
                  <button
                    onClick={() => p.onExportFlow(f.id)}
                    className="flex items-center gap-1.5 bg-surface border border-line text-ink-2 px-3 py-1.5 rounded-lg hover:text-brand hover:border-brand/50 hover:bg-brand/5 transition-colors shrink-0 text-[11px] font-bold uppercase tracking-wide"
                    title="Export .macroflow"
                  >
                    <Icon name="upload" size={14} />
                    EXPORT
                  </button>
                  <button
                    onClick={() => p.onEditFlow(f.id)}
                    className="w-8 h-8 grid place-items-center rounded-lg text-ink-3 hover:text-brand hover:bg-brand/10 transition-colors shrink-0"
                    title="Edit"
                  >
                    <Icon name="sliders" size={15} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Are you sure you want to delete "${f.name}"?`)) {
                        p.onDeleteFlow(f.id);
                      }
                    }}
                    className="w-8 h-8 grid place-items-center rounded-lg text-ink-3 hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                    title="Delete"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                  <button
                    onClick={() => p.onToggleFlow(f.id)}
                    className={`relative w-10 h-[22px] rounded-full transition-colors shrink-0 ${f.enabled ? 'bg-brand' : 'bg-ink/15'}`}
                    title={f.enabled ? 'Disable' : 'Enable'}
                  >
                    <span className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${f.enabled ? 'left-[20px]' : 'left-[2px]'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Kill switch + hook monitor */}
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-danger to-[#a81c27] p-4 text-white shadow-pop">
            <div className="absolute -right-8 -top-10 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
            <div className="flex items-start justify-between gap-3 relative">
              <div>
                <div className="text-[10px] font-bold tracking-[0.16em] opacity-85 flex items-center gap-1.5">
                  <Icon name="shield" size={13} /> EMERGENCY STOP
                </div>
                <div className="text-[18px] font-black leading-none mt-1.5 tracking-tight">Ctrl + Shift + Esc</div>
                <div className="text-[11.5px] opacity-90 mt-1.5 leading-snug">Aborts any running macro instantly — global, even when minimized.</div>
              </div>
              <div className="w-11 h-11 rounded-full bg-white text-danger grid place-items-center shrink-0 shadow-lg">
                <Icon name="alert" size={20} strokeWidth={2.4} />
              </div>
            </div>
            <button
              onClick={() => p.onKill('Dashboard panel')}
              className="mt-3.5 w-full flex items-center justify-center gap-2 bg-white text-danger font-black text-[12px] py-2.5 rounded-lg shadow hover:bg-white/90 active:scale-[0.99] transition-all"
            >
              <Icon name="stop" size={13} /> STOP ALL NOW
            </button>
          </div>

          <div className="bg-surface rounded-xl border border-line shadow-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
              <h4 className="text-[12px] font-bold text-ink flex items-center gap-2">
                <Icon name="keyboard" size={13} className="text-ink-3" /> Input hooks
              </h4>
              <span className="text-[10px] text-success bg-success/12 px-1.5 py-0.5 rounded-full font-bold">live</span>
            </div>
            <div className="divide-y divide-line max-h-[184px] overflow-auto custom-scrollbar">
              {p.hookEvents.map((ev) => (
                <div key={ev.id} className="px-3.5 py-2 flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-elevated border border-line grid place-items-center text-[11px] font-mono font-bold text-ink shrink-0">
                    {ev.key.split('+').pop()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11.5px] font-semibold text-ink truncate">{ev.key}</div>
                    <div className="text-[10px] text-ink-3 font-mono">{ev.timestamp} · {ev.latency}</div>
                  </div>
                  {ev.handled && <span className="text-[10px] bg-success/12 text-success px-1.5 py-0.5 rounded shrink-0">handled</span>}
                </div>
              ))}
              {p.hookEvents.length === 0 && (
                <div className="px-3.5 py-6 text-center text-[11px] text-ink-3">Press Ctrl+Alt+&lt;letter&gt; to test</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Activity */}
      <div className="bg-surface rounded-xl border border-line shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-3">
          <h3 className="text-[13px] font-bold text-ink">Execution activity</h3>
          <span className="text-[11px] text-ink-3">non-blocking queue · UI never freezes</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_1fr]">
          <div className="p-4 flex items-center gap-2 overflow-x-auto custom-scrollbar">
            {p.nodes.map((n, i) => {
              const isCurrent = p.currentExecNode === n.id;
              const curIdx = p.nodes.findIndex((x) => x.id === p.currentExecNode);
              const done = p.isExecuting && curIdx !== -1 && i < curIdx;
              return (
                <div key={n.id} className="flex items-center gap-2 shrink-0">
                  <div
                    className={`w-[112px] p-2.5 rounded-xl border-2 text-center transition-all duration-200 ${
                      isCurrent
                        ? 'border-brand bg-brand/[0.08] shadow-pop scale-[1.03]'
                        : done
                          ? 'border-success/30 bg-success/[0.06]'
                          : 'border-line bg-surface'
                    }`}
                  >
                    <span className="w-7 h-7 mx-auto rounded-lg grid place-items-center text-white" style={{ background: n.color }}>
                      <Icon name={n.icon} size={13} />
                    </span>
                    <div className="text-[10.5px] font-bold text-ink mt-1.5 leading-tight truncate">{n.label}</div>
                    <div className="text-[9.5px] text-ink-3 font-mono truncate">{n.kind}</div>
                    {isCurrent && <div className="mt-1.5 h-1 bg-brand rounded-full animate-pulse" />}
                  </div>
                  {i < p.nodes.length - 1 && <Icon name="arrow-right" size={13} className="text-ink-3 shrink-0" />}
                </div>
              );
            })}
          </div>
          <div className="bg-[#16171b] p-3.5 font-mono text-[11px] leading-[1.65] max-h-[172px] overflow-auto custom-scrollbar">
            {p.logs.slice(0, 8).map((l) => (
              <div key={l.id} className="flex gap-2.5">
                <span className="text-white/35 shrink-0">{l.time}</span>
                <span className={LEVEL_STYLE[l.level]}>{l.msg}</span>
              </div>
            ))}
            {p.logs.length === 0 && <div className="text-white/40">[engine] waiting for events…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  tint,
  label,
  children,
}: {
  icon: string;
  tint: 'brand' | 'success';
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface rounded-xl border border-line shadow-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold tracking-[0.14em] text-ink-3">{label}</span>
        <span className={`w-7 h-7 rounded-lg grid place-items-center ${tint === 'brand' ? 'bg-brand/12 text-brand' : 'bg-success/12 text-success'}`}>
          <Icon name={icon} size={15} />
        </span>
      </div>
      {children}
    </div>
  );
}
