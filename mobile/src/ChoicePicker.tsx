import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import './ChoicePicker.css';
import { usePresence } from './Motion';

export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  badge?: string;
};

export type ChoicePickerProps = {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  description?: string;
  variant?: 'field' | 'compact' | 'setting';
  disabled?: boolean;
  className?: string;
};

const focusableSelector = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function ChoicePicker({
  label, value, options, onChange, description, variant = 'field', disabled = false, className = '',
}: ChoicePickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { present, ref: presenceRef } = usePresence(open);
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const openingValue = useRef(value);
  const closing = useRef(false);
  const restoreWhenEnabled = useRef(false);
  const current = options.find(option => option.value === value);
  const selected = options.find(option => option.value === draft);
  const unavailable = disabled || !options.length;
  const canConfirm = !unavailable && !!selected && draft !== value && openingValue.current === value;

  function isTopOverlay() {
    const overlays = document.querySelectorAll('[data-ww-overlay]');
    return overlays.length > 0 && overlays[overlays.length - 1] === overlayRef.current;
  }

  function close() {
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
  }

  function show() {
    if (unavailable || open) return;
    openingValue.current = value;
    closing.current = false;
    setDraft(value);
    setOpen(true);
  }

  function confirm() {
    if (closing.current || !canConfirm) return;
    close();
    onChange(draft);
  }

  useEffect(() => {
    if (open && (unavailable || value !== openingValue.current || !options.some(option => option.value === draft))) close();
  }, [open, unavailable, value, options, draft]);

  useEffect(() => {
    if (!disabled && !present && restoreWhenEnabled.current) {
      restoreWhenEnabled.current = false;
      if (!document.activeElement || document.activeElement === document.body) triggerRef.current?.focus({ preventScroll: true });
    }
  }, [disabled, present]);

  useLayoutEffect(() => {
    if (!present) return;
    const trigger = triggerRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = overlayRef.current;
    const panel = panelRef.current;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const otherOverlayAtOpen = Array.from(document.querySelectorAll('[data-ww-overlay]')).some(node => node !== overlay);
    const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (scrollbar) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight || '0') + scrollbar}px`;
    document.body.style.overflow = 'hidden';

    const focusSelected = () => {
      const option = optionRefs.current.get(draftRef.current) ?? optionRefs.current.values().next().value;
      (option ?? panel)?.focus({ preventScroll: true });
      option?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    };
    focusSelected();

    const back = (event: Event) => {
      if (!isTopOverlay()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (!isTopOverlay()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const targets = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0);
      const first = targets[0], last = targets[targets.length - 1];
      if (!first) { event.preventDefault(); panel.focus({ preventScroll: true }); return; }
      if (!panel.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus({ preventScroll: true });
      }
    };
    const focusin = (event: FocusEvent) => {
      if (isTopOverlay() && panel && event.target instanceof Node && !panel.contains(event.target)) focusSelected();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    window.addEventListener('ww:back', back);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      window.removeEventListener('ww:back', back);
      const anotherOverlay = Array.from(document.querySelectorAll('[data-ww-overlay]')).some(node => node !== overlay);
      document.body.style.overflow = anotherOverlay ? 'hidden' : previousOverflow === 'hidden' && otherOverlayAtOpen ? '' : previousOverflow;
      document.body.style.paddingRight = previousPadding;
      const target = trigger?.isConnected ? trigger : previousFocus?.isConnected ? previousFocus : null;
      if (target && !target.matches(':disabled')) target.focus({ preventScroll: true });
      else if (trigger?.isConnected) restoreWhenEnabled.current = true;
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    };
  }, [present]);

  function moveOption(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key) || !isTopOverlay()) return;
    event.preventDefault();
    const index = options.findIndex(option => option.value === draft);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (Math.max(0, index) + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    setDraft(option.value);
    const target = optionRefs.current.get(option.value);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  return <div className={`ww-choice ww-choice-${variant}${className ? ` ${className}` : ''}`}>
    {variant === 'field' && <span className="ww-choice-label" id={`${id}-label`}>{label}</span>}
    <button ref={triggerRef} type="button" className="ww-choice-trigger" aria-label={`${label}：${current?.label ?? '请选择'}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined}
      disabled={unavailable} onClick={show}>
      {current?.icon && <span className="ww-choice-trigger-icon" aria-hidden="true">{current.icon}</span>}
      <span className="ww-choice-trigger-value">{current?.label ?? '请选择'}</span>
      {variant === 'setting' ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
    </button>
    {present && createPortal(<div className="app-presence" ref={presenceRef} inert={!open} data-closing={!open || undefined}><div ref={overlayRef} className="ww-choice-overlay" data-ww-overlay data-ww-choice-overlay
      onClick={event => { if (event.target === event.currentTarget && isTopOverlay()) close(); }}>
      <section ref={panelRef} className="ww-choice-panel" id={`${id}-panel`} role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1}>
        <div className="ww-choice-handle" aria-hidden="true" />
        <header className="ww-choice-panel-header"><div className="ww-choice-heading-icon" aria-hidden="true"><SlidersHorizontal size={22} strokeWidth={1.6} /></div>
          <div className="ww-choice-heading"><span className="ww-choice-eyebrow">MAKE IT YOURS</span><h2 id={`${id}-title`}>选择{label}</h2></div>
          <button type="button" className="ww-choice-close" aria-label="取消选择" onClick={close}><X size={21} /></button>
        </header>
        {description && <p className="ww-choice-description" id={`${id}-description`}>{description}</p>}
        <div className="ww-choice-options" role="radiogroup" aria-label={label} onKeyDown={moveOption}>
          {options.map((option, index) => <button key={option.value} ref={node => { if (node) optionRefs.current.set(option.value, node); else optionRefs.current.delete(option.value); }}
            type="button" role="radio" aria-checked={draft === option.value} tabIndex={draft === option.value || !selected && index === 0 ? 0 : -1}
            className={`ww-choice-option${draft === option.value ? ' ww-choice-option-selected' : ''}`}
            onClick={() => setDraft(option.value)}>
            {option.icon && <span className="ww-choice-option-icon" aria-hidden="true">{option.icon}</span>}
            <span className="ww-choice-option-copy"><span className="ww-choice-option-title">{option.label}{option.badge && <span className="ww-choice-badge">{option.badge}</span>}</span>{option.description && <span className="ww-choice-option-description">{option.description}</span>}</span>
            <span className="ww-choice-radio" aria-hidden="true">{draft === option.value && <Check size={15} strokeWidth={2.5} />}</span>
          </button>)}
        </div>
        <footer className="ww-choice-footer"><p className="ww-choice-footnote">{draft === value ? '选择适合你的安排' : '确认后保存这次选择'}</p><div className="ww-choice-actions"><button type="button" className="ww-choice-cancel" onClick={close}>取消</button><button type="button" className="ww-choice-confirm" disabled={!canConfirm} onClick={confirm}>确认选择<Check size={17} /></button></div></footer>
      </section>
    </div></div>, document.body)}
  </div>;
}
