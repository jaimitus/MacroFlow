import { useEffect, useRef, useState, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import Icon from './Icon';
import CommandPalette from './CommandPalette';
import { PALETTE, VARIABLES } from '../data';
import type { Flow, FlowEdge, FlowNode, NodeKind } from '../types';
import { validateNode } from '../utils/validation';
import { snapToGrid, GRID_SIZE } from '../utils/layout';

export interface DesignerProps {
  flows: Flow[];
  flowId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  selectedIds: string[];
  isExecuting: boolean;
  currentExecNode: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onSelectFlow: (id: string) => void;
  onNodesChange: (nodes: FlowNode[]) => void;
  onEdgesChange: (edges: FlowEdge[]) => void;
  onSelectNode: (id: string | null) => void;
  onSelectIds: (ids: string[]) => void;
  onAddNode: (kind: NodeKind) => void;
  onRun: (id?: string) => void;
  onKill: () => void;
  onExportFlow: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicateNodes: (ids: string[]) => void;
  onPaste: () => void;
  onAutoLayout: () => void;
  onDuplicateFlow: (id: string) => void;
  onRenameFlow: (id: string, name: string, desc?: string) => void;
  onDragStateChange?: (dragging: boolean) => void;
}

const NODE_W = 168;
const NODE_H = 84;

export default function Designer(p: DesignerProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffsets = useRef<Map<string,{dx:number,dy:number}>>(new Map());
  const dragStartPositions = useRef<Map<string,{x:number,y:number}>>(new Map());
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<FlowEdge | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showPaletteSearch, setShowPaletteSearch] = useState('');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x:0, y:0, scrollLeft:0, scrollTop:0 });
  const [selectionBox, setSelectionBox] = useState<{x:number,y:number,w:number,h:number} | null>(null);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const boxStart = useRef({x:0,y:0});
  const [favKinds, setFavKinds] = useState<Set<string>>(()=>{
    try { return new Set(JSON.parse(localStorage.getItem('macroflow.fav')||'[]')); } catch { return new Set(); }
  });
  const [recentKinds, setRecentKinds] = useState<string[]>(()=>{
    try { return JSON.parse(localStorage.getItem('macroflow.recent')||'[]'); } catch { return []; }
  });
  const [flowRenaming, setFlowRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameDesc, setRenameDesc] = useState('');
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0, w: 0, h: 0 });
  const [showHelp, setShowHelp] = useState(false);
  const PALETTE_GROUPS: Array<{id:string, label:string, icon:string, kinds: NodeKind[]}> = [
    {id:'triggers', label:'TRIGGERS', icon:'zap', kinds:['hotkey','window_focus','schedule','startup','clipboard']},
    {id:'input', label:'Entrada', icon:'type', kinds:['send_keys','mouse_click','mouse_move']},
    {id:'system', label:'Sistema', icon:'monitor', kinds:['open_app','close_app','focus_window','open_url','take_screenshot']},
    {id:'logic', label:'Flujo', icon:'branch', kinds:['delay','condition','repeat']},
    {id:'ui', label:'Notificación', icon:'bell', kinds:['notification','play_sound']},
    {id:'data', label:'Datos & Red', icon:'globe', kinds:['clipboard_set','http_request','file_write','web_search','powershell']},
  ];
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(()=>{
    try { const raw = JSON.parse(localStorage.getItem('macroflow.palette.collapsed')||'[]'); return new Set(raw); } catch { return new Set(['system','ui','data']); }
  });
  const toggleGroup = (id:string) => {
    setCollapsedGroups(prev=>{
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('macroflow.palette.collapsed', JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  const selected = p.nodes.find((n) => n.id === p.selectedNodeId) ?? null;
  const currentFlow = p.flows.find(f=>f.id===p.flowId) ?? p.flows[0];

  useEffect(()=>{
    const update = () => {
      try { setRecentKinds(JSON.parse(localStorage.getItem('macroflow.recent')||'[]')); } catch {}
    };
    window.addEventListener('storage', update);
    const id = window.setInterval(update, 1000);
    return ()=> { window.removeEventListener('storage', update); window.clearInterval(id); };
  }, []);

  const toggleFav = (kind: string) => {
    setFavKinds(prev=>{
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      try { localStorage.setItem('macroflow.fav', JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  // Wheel: Ctrl+Wheel = zoom, normal vertical wheel = horizontal scroll (original behavior)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.0015;
        setZoom(z => Math.min(1.8, Math.max(0.4, +((z + delta)).toFixed(2))));
      } else if (e.deltaY !== 0 && Math.abs(e.deltaX) < 2) {
        // emulate original: vertical wheel scrolls horizontally for wide canvas
        // only do if shift not pressed? Keep both: if user scrolls vertically, also nudge horizontally
        // Don't preventDefault so vertical scroll still works
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Minimap viewport sync - track scroll
  useEffect(()=>{
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => setScrollPos({ left: el.scrollLeft, top: el.scrollTop, w: el.clientWidth, h: el.clientHeight });
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    onScroll();
    return ()=> { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, [zoom]);

  // Keyboard
  useEffect(()=>{
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName==='INPUT'||target.tagName==='TEXTAREA'|| target.isContentEditable);
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k') {
        e.preventDefault(); setShowCommandPalette(v=>!v);
        return;
      }
      if (!isInput && e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); setShowHelp(v=>!v);
        return;
      }
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false);
        return;
      }
      if (!isInput && (e.key==='Delete' || e.key==='Backspace')) {
        if (p.selectedIds.length>0) {
          const ids = new Set(p.selectedIds);
          if (p.selectedNodeId) ids.add(p.selectedNodeId);
          if (ids.size>0 && confirm(`Delete ${ids.size} node(s)?`)) {
            p.onNodesChange(p.nodes.filter(n=> !ids.has(n.id)));
            p.onEdgesChange(p.edges.filter(ed=> !ids.has(ed.from) && !ids.has(ed.to)));
            p.onSelectNode(null); p.onSelectIds([]);
          }
        } else if (selectedEdge) {
          p.onEdgesChange(p.edges.filter(ed=> !(ed.from===selectedEdge.from && ed.to===selectedEdge.to)));
          setSelectedEdge(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  }, [p, showHelp, selectedEdge]);

  const handleCanvasMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (isPanning && scrollContainerRef.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      scrollContainerRef.current.scrollLeft = panStart.current.scrollLeft - dx;
      scrollContainerRef.current.scrollTop = panStart.current.scrollTop - dy;
      return;
    }
    if (isBoxSelecting && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const curX = (e.clientX - rect.left) / zoom;
      const curY = (e.clientY - rect.top) / zoom;
      const x = Math.min(boxStart.current.x, curX);
      const y = Math.min(boxStart.current.y, curY);
      const w = Math.abs(curX - boxStart.current.x);
      const h = Math.abs(curY - boxStart.current.y);
      setSelectionBox({x,y,w,h});
      return;
    }
    if (!dragId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / zoom;
    const mouseY = (e.clientY - rect.top) / zoom;
    const startPos = dragStartPositions.current.get(dragId);
    if (!startPos) return;
    const rawX = mouseX - (dragOffsets.current.get(dragId)?.dx || 0);
    const rawY = mouseY - (dragOffsets.current.get(dragId)?.dy || 0);
    if (p.selectedIds.length <=1 || !p.selectedIds.includes(dragId)) {
      let nx = rawX;
      let ny = rawY;
      if (snapEnabled) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
      p.onNodesChange(
        p.nodes.map((n) =>
          n.id === dragId
            ? { ...n, x: Math.max(8, Math.min(2600 - NODE_W - 8, nx)), y: Math.max(8, Math.min(1800 - NODE_H -8, ny)) }
            : n
        )
      );
    } else {
      const deltaX = rawX - startPos.x;
      const deltaY = rawY - startPos.y;
      p.onNodesChange(
        p.nodes.map(n=>{
          if (!p.selectedIds.includes(n.id)) return n;
          const orig = dragStartPositions.current.get(n.id);
          if (!orig) return n;
          let nx = orig.x + deltaX;
          let ny = orig.y + deltaY;
          if (snapEnabled) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
          return { ...n, x: Math.max(8, Math.min(2600 - NODE_W -8, nx)), y: Math.max(8, Math.min(1800 - NODE_H -8, ny)) };
        })
      );
    }
  };

  const handlePortClick = (id: string) => {
    if (!connectFrom) {
      setConnectFrom(id);
      p.onSelectNode(id);
      p.onSelectIds([id]);
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

  const filteredPalette = useMemo(()=>{
    const q = showPaletteSearch.toLowerCase().trim();
    if (!q) return PALETTE;
    return PALETTE.filter(pa=> pa.label.toLowerCase().includes(q) || pa.kind.toLowerCase().includes(q) || pa.desc.toLowerCase().includes(q));
  }, [showPaletteSearch]);

  const favPalette = useMemo(()=> PALETTE.filter(pa=> favKinds.has(pa.kind)), [favKinds]);
  const recentPalette = useMemo(()=> {
    const map = new Map(PALETTE.map(p=>[p.kind,p] as const));
    return recentKinds.map(k=> map.get(k as NodeKind)).filter(Boolean) as typeof PALETTE;
  }, [recentKinds]);

  const canvasWidth = Math.max(2800, ...p.nodes.map((n) => n.x + 400));
  const canvasHeight = Math.max(750, ...p.nodes.map((n) => n.y + 250));
  // total scaled size for scroll container
  const scaledW = canvasWidth * zoom;
  const scaledH = canvasHeight * zoom;

  const handleFitView = () => {
    if (p.nodes.length === 0) return;
    const minX = Math.min(...p.nodes.map(n=>n.x));
    const minY = Math.min(...p.nodes.map(n=>n.y));
    const maxX = Math.max(...p.nodes.map(n=>n.x + NODE_W));
    const maxY = Math.max(...p.nodes.map(n=>n.y + NODE_H));
    const pad = 80;
    const contentW = maxX - minX + pad*2;
    const contentH = maxY - minY + pad*2;
    const container = scrollContainerRef.current;
    if (!container) return;
    const availW = container.clientWidth;
    const availH = container.clientHeight;
    const scaleX = availW / contentW;
    const scaleY = availH / contentH;
    const newZoom = Math.min(1.8, Math.max(0.4, Math.min(scaleX, scaleY)));
    setZoom(+newZoom.toFixed(2));
    requestAnimationFrame(()=>{
      setTimeout(()=>{
        if (!scrollContainerRef.current) return;
        const centerX = (minX + maxX)/2 * newZoom;
        const centerY = (minY + maxY)/2 * newZoom;
        scrollContainerRef.current!.scrollLeft = centerX - availW/2;
        scrollContainerRef.current!.scrollTop = centerY - availH/2;
      }, 60);
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-3 py-2 bg-surface border-b border-line flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[13px] font-bold text-ink mr-1 hidden sm:inline">Designer</h3>
          <div className="flex items-center gap-1">
            <button onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)" className="w-7 h-7 grid place-items-center rounded-lg border border-line bg-surface hover:bg-elevated disabled:opacity-40 text-ink-2">
              <Icon name="refresh" size={13} className="scale-x-[-1]" />
            </button>
            <button onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Y)" className="w-7 h-7 grid place-items-center rounded-lg border border-line bg-surface hover:bg-elevated disabled:opacity-40 text-ink-2">
              <Icon name="refresh" size={13} />
            </button>
          </div>
          <div className="w-px h-6 bg-line mx-1 hidden sm:block" />
          <select
            value={p.flowId}
            onChange={(e) => p.onSelectFlow(e.target.value)}
            className="text-[11.5px] border border-line rounded-lg px-2.5 py-1.5 bg-surface text-ink focus:outline-none focus:border-brand max-w-[160px]"
          >
            {p.flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}{f.enabled ? '' : ' (paused)'}
              </option>
            ))}
          </select>
          {flowRenaming ? (
            <div className="flex items-center gap-1">
              <input value={renameName} onChange={e=> setRenameName(e.target.value)} onKeyDown={e=> { if (e.key==='Enter'){ p.onRenameFlow(p.flowId, renameName, renameDesc); setFlowRenaming(false);} if (e.key==='Escape') setFlowRenaming(false); }} placeholder="Name" className="text-[11px] border border-brand rounded-lg px-2 py-1 bg-surface w-[140px]" autoFocus />
              <input value={renameDesc} onChange={e=> setRenameDesc(e.target.value)} onKeyDown={e=> { if (e.key==='Enter'){ p.onRenameFlow(p.flowId, renameName, renameDesc); setFlowRenaming(false);} if (e.key==='Escape') setFlowRenaming(false); }} placeholder="Desc" className="hidden lg:block text-[11px] border border-line rounded-lg px-2 py-1 bg-surface w-[160px]" />
              <button onClick={()=> { p.onRenameFlow(p.flowId, renameName, renameDesc); setFlowRenaming(false); }} className="text-[11px] bg-brand text-white px-2.5 py-1 rounded-lg">Save</button>
              <button onClick={()=> setFlowRenaming(false)} className="text-[11px] border border-line px-2.5 py-1 rounded-lg">Cancel</button>
            </div>
          ) : (
            <>
              <button onClick={()=> { setRenameName(currentFlow?.name||''); setRenameDesc(currentFlow?.description||''); setFlowRenaming(true); }} title="Rename flow" className="hidden sm:grid w-7 h-7 place-items-center rounded-lg border border-line bg-surface hover:bg-brand/10 hover:text-brand text-ink-2">
                <Icon name="type" size={12} />
              </button>
              <button onClick={()=> p.onDuplicateFlow(p.flowId)} title="Duplicate flow" className="hidden sm:grid w-7 h-7 place-items-center rounded-lg border border-line bg-surface hover:bg-brand/10 hover:text-brand text-ink-2">
                <Icon name="copy" size={12} />
              </button>
            </>
          )}
        </div>

        <span className="hidden xl:inline text-[11px] bg-brand/12 text-brand px-2 py-1 rounded-full font-semibold">
          {p.nodes.length} nodes · {p.edges.length} links {p.selectedIds.length>1 && `· ${p.selectedIds.length} selected`}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={()=> setShowCommandPalette(true)} title="Command palette (Ctrl+K)" className="hidden md:flex items-center gap-1.5 bg-elevated border border-line hover:border-brand/30 text-ink-2 hover:text-brand text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors">
            <Icon name="search" size={12} /> <span className="hidden lg:inline">Ctrl+K</span>
          </button>
          <div className="hidden sm:flex items-center gap-1 bg-elevated border border-line rounded-lg p-0.5">
            <button onClick={()=> setZoom(z=> Math.max(0.4, +(z-0.1).toFixed(1)))} className="w-6 h-6 grid place-items-center hover:bg-surface rounded-md text-ink-2"><Icon name="minus" size={12} /></button>
            <span className="text-[11px] font-mono font-semibold min-w-[44px] text-center text-ink">{Math.round(zoom*100)}%</span>
            <button onClick={()=> setZoom(z=> Math.min(1.8, +(z+0.1).toFixed(1)))} className="w-6 h-6 grid place-items-center hover:bg-surface rounded-md text-ink-2"><Icon name="plus" size={12} /></button>
            <button onClick={()=> setZoom(1)} title="Reset 100%" className="text-[10px] font-bold px-1.5 py-0.5 rounded hover:bg-surface text-ink-3">1:1</button>
          </div>
          <button onClick={()=> setSnapEnabled(v=>!v)} title={snapEnabled? 'Snap on (grid 20px)' : 'Snap off'} className={`hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${snapEnabled? 'bg-brand text-white border-brand' : 'bg-surface border-line text-ink-2 hover:bg-elevated'}`}>
            <Icon name="layers" size={11} /> Grid
          </button>
          <button onClick={p.onAutoLayout} title="Auto-layout" className="flex items-center gap-1.5 bg-surface border border-line hover:bg-brand/10 hover:border-brand/40 text-ink-2 hover:text-brand text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors">
            <Icon name="nodes" size={11} /> <span className="hidden sm:inline">Ordenar</span>
          </button>
          <button onClick={handleFitView} title="Fit view" className="hidden sm:grid w-7 h-7 place-items-center rounded-lg border border-line bg-surface hover:bg-brand/10 hover:text-brand text-ink-2">
            <Icon name="move" size={12} />
          </button>
          <div className="w-px h-6 bg-line mx-1 hidden md:block" />
          <button onClick={()=> setShowMinimap(v=>!v)} title="Toggle minimap" className={`w-7 h-7 grid place-items-center rounded-lg border ${showMinimap? 'bg-brand text-white border-brand' : 'bg-surface border-line text-ink-2'} `}>
            <Icon name="monitor" size={12} />
          </button>
          <button onClick={()=> setShowHelp(v=>!v)} title="Atajos" className={`w-7 h-7 grid place-items-center rounded-lg border text-[11px] font-black ${showHelp? 'bg-brand text-white border-brand':'bg-surface border-line text-ink-2 hover:bg-elevated'}`}>?</button>
          <button onClick={() => p.onExportFlow(p.flowId)} className="flex items-center gap-1.5 bg-surface border border-line hover:bg-brand/10 hover:border-brand/40 text-ink-2 hover:text-brand text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors" title="Export this flow">
            <Icon name="upload" size={11} /> <span className="hidden sm:inline">Export</span>
          </button>
          <button onClick={() => p.onRun()} disabled={p.isExecuting} className="flex items-center gap-1.5 bg-brand hover:bg-brand-strong disabled:opacity-45 text-brand-fg text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors">
            <Icon name="play" size={11} /> Run
          </button>
          <button onClick={p.onKill} className="flex items-center gap-1.5 bg-danger hover:opacity-90 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-opacity">
            <Icon name="stop" size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-[460px] min-w-0 overflow-hidden relative">
        {/* Palette - collapsible by type */}
        <div className="w-[212px] bg-elevated border-r border-line flex flex-col hidden md:flex shrink-0">
          <div className="p-2 border-b border-line space-y-2">
            <div className="relative">
              <Icon name="search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <input value={showPaletteSearch} onChange={e=> setShowPaletteSearch(e.target.value)} placeholder={`Buscar nodo… (${PALETTE.length})`} className="w-full text-[11px] border border-line rounded-lg pl-7 pr-7 py-1.5 bg-surface text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand" />
              {showPaletteSearch && <button onClick={()=> setShowPaletteSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded hover:bg-ink/10 text-ink-3"><Icon name="x" size={10} /></button>}
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-ink-3 font-medium">{showPaletteSearch.trim() ? `${filteredPalette.length} resultados` : `${PALETTE.length} nodos`}</span>
              <div className="flex gap-1">
                <button onClick={()=> setCollapsedGroups(new Set())} className="px-1.5 py-0.5 rounded border border-line bg-surface hover:bg-brand/10 hover:text-brand" title="Expandir todo">⛶</button>
                <button onClick={()=> setCollapsedGroups(new Set(['fav','recent', ...PALETTE_GROUPS.map(g=>g.id)]))} className="px-1.5 py-0.5 rounded border border-line bg-surface hover:bg-brand/10 hover:text-brand" title="Colapsar todo">▭</button>
              </div>
            </div>
            {p.selectedIds.length>1 && <div className="text-[10px] bg-brand/10 text-brand border border-brand/20 rounded-md px-2 py-1 text-center font-semibold">{p.selectedIds.length} seleccionados · arrastra para mover<br/><span className="font-normal text-[10px]">Ctrl+C / Ctrl+V · Delete</span></div>}
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar p-2 space-y-2">
            {showPaletteSearch.trim() !== '' ? (
              <div className="space-y-1.5">
                <div className="text-[9.5px] font-bold tracking-[0.14em] text-ink-3 px-1 pb-1">RESULTADOS · {filteredPalette.length}</div>
                {filteredPalette.map(x=> <PaletteButton key={x.kind} item={x} isFav={favKinds.has(x.kind)} onToggleFav={()=> toggleFav(x.kind)} onAdd={()=> p.onAddNode(x.kind)} />)}
                {filteredPalette.length===0 && <div className="text-[11px] text-ink-3 text-center py-6">Sin resultados para “{showPaletteSearch}”</div>}
              </div>
            ) : (
              <>
                {favPalette.length>0 && (
                  <PaletteGroup id="fav" label="FAVORITOS" icon="type" count={favPalette.length} collapsed={collapsedGroups.has('fav')} onToggle={()=> toggleGroup('fav')}>
                    {favPalette.map(x=> <PaletteButton key={`fav-${x.kind}`} item={x} isFav={true} onToggleFav={()=> toggleFav(x.kind)} onAdd={() => p.onAddNode(x.kind)} />)}
                  </PaletteGroup>
                )}
                {recentPalette.length>0 && (
                  <PaletteGroup id="recent" label="RECIENTES" icon="clock" count={Math.min(5, recentPalette.length)} collapsed={collapsedGroups.has('recent')} onToggle={()=> toggleGroup('recent')}>
                    {recentPalette.slice(0,5).map(x=> <PaletteButton key={`rec-${x.kind}`} item={x} isFav={favKinds.has(x.kind)} onToggleFav={()=> toggleFav(x.kind)} onAdd={() => p.onAddNode(x.kind)} />)}
                  </PaletteGroup>
                )}
                {PALETTE_GROUPS.map(g=>{
                  const items = PALETTE.filter(pa=> g.kinds.includes(pa.kind as NodeKind));
                  return (
                    <PaletteGroup key={g.id} id={g.id} label={g.label} icon={g.icon} count={items.length} collapsed={collapsedGroups.has(g.id)} onToggle={()=> toggleGroup(g.id)}>
                      {items.map(x=> <PaletteButton key={x.kind} item={x} isFav={favKinds.has(x.kind)} onToggleFav={()=> toggleFav(x.kind)} onAdd={()=> p.onAddNode(x.kind)} />)}
                    </PaletteGroup>
                  );
                })}
              </>
            )}
          </div>
          <div className="p-2 border-t border-line text-[10px] text-ink-3 text-center flex items-center justify-center gap-1.5">
            <Icon name="layers" size={10} /> {PALETTE_GROUPS.length} grupos · Ctrl+K
          </div>
        </div>

        {/* Canvas area with fixed minimap overlay */}
        <div className="flex-1 min-w-0 h-full relative overflow-hidden flex flex-col bg-canvas">
          <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-canvas select-none relative">
            {/* Scaled wrapper so scrollbars match zoomed size */}
            <div style={{ width: scaledW, height: scaledH }} className="relative">
              <div
                ref={canvasRef}
                onMouseMove={handleCanvasMove}
                onMouseUp={() => {
                  if (dragId) p.onDragStateChange?.(false);
                  setDragId(null);
                  dragOffsets.current.clear();
                  dragStartPositions.current.clear();
                  if (isBoxSelecting && selectionBox) {
                    const sel = p.nodes.filter(n=>{
                      const nx = n.x, ny = n.y;
                      return nx < selectionBox.x + selectionBox.w && nx + NODE_W > selectionBox.x && ny < selectionBox.y + selectionBox.h && ny + NODE_H > selectionBox.y;
                    }).map(n=>n.id);
                    p.onSelectIds(sel);
                    if (sel.length===1) p.onSelectNode(sel[0]);
                    else if (sel.length===0) { p.onSelectNode(null); }
                    else p.onSelectNode(sel[0]);
                  }
                  setIsBoxSelecting(false);
                  setSelectionBox(null);
                  setIsPanning(false);
                }}
                onMouseLeave={() => { if (dragId) p.onDragStateChange?.(false); setDragId(null); setIsPanning(false); setIsBoxSelecting(false); setSelectionBox(null); }}
                onMouseDown={(e)=>{
                  if (e.button===1) {
                    e.preventDefault();
                    setIsPanning(true);
                    panStart.current = { x: e.clientX, y: e.clientY, scrollLeft: scrollContainerRef.current?.scrollLeft||0, scrollTop: scrollContainerRef.current?.scrollTop||0 };
                    return;
                  }
                  if (e.target === e.currentTarget) {
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const x = (e.clientX - rect.left)/zoom;
                    const y = (e.clientY - rect.top)/zoom;
                    if (e.shiftKey || !isPanning) {
                      setIsBoxSelecting(true);
                      boxStart.current = {x,y};
                      setSelectionBox({x,y,w:0,h:0});
                      p.onSelectNode(null);
                      if (!e.shiftKey) p.onSelectIds([]);
                      setSelectedEdge(null);
                    } else {
                      setIsPanning(true);
                      panStart.current = { x: e.clientX, y: e.clientY, scrollLeft: scrollContainerRef.current?.scrollLeft||0, scrollTop: scrollContainerRef.current?.scrollTop||0 };
                    }
                  }
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setSelectedEdge(null);
                  }
                }}
                style={{
                  width: `${canvasWidth}px`,
                  height: `${canvasHeight}px`,
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                }}
                className="absolute inset-0 dot-grid"
              >
                {snapEnabled && (
                  <div className="absolute inset-0 pointer-events-none opacity-[0.045]" style={{ backgroundImage: `linear-gradient(to right, var(--color-ink) 1px, transparent 1px), linear-gradient(to bottom, var(--color-ink) 1px, transparent 1px)`, backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px` }} />
                )}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ width: canvasWidth, height: canvasHeight }}>
                {p.edges.map((e, i) => {
                  const from = p.nodes.find((n) => n.id === e.from);
                  const to = p.nodes.find((n) => n.id === e.to);
                  if (!from || !to) return null;
                  const isSel = selectedEdge?.from === e.from && selectedEdge?.to === e.to;
                  const isActive = p.currentExecNode === e.to;
                  const isCyclic = (()=> {
                    const adj = new Map<string,string[]>();
                    p.nodes.forEach(n=> adj.set(n.id, []));
                    p.edges.forEach(ed=>{
                      if (ed===e) return;
                      adj.get(ed.from)?.push(ed.to);
                    });
                    const stack = [e.to];
                    const visited = new Set<string>();
                    while(stack.length){ const cur=stack.pop()!; if(cur===e.from) return true; if(visited.has(cur)) continue; visited.add(cur); (adj.get(cur)||[]).forEach(n=> stack.push(n)); }
                    return false;
                  })();
                  return (
                    <path
                      key={i}
                      d={edgePath(from, to)}
                      fill="none"
                      stroke={isCyclic ? 'var(--color-danger)' : isSel || isActive ? 'var(--color-brand)' : 'var(--color-line-strong)'}
                      strokeWidth={isActive ? 2.4 : isCyclic ? 2 : 1.8}
                      strokeDasharray={isCyclic ? '6 4' : isActive ? '7 5' : '0'}
                      opacity={isCyclic ? 0.9 : 1}
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
                        p.onSelectIds([]);
                      }}
                    />
                  );
                })}
                {selectionBox && (
                  <rect x={selectionBox.x} y={selectionBox.y} width={selectionBox.w} height={selectionBox.h} fill="rgba(0,103,192,0.08)" stroke="var(--color-brand)" strokeWidth={1} strokeDasharray="4 3" />
                )}
              </svg>

              {p.nodes.map((n) => {
                const isRunning = p.currentExecNode === n.id;
                const isSelectedSingle = p.selectedNodeId === n.id;
                const isMultiSelected = p.selectedIds.includes(n.id);
                const isSelected = isSelectedSingle || isMultiSelected;
                const idx = p.nodes.indexOf(n);
                const done = p.isExecuting && currentIdx !== -1 && idx < currentIdx;
                const issues = validateNode(n, p.edges, p.nodes);
                const hasError = issues.some(x=>x.level==='error');
                const hasWarn = issues.some(x=>x.level==='warn' && x.msg!=='orphan node') || issues.some(x=>x.msg==='orphan node');
                const orphan = issues.find(x=>x.msg==='orphan node');

                return (
                  <div
                    key={n.id}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const mx = (e.clientX - rect.left)/zoom;
                      const my = (e.clientY - rect.top)/zoom;
                      if (e.shiftKey) {
                        const next = p.selectedIds.includes(n.id) ? p.selectedIds.filter(id=> id!==n.id) : [...p.selectedIds, n.id];
                        p.onSelectIds(next);
                        if (next.length===1) p.onSelectNode(next[0]);
                        else if (next.length===0) p.onSelectNode(null);
                        else p.onSelectNode(n.id);
                      } else {
                        if (!p.selectedIds.includes(n.id)) {
                          p.onSelectIds([n.id]);
                          p.onSelectNode(n.id);
                        } else if (p.selectedIds.length>1) {
                          p.onSelectNode(n.id);
                        } else {
                          p.onSelectNode(n.id);
                        }
                      }
                      setSelectedEdge(null);
                      setDragId(n.id);
                      p.onDragStateChange?.(true);
                      const idsToTrack = (e.shiftKey ? (p.selectedIds.includes(n.id) ? p.selectedIds : [...p.selectedIds, n.id]) : (p.selectedIds.includes(n.id) && p.selectedIds.length>1 ? p.selectedIds : [n.id]));
                      dragStartPositions.current = new Map();
                      dragOffsets.current = new Map();
                      idsToTrack.forEach(id=>{
                        const node = p.nodes.find(nn=> nn.id===id);
                        if (node) {
                          dragStartPositions.current.set(id, {x: node.x, y: node.y});
                          dragOffsets.current.set(id, {dx: mx - node.x, dy: my - node.y});
                        }
                      });
                      if (!dragStartPositions.current.has(n.id)) {
                        dragStartPositions.current.set(n.id, {x: n.x, y: n.y});
                        dragOffsets.current.set(n.id, {dx: mx - n.x, dy: my - n.y});
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdge(null);
                    }}
                    className={`absolute rounded-xl border bg-surface shadow-card cursor-grab active:cursor-grabbing transition-shadow ${isSelected ? 'ring-2 ring-brand border-brand/40 z-10' : hasError ? 'border-danger/60 ring-1 ring-danger/30' : hasWarn ? 'border-warn/40' : 'border-line'} ${isRunning ? 'node-running border-brand' : ''} ${isMultiSelected ? 'shadow-pop' : ''}`}
                    style={{ left: n.x, top: n.y, width: NODE_W }}
                  >
                    <div className="h-1.5 w-full rounded-t-xl" style={{ background: hasError? '#d42a37' : hasWarn? '#b7791f' : n.color }} />
                    <div className="p-2.5">
                      <div className="flex items-start gap-2">
                        <span className="w-7 h-7 rounded-lg grid place-items-center text-white shrink-0" style={{ background: n.color }}>
                          <Icon name={n.icon} size={13} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-bold text-ink leading-tight truncate flex items-center gap-1">
                            {n.label}
                            {hasError && <span title={issues.filter(i=>i.level==='error').map(i=>i.msg).join(', ')} className="w-3.5 h-3.5 rounded-full bg-danger text-white grid place-items-center shrink-0"><Icon name="alert" size={8} /></span>}
                            {!hasError && hasWarn && <span title={issues.map(i=>i.msg).join(', ')} className="w-3.5 h-3.5 rounded-full bg-warn text-white grid place-items-center shrink-0"><Icon name="alert" size={8} /></span>}
                          </div>
                          <div className="text-[9.5px] text-ink-3 font-mono truncate">{n.kind}</div>
                        </div>
                        <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${n.category === 'trigger' ? 'bg-brand' : 'bg-success'}`} />
                      </div>
                      <div className={`mt-2 text-[10px] rounded-md px-2 py-1 font-mono truncate border ${hasError? 'bg-danger/5 border-danger/20 text-danger' : hasWarn? 'bg-warn/5 border-warn/20 text-ink-2' : 'bg-elevated border-line text-ink-2'}`}>
                        {hasError ? issues.find(i=>i.level==='error')?.msg : orphan ? 'orphan' : Object.values(n.config)[0] || '—'}
                      </div>
                      {done && (
                        <div className="absolute top-2 right-9 w-4 h-4 rounded-full bg-success text-white grid place-items-center">
                          <Icon name="check" size={9} strokeWidth={3.2} />
                        </div>
                      )}
                      {isMultiSelected && <div className="absolute -top-1 -right-1 w-3 h-3 bg-brand rounded-full border-2 border-surface" />}
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

              <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-surface/95 backdrop-blur px-3 py-1.5 rounded-full border border-line text-[11px] shadow-card pointer-events-none">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-ink-2 hidden sm:inline">Drag nodes · click ports to connect · Shift+click multi</span>
                <span className="text-ink-2 sm:hidden">Drag · Shift multi</span>
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
              {p.selectedIds.length>1 && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-ink text-white px-3 py-1.5 rounded-full text-[11px] font-semibold shadow-pop flex items-center gap-2">
                  {p.selectedIds.length} nodes selected
                  <button onClick={()=> p.onDuplicateNodes(p.selectedIds)} className="bg-white/15 hover:bg-white/25 rounded-full px-2 py-0.5 flex items-center gap-1"><Icon name="copy" size={10} /> Duplicate</button>
                  <button onClick={()=>{
                    p.onNodesChange(p.nodes.filter(n=> !p.selectedIds.includes(n.id)));
                    p.onEdgesChange(p.edges.filter(e=> !p.selectedIds.includes(e.from) && !p.selectedIds.includes(e.to)));
                    p.onSelectIds([]); p.onSelectNode(null);
                  }} className="bg-danger hover:bg-danger/90 text-white rounded-full px-2 py-0.5 flex items-center gap-1"><Icon name="trash" size={10} /> Delete</button>
                  <button onClick={()=> {p.onSelectIds([]); p.onSelectNode(null);}} className="hover:bg-white/15 rounded-full p-1"><Icon name="x" size={11} /></button>
                </div>
              )}
              </div>
            </div>
          </div>
          {/* Minimap - fixed overlay, not scrolling */}
          {showMinimap && (
            <div className="absolute bottom-3 right-3 w-[180px] h-[120px] bg-surface/95 backdrop-blur border border-line rounded-xl shadow-pop overflow-hidden hidden lg:block z-20">
              <div className="text-[9px] font-bold tracking-[0.1em] text-ink-3 px-2 py-1 border-b border-line flex items-center justify-between">
                MINIMAP <span className="text-[9px] font-mono">{Math.round(zoom*100)}%</span>
              </div>
              <div className="relative w-full h-[96px] bg-canvas overflow-hidden cursor-pointer"
                onClick={(e)=>{
                  const rect = e.currentTarget.getBoundingClientRect();
                  const xPct = (e.clientX - rect.left)/rect.width;
                  const yPct = (e.clientY - rect.top)/rect.height;
                  if (scrollContainerRef.current) {
                    const maxScrollLeft = scaledW - scrollPos.w;
                    const maxScrollTop = scaledH - scrollPos.h;
                    scrollContainerRef.current.scrollLeft = xPct * maxScrollLeft;
                    scrollContainerRef.current.scrollTop = yPct * maxScrollTop;
                  }
                }}
              >
                {p.nodes.map(n=>{
                  const nx = (n.x / canvasWidth)*100;
                  const ny = (n.y / canvasHeight)*100;
                  const isSel = p.selectedIds.includes(n.id) || p.selectedNodeId===n.id;
                  return <div key={n.id} className={`absolute w-1.5 h-1.5 rounded-sm ${isSel? 'bg-brand ring-1 ring-brand' : ''}`} style={{ left: `${nx}%`, top: `${ny}%`, background: isSel? 'var(--color-brand)' : n.color }} />;
                })}
                <div className="absolute border border-brand/60 bg-brand/10 pointer-events-none"
                  style={{
                    left: `${( scrollPos.left / scaledW)*100}%`,
                    top: `${( scrollPos.top / scaledH)*100}%`,
                    width: `${ Math.min(100, ( scrollPos.w / scaledW)*100 )}%`,
                    height: `${ Math.min(100, ( scrollPos.h / scaledH)*100 )}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        <div className="w-[280px] bg-surface border-l border-line p-3.5 space-y-3 overflow-auto custom-scrollbar hidden lg:block">
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
                {(() => {
                  const iss = validateNode(selected, p.edges, p.nodes);
                  if (iss.length===0) return null;
                  return (
                    <div className={`mt-2.5 rounded-lg p-2 border text-[11px] ${iss.some(i=>i.level==='error')? 'bg-danger/10 border-danger/20 text-danger' : 'bg-warn/10 border-warn/20 text-warn'}`}>
                      <div className="font-bold flex items-center gap-1"><Icon name="alert" size={11} /> {iss.some(i=>i.level==='error')? 'Needs attention' : 'Warning'}</div>
                      <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {iss.map((i,idx)=><li key={idx} className="text-[11px]">{i.msg}</li>)}
                      </ul>
                    </div>
                  );
                })()}
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
                  {k === 'script' || k==='content' ? (
                    <textarea
                      value={v}
                      rows={3}
                      onChange={(e) => p.onNodesChange(p.nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, [k]: e.target.value } } : n)))}
                      className="w-full text-[11px] font-mono border border-line rounded-lg px-2.5 py-1.5 bg-surface text-ink focus:outline-none focus:border-brand resize-none"
                    />
                  ) : k==='then' || k==='else' ? (
                    <select
                      value={v}
                      onChange={e=> p.onNodesChange(p.nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, [k]: e.target.value } } : n)))}
                      className="w-full text-[12px] border border-line rounded-lg px-2.5 py-1.5 bg-surface text-ink focus:outline-none focus:border-brand"
                    >
                      <option value="">— none —</option>
                      {p.nodes.filter(nn=> nn.id!==selected.id).map(nn=> <option key={nn.id} value={nn.id}>{nn.label} ({nn.id})</option>)}
                    </select>
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

              <div className="flex gap-1.5">
                <button
                  onClick={() => p.onDuplicateNodes([selected.id])}
                  className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-ink-2 border border-line py-1.5 rounded-lg hover:bg-brand/5 hover:text-brand hover:border-brand/30 transition-colors"
                >
                  <Icon name="copy" size={11} /> Duplicate
                </button>
                <button
                  onClick={() => {
                    p.onNodesChange(p.nodes.filter((n) => n.id !== selected.id));
                    p.onEdgesChange(p.edges.filter((e) => e.from !== selected.id && e.to !== selected.id));
                    p.onSelectNode(null);
                    p.onSelectIds([]);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-danger border border-danger/25 py-1.5 rounded-lg hover:bg-danger/5 transition-colors"
                >
                  <Icon name="trash" size={11} /> Delete
                </button>
              </div>
              <div className="text-[10px] text-ink-3 text-center">Del · Ctrl+D duplicate · Ctrl+C/V</div>
            </>
          ) : (
            <div className="py-10 text-center space-y-1.5">
              <Icon name="nodes" size={22} className="mx-auto text-ink-3" />
              <div className="text-[11px] text-ink-3">Select a node to edit</div>
              <div className="text-[10px] text-ink-3">Shift+click to multi-select<br/>Drag on canvas for box select</div>
            </div>
          )}
        </div>
      </div>

      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={()=> setShowHelp(false)} />
          <div className="relative bg-surface rounded-2xl shadow-pop border border-line w-full max-w-[480px] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-bold text-ink flex items-center gap-2"><Icon name="info" size={16}/> Atajos Designer</h3>
              <button onClick={()=> setShowHelp(false)} className="w-7 h-7 grid place-items-center rounded-full hover:bg-elevated text-ink-2"><Icon name="x" size={14}/></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Ctrl+Z / Ctrl+Y</kbd><span className="text-ink-2">Undo / Redo</span>
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Ctrl+K</kbd><span className="text-ink-2">Command palette</span>
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Shift+Click</kbd><span className="text-ink-2">Multi-select</span>
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Arrastrar fondo</kbd><span className="text-ink-2">Box select</span>
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Ctrl+C / V</kbd><span className="text-ink-2">Copiar / Pegar</span>
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Ctrl+D</kbd><span className="text-ink-2">Duplicar nodo</span>
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Del</kbd><span className="text-ink-2">Borrar</span>
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Ctrl+Wheel</kbd><span className="text-ink-2">Zoom</span>
              <kbd className="bg-elevated border border-line rounded px-2 py-1 font-mono">Middle-drag</kbd><span className="text-ink-2">Pan</span>
            </div>
            <div className="text-[10px] text-ink-3 text-center border-t border-line pt-3">Arrastra puertos para conectar · Click en edge para borrar · Grid snap 20px · ? para cerrar</div>
          </div>
        </div>
      )}
      <CommandPalette open={showCommandPalette} onClose={()=> setShowCommandPalette(false)} onAddNode={p.onAddNode} onAutoLayout={p.onAutoLayout} onUndo={p.onUndo} onRedo={p.onRedo} onDuplicateFlow={()=> p.onDuplicateFlow(p.flowId)} />
    </div>
  );
}

function PaletteButton({ item, onAdd, isFav, onToggleFav }: { item: (typeof PALETTE)[number]; onAdd: () => void; isFav?: boolean; onToggleFav?: ()=>void }) {
  return (
    <div className="w-full text-left bg-surface border border-line rounded-lg p-2 hover:border-brand/40 hover:shadow-card transition-all flex gap-2 group relative">
      <button onClick={onAdd} className="flex gap-2 flex-1 min-w-0 text-left">
        <span className="w-7 h-7 rounded-md grid place-items-center text-white shrink-0 group-hover:scale-105 transition-transform" style={{ background: item.color }}>
          <Icon name={item.icon} size={13} />
        </span>
        <span className="leading-tight min-w-0">
          <span className="block text-[11px] font-semibold text-ink truncate">{item.label}</span>
          <span className="block text-[9.5px] text-ink-3 truncate">{item.desc}</span>
        </span>
      </button>
      {onToggleFav && (
        <button onClick={(e)=> { e.stopPropagation(); onToggleFav(); }} title={isFav? 'Unfavorite' : 'Favorite'} className={`w-6 h-6 grid place-items-center rounded-md shrink-0 border ${isFav? 'bg-warn/15 border-warn/30 text-warn' : 'border-transparent text-ink-3 hover:text-warn hover:bg-warn/10'}`}>
          <span className="text-[12px]">{isFav? '★' : '☆'}</span>
        </button>
      )}
    </div>
  );
}

function PaletteGroup({ id: _id, label, icon, count, collapsed, onToggle, children }: { id:string, label:string, icon:string, count:number, collapsed:boolean, onToggle:()=>void, children:React.ReactNode }) {
  return (
    <div className="space-y-1">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-1 py-1 hover:bg-ink/[0.04] rounded-md group">
        <span className="text-[9.5px] font-bold tracking-[0.14em] text-ink-3 flex items-center gap-1.5">
          <Icon name={icon} size={11} className="text-ink-3 group-hover:text-brand transition-colors" />
          {label}
          <span className="bg-surface border border-line text-ink-2 text-[9px] px-1.5 py-0 rounded-full font-mono">{count}</span>
        </span>
        <span className={`w-5 h-5 grid place-items-center rounded-md border text-ink-3 group-hover:text-brand transition-colors ${collapsed ? 'border-transparent' : 'bg-surface border-line'}`}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={10} />
        </span>
      </button>
      {!collapsed && <div className="space-y-1.5 animate-[rise-in_0.2s_ease]">{children}</div>}
    </div>
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
