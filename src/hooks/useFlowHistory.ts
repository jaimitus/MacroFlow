import { useCallback, useRef, useState } from 'react';
import type { Flow } from '../types';

const MAX_HISTORY = 60;

// Deep clone via JSON - flows are simple POJOs
function cloneFlows(flows: Flow[]): Flow[] {
  return JSON.parse(JSON.stringify(flows));
}

export function useFlowHistory(initial: Flow[]) {
  const historyRef = useRef<Flow[][]>([cloneFlows(initial)]);
  const indexRef = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const isApplyingRef = useRef(false);

  const syncFlags = useCallback(() => {
    setCanUndo(indexRef.current > 0);
    setCanRedo(indexRef.current < historyRef.current.length - 1);
  }, []);

  const push = useCallback((nextFlows: Flow[]) => {
    if (isApplyingRef.current) return;
    const cloned = cloneFlows(nextFlows);
    // Avoid pushing identical snapshot
    const curr = historyRef.current[indexRef.current];
    if (JSON.stringify(curr) === JSON.stringify(cloned)) return;

    // Truncate future
    const sliced = historyRef.current.slice(0, indexRef.current + 1);
    sliced.push(cloned);
    if (sliced.length > MAX_HISTORY) {
      sliced.shift();
      // keep index at last
      historyRef.current = sliced;
      indexRef.current = sliced.length - 1;
    } else {
      historyRef.current = sliced;
      indexRef.current = sliced.length - 1;
    }
    syncFlags();
  }, [syncFlags]);

  const undo = useCallback((): Flow[] | null => {
    if (indexRef.current <= 0) return null;
    isApplyingRef.current = true;
    indexRef.current -= 1;
    const snapshot = cloneFlows(historyRef.current[indexRef.current]);
    syncFlags();
    // release flag next tick
    setTimeout(() => { isApplyingRef.current = false; }, 0);
    return snapshot;
  }, [syncFlags]);

  const redo = useCallback((): Flow[] | null => {
    if (indexRef.current >= historyRef.current.length - 1) return null;
    isApplyingRef.current = true;
    indexRef.current += 1;
    const snapshot = cloneFlows(historyRef.current[indexRef.current]);
    syncFlags();
    setTimeout(() => { isApplyingRef.current = false; }, 0);
    return snapshot;
  }, [syncFlags]);

  const isApplying = useCallback(() => isApplyingRef.current, []);

  return { push, undo, redo, canUndo, canRedo, isApplying, historyRef, indexRef };
}
