import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'macroflow.theme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStored(): ThemePref {
  if (typeof localStorage === 'undefined') return 'system';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

/**
 * Theme controller: 'light' | 'dark' | 'system', persisted to localStorage and
 * kept in sync with the OS preference when set to 'system'.
 */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => readStored());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    readStored() === 'system' ? getSystemTheme() : (readStored() as ResolvedTheme)
  );

  useEffect(() => {
    const next = pref === 'system' ? getSystemTheme() : pref;
    setResolved(next);
    apply(next);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Persisting a preference is best-effort and must not break the UI.
    }
  }, [pref]);

  useEffect(() => {
    if (pref !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = getSystemTheme();
      setResolved(next);
      apply(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const toggle = useCallback(() => {
    setPref((p) => {
      const current = p === 'system' ? getSystemTheme() : p;
      return current === 'dark' ? 'light' : 'dark';
    });
  }, []);

  return { pref, resolved, setPref, toggle };
}
