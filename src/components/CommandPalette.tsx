import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { PALETTE } from '../data';
import type { NodeKind } from '../types';

export interface CommandAction {
  id: string;
  label: string;
  desc: string;
  icon: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onAddNode: (kind: NodeKind) => void;
  onAutoLayout?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicateFlow?: () => void;
}

export default function CommandPalette({ open, onClose, onAddNode, onAutoLayout, onUndo, onRedo, onDuplicateFlow }: Props) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const paletteFiltered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return PALETTE;
    return PALETTE.filter(p => p.label.toLowerCase().includes(q) || p.kind.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q));
  }, [query]);

  const actions: CommandAction[] = useMemo(() => {
    const acts: CommandAction[] = [
      { id: 'undo', label: 'Undo', desc: 'Ctrl+Z', icon: 'refresh', run: () => { onUndo?.(); onClose(); } },
      { id: 'redo', label: 'Redo', desc: 'Ctrl+Y', icon: 'refresh', run: () => { onRedo?.(); onClose(); } },
      { id: 'autolayout', label: 'Auto-layout', desc: 'Ordenar nodos', icon: 'nodes', run: () => { onAutoLayout?.(); onClose(); } },
      { id: 'duplicate', label: 'Duplicate Flow', desc: 'Clonar flow actual', icon: 'copy', run: () => { onDuplicateFlow?.(); onClose(); } },
    ];
    if (!query) return acts;
    const q = query.toLowerCase();
    return acts.filter(a => a.label.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q));
  }, [query, onUndo, onRedo, onAutoLayout, onDuplicateFlow, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh] px-4">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[560px] bg-surface rounded-2xl shadow-pop border border-line overflow-hidden flex flex-col max-h-[68vh]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <Icon name="search" size={16} className="text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar nodo o acción…  (ej. http, loop, ordenar)"
            className="flex-1 bg-transparent outline-none text-[13px] text-ink placeholder:text-ink-3"
          />
          <span className="text-[10px] font-mono bg-elevated border border-line px-1.5 py-0.5 rounded text-ink-3">ESC</span>
        </div>

        <div className="overflow-auto custom-scrollbar p-2 space-y-3">
          {actions.length > 0 && (
            <div>
              <div className="text-[10px] font-bold tracking-[0.12em] text-ink-3 px-2 py-1">ACCIONES</div>
              <div className="space-y-1">
                {actions.map(a => (
                  <button
                    key={a.id}
                    onClick={a.run}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-brand/10 hover:border-brand/20 border border-transparent text-left transition-colors"
                  >
                    <span className="w-8 h-8 rounded-lg bg-elevated border border-line grid place-items-center text-ink-2"><Icon name={a.icon} size={14} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold text-ink">{a.label}</div>
                      <div className="text-[11px] text-ink-3">{a.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] font-bold tracking-[0.12em] text-ink-3 px-2 py-1">NODOS — {paletteFiltered.length}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {paletteFiltered.map(p => (
                <button
                  key={p.kind}
                  onClick={() => { onAddNode(p.kind); onClose(); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-line bg-surface hover:border-brand/30 hover:shadow-card text-left transition-all group"
                >
                  <span className="w-8 h-8 rounded-lg grid place-items-center text-white shrink-0 group-hover:scale-105 transition-transform" style={{ background: p.color }}><Icon name={p.icon} size={14} /></span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-ink truncate">{p.label}</span>
                    <span className="block text-[10px] text-ink-3 truncate">{p.desc} · {p.kind}</span>
                  </span>
                </button>
              ))}
              {paletteFiltered.length === 0 && <div className="col-span-2 py-6 text-center text-[12px] text-ink-3">Sin resultados para “{query}”</div>}
            </div>
          </div>
        </div>

        <div className="px-3 py-2 bg-elevated border-t border-line flex items-center gap-2 text-[10.5px] text-ink-3">
          <span className="hidden sm:inline">↵ Añadir</span><span className="hidden sm:inline">·</span><span>Ctrl+K para abrir</span><span className="ml-auto font-mono">{paletteFiltered.length} nodos</span>
        </div>
      </div>
    </div>
  );
}
