import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { coursePassages } from '@/lib/curriculum';
import type { State } from '@/lib/learning';
import { StudyCache } from './study-cache';

const Context = createContext<StudyCache | null>(null);

export function warmWhenIdle(tasks: (() => void)[]) {
  if (!tasks.length) return () => {};
  let cancelled = false, handle = 0, cursor = 0;
  const idle = typeof window.requestIdleCallback === 'function';
  const schedule = () => { handle = idle ? window.requestIdleCallback(run, {timeout: 1000}) : window.setTimeout(() => run(), 80); };
  const run = (deadline?: IdleDeadline) => {
    if (cancelled || document.hidden) return;
    if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 4) { schedule(); return; }
    tasks[cursor++]?.();
    if (cursor < tasks.length) schedule();
  };
  schedule();
  return () => { cancelled = true; if (idle) window.cancelIdleCallback(handle); else window.clearTimeout(handle); };
}

export function StudyCacheProvider({state, children}: {state: State; children: ReactNode}) {
  const cache = useRef<StudyCache | null>(null);
  if (!cache.current) cache.current = new StudyCache();
  const value = cache.current;
  useEffect(() => warmWhenIdle([
    () => { value.index(state); },
    ...coursePassages(state).slice(0, 2).map(passage => () => { value.parts(passage.text); }),
  ]), [value, state.custom, state.settings.level]);
  useEffect(() => () => value.clear(), [value]);
  return <Context value={value}>{children}</Context>;
}

export function useStudyCache() {
  const shared = useContext(Context);
  const local = useRef<StudyCache | null>(null);
  if (!shared && !local.current) local.current = new StudyCache();
  return shared ?? local.current!;
}
