import { Activity, Children, isValidElement, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)');

function timing(kind: 'page' | 'enter' | 'exit' = 'enter'): KeyframeAnimationOptions {
  const style = getComputedStyle(document.documentElement);
  // CSS minification can rewrite milliseconds to seconds; WAAPI expects milliseconds.
  const tokens = { page: ['--motion-page', 320], enter: ['--motion-overlay', 240], exit: ['--motion-exit', 180] } as const;
  const [name, fallback] = tokens[kind];
  const token = style.getPropertyValue(name).trim();
  const duration = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000);
  return {
    duration: Number.isFinite(duration) ? Math.max(0, duration) : fallback,
    easing: style.getPropertyValue('--motion-ease').trim() || 'cubic-bezier(.22,.61,.36,1)',
    fill: 'both',
  };
}

// Finish immediately if the accessibility preference changes during a transition.
function watchMotion(animations: Animation[]) {
  const preference = reducedMotion();
  const change = () => { if (preference.matches) animations.forEach(animation => animation.finish()); };
  preference.addEventListener('change', change);
  return () => {
    preference.removeEventListener('change', change);
    animations.forEach(animation => animation.cancel());
    // Canceled animations still reference their target nodes until the objects are released.
    animations.length = 0;
  };
}

export function usePresence(open: boolean) {
  const [present, setPresent] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const interrupted = useRef(new Map<Element, Keyframe>());
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !present) { interrupted.current.clear(); return; }
    const panel = root.querySelector<HTMLElement>('.ww-sheet, .ww-choice-panel, .app-modal, .app-toast');
    const backdrop = root.querySelector<HTMLElement>('.ww-overlay, .ww-choice-overlay, .app-modal-backdrop');
    if (reducedMotion().matches || !root.animate) {
      interrupted.current.clear();
      if (!open) setPresent(false);
      return;
    }
    const animations: Animation[] = [];
    if (backdrop) animations.push(backdrop.animate([interrupted.current.get(backdrop) ?? { opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], timing(open ? 'enter' : 'exit')));
    if (panel) animations.push(panel.animate([
      interrupted.current.get(panel) ?? { transform: open ? 'translate3d(0,24px,0)' : 'translate3d(0,0,0)', opacity: open ? 0 : 1 },
      { transform: open ? 'translate3d(0,0,0)' : 'translate3d(0,18px,0)', opacity: open ? 1 : 0 },
    ], timing(open ? 'enter' : 'exit')));
    interrupted.current.clear();
    let alive = true;
    void Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (!alive) return;
      if (!open) setPresent(false);
      cleanup();
    }).catch(() => {});
    const cleanup = watchMotion(animations);
    return () => {
      alive = false;
      for (const animation of animations) {
        const target = (animation.effect as KeyframeEffect).target;
        if (target && (animation.playState === 'running' || animation.playState === 'paused')) {
          const style = getComputedStyle(target);
          interrupted.current.set(target, { opacity: style.opacity, ...(target === panel ? { transform: style.transform } : {}) });
        }
      }
      cleanup();
    };
  }, [open, present]);
  return { present, ref };
}

export function Presence({ show, children, portal = false }: { show: boolean; children: ReactNode; portal?: boolean }) {
  const { present, ref } = usePresence(show);
  const retained = useRef(children);
  useLayoutEffect(() => { if (show) retained.current = children; else if (!present) retained.current = null; }, [show, children, present]);
  if (!present) return null;
  const content = <div className="app-presence" ref={ref} inert={!show} data-closing={!show || undefined}>{show ? children : retained.current}</div>;
  return portal && typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}

export type PageStackHandle = { captureScroll: () => void; resetScroll: (id: string) => void };
type PageProps = { id: string; children: ReactNode; retain?: boolean };
export function Page({ children }: PageProps) { return <>{children}</>; }

export function PageStack({ active, children, ref, onSettled }: { active: string; children: ReactNode; ref?: Ref<PageStackHandle>; onSettled?: () => void }) {
  const pages = Children.toArray(children).filter(isValidElement) as ReactElement<PageProps>[];
  const transientIds = pages.filter(page => page.props.retain === false).map(page => page.props.id);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  // Activity prepares the small tab views at background priority without starting their effects.
  const [deck, setDeck] = useState({ active, previous: '', direction: 1 });
  const positions = useRef(new Map<string, number>());
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const interrupted = useRef(new Map<Element, Keyframe>());
  useImperativeHandle(ref, () => ({
    captureScroll() { positions.current.set(active, window.scrollY); },
    resetScroll(id: string) { positions.current.delete(id); },
  }), [active]);
  if (active !== deck.active) {
    const index = (id: string) => pages.findIndex(page => page.props.id === id);
    setDeck({ active, previous: deck.active, direction: index(active) >= index(deck.active) ? 1 : -1 });
  }
  useLayoutEffect(() => {
    const incoming = nodes.current.get(active);
    if (!incoming || !deck.previous) return;
    const outgoing = nodes.current.get(deck.previous);
    window.scrollTo({ top: positions.current.get(active) ?? 0, behavior: 'instant' });
    if (outgoing) outgoing.style.setProperty('--page-scroll-offset', `${window.scrollY - (positions.current.get(deck.previous) ?? 0)}px`);
    const settle = () => {
      interrupted.current.clear();
      for (const id of transientIds) if (id !== active) positions.current.delete(id);
      setDeck(current => current.active === active ? { ...current, previous: '' } : current);
      settled.current?.();
    };
    if (reducedMotion().matches || !incoming.animate) { settle(); return; }
    const offset = deck.direction * 24;
    const animations = [incoming.animate([interrupted.current.get(incoming) ?? { opacity: 0, transform: `translate3d(${offset}px,0,0)` }, { opacity: 1, transform: 'translate3d(0,0,0)' }], timing('page'))];
    if (outgoing) animations.push(outgoing.animate([interrupted.current.get(outgoing) ?? { opacity: 1, transform: 'translate3d(0,0,0)' }, { opacity: 0, transform: `translate3d(${-offset}px,0,0)` }], timing('page')));
    interrupted.current.clear();
    let alive = true;
    void Promise.all(animations.map(animation => animation.finished)).then(() => { if (alive) { cleanup(); settle(); } }).catch(() => {});
    const cleanup = watchMotion(animations);
    return () => {
      alive = false;
      for (const animation of animations) {
        const target = (animation.effect as KeyframeEffect).target;
        if (target && (animation.playState === 'running' || animation.playState === 'paused')) {
          const style = getComputedStyle(target);
          interrupted.current.set(target, { opacity: style.opacity, transform: style.transform });
        }
      }
      cleanup();
    };
    // Only navigation starts a transition; state updates and animation completion don't replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return <div className="app-view-stack">{pages.map(page => {
    const id = page.props.id;
    const current = id === active;
    const exiting = id === deck.previous && !current;
    if (page.props.retain === false && !current && !exiting) return null;
    return <Activity key={id} mode={current || exiting ? 'visible' : 'hidden'}><div
      ref={node => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); }}
      className="app-view" data-page={id} data-active={current || undefined} data-exiting={exiting || undefined}
      inert={!current} aria-hidden={!current || undefined}
    ><div className="app-view-content">{page.props.children}</div></div></Activity>;
  })}</div>;
}
