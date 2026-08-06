import { useCallback, useEffect, useRef } from 'react';

/**
 * Leak-safe timer manager.
 *
 * Every timeout/interval is tracked and automatically cleared when the
 * component unmounts, and callbacks are skipped if the component is already
 * gone. This prevents the two classic React leak classes:
 *   1. Intervals that keep firing after unmount (real memory retention).
 *   2. setState calls on unmounted components (dangling closures + warnings).
 */
export function useSafeTimers() {
  const timeouts = useRef<Set<number>>(new Set());
  const intervals = useRef<Set<number>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const to = timeouts.current;
    const iv = intervals.current;
    return () => {
      mounted.current = false;
      to.forEach((id) => window.clearTimeout(id));
      iv.forEach((id) => window.clearInterval(id));
      to.clear();
      iv.clear();
    };
  }, []);

  const setTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timeouts.current.delete(id);
      if (mounted.current) fn();
    }, ms);
    timeouts.current.add(id);
    return id;
  }, []);

  const setInterval = useCallback((fn: () => void, ms: number) => {
    const id = window.setInterval(() => {
      if (mounted.current) fn();
      else window.clearInterval(id);
    }, ms);
    intervals.current.add(id);
    return id;
  }, []);

  const clearTimeout = useCallback((id: number | null | undefined) => {
    if (id == null) return;
    window.clearTimeout(id);
    timeouts.current.delete(id);
  }, []);

  const clearInterval = useCallback((id: number | null | undefined) => {
    if (id == null) return;
    window.clearInterval(id);
    intervals.current.delete(id);
  }, []);

  const isMounted = useCallback(() => mounted.current, []);

  return { setTimeout, setInterval, clearTimeout, clearInterval, isMounted };
}
