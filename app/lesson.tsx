"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, RefreshCw } from 'lucide-react';
import { seedWords, type Word } from '@/lib/learning';
import { passageParts, readingSummary, type Passage } from '@/lib/reading';
import { Choice } from './ui';
import type { AppProps, CaptureSnapshot, StateSnapshot } from './types';

type HistoryItem = { id: string; title: string; count: number; completed: boolean };
type ReadingResponse = { passage: Passage | null; history: HistoryItem[]; nextCursor: string | null; available: number; completedCount: number; error?: string };
export function Lesson({ state, save, busy, onWord, captureSnapshot }: AppProps & { onWord: (word: Word) => void; captureSnapshot: CaptureSnapshot }) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [available, setAvailable] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [completedHere, setCompletedHere] = useState<string[]>([]);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const words = useMemo(() => new Map([...seedWords, ...state.custom].map(word => [word.id, word])), [state.custom]);
  const summary = useMemo(() => readingSummary(state), [state]);
  const disabled = busy || !!working || loading;
  const completed = !!passage && (!!state.reading?.completed[passage.id] || completedHere.includes(passage.id));

  const load = useCallback(async (id?: string, signal?: AbortSignal) => {
    const response = await fetch('/api/passages' + (id ? '?id=' + encodeURIComponent(id) : ''), { cache: 'no-store', signal });
    const data = await response.json() as ReadingResponse;
    if (!response.ok) throw Error(data.error || '段落加载失败。');
    if (!mounted.current) return;
    setPassage(data.passage); setHistory(data.history); setNextCursor(data.nextCursor);
    setAvailable(data.available); setCompletedCount(data.completedCount);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(undefined, controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [load]);

  async function open(id?: string) {
    if (inFlight.current) return;
    inFlight.current = true; setWorking('正在打开段落…'); setError('');
    try { await load(id); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '加载失败，请重试。'); }
    finally { inFlight.current = false; if (mounted.current) setWorking(''); }
  }

  async function more() {
    if (inFlight.current || !nextCursor) return;
    inFlight.current = true; setWorking('正在加载更多段落…'); setError('');
    try {
      const response = await fetch('/api/passages?cursor=' + encodeURIComponent(nextCursor), { cache: 'no-store' });
      const data = await response.json() as ReadingResponse;
      if (!response.ok) throw Error(data.error || '段落目录加载失败。');
      if (!mounted.current) return;
      setHistory(items => [...items, ...data.history.filter(item => !items.some(old => old.id === item.id))]);
      setNextCursor(data.nextCursor);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '段落目录加载失败。'); }
    finally { inFlight.current = false; if (mounted.current) setWorking(''); }
  }

  async function act(kind: 'next' | 'complete') {
    if (inFlight.current || !passage) return;
    const receiveSaved = captureSnapshot();
    inFlight.current = true; setError(''); setWorking('正在保存阅读进度…');
    try {
      if (!completed) {
        const response = await fetch('/api/passages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete', id: passage.id, operationId: crypto.randomUUID() }) });
        const data = await response.json() as StateSnapshot & { error?: string };
        if (!response.ok) throw Error(data.error || '阅读进度未保存，请重试。');
        if (!receiveSaved(data, response.headers.get('etag'))) return;
        if (!mounted.current) return;
        setCompletedHere(ids => [...ids, passage.id]); setCompletedCount(count => count + 1);
        setHistory(items => items.map(item => item.id === passage.id ? { ...item, completed: true } : item));
      }
      if (kind === 'next' && mounted.current) {
        setWorking('正在打开下一段…');
        const response = await fetch('/api/passages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'next', afterId: passage.id }) });
        const data = await response.json() as { passage: Passage | null; error?: string };
        if (!response.ok) throw Error(data.error || '下一段加载失败，请重试。');
        if (mounted.current) { setPassage(data.passage); document.querySelector('.reading-workspace')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }
      }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '操作未完成，请重试。'); }
    finally { inFlight.current = false; if (mounted.current) setWorking(''); }
  }

  return <div className="reading-workspace">
    <div className="reading-progress" aria-label="语境阅读进度"><div><span>已在句子中读过</span><strong>{summary.covered.toLocaleString()} <small>/ {summary.total.toLocaleString()} 个词条</small></strong></div><div><span>已读段落</span><strong>{completedCount} <small>/ {available} 篇</small></strong></div><p>记忆辅助段落 · 中英混合内容，用语境帮助理解；导入词条暂未编入阅读。</p></div>
    <div className="toolbar reading-toolbar"><Choice label="词义提示" value={state.settings.gloss} onChange={gloss => save({ type: 'settings', settings: { gloss } })} options={ [['click', '点词查看'], ['direct', '随句显示']] } disabled={disabled}/><span className="reading-instruction">先读完整句；不懂的词可以点开。</span></div>
    {error && <div className="error-banner" role="alert">{error}<button className="secondary" disabled={disabled} onClick={() => void open(passage?.id)}>重新加载</button></div>}
    {working && <p className="reading-status" role="status"><RefreshCw size={16} className="reading-spinner"/>{working}</p>}
    {loading ? <div className="loading-state" role="status">正在打开阅读内容…<div className="skeleton-line"/><div className="skeleton-line short"/><div className="skeleton-card"/></div> : passage ? <article className="paper-card lesson reading-paper">
      <div className="section-label"><span>{passage.wordIds.length} 个目标词 · {passage.level === 'CET6' ? '六级' : '四级'}语境阅读</span><span className="pill">{completed ? '已读过 · 可以重读' : '内置故事 · 记忆辅助段落'}</span></div>
      <h2>{passage.title}</h2>
      <div className="story reading-story">{passageParts(passage.text).map((part, index) => {
        if (part.type === 'text') return <span key={index}>{part.text}</span>;
        const word = words.get(part.id);
        if (!word) return <span key={index}>〔词条暂不可用〕</span>;
        return <span key={index}><button className="word-link" aria-label={"查看单词 " + word.word} onClick={() => onWord(word)}>{word.word}</button>{state.settings.gloss === 'direct' && <span className="inline-gloss">（{word.meaning}）</span>}</span>;
      })}</div>
      <div className="reading-footer"><div className="action-row"><button className="primary" disabled={disabled} onClick={() => void act('next')}><BookOpen size={17}/>{completed ? '继续下一段' : '读完，继续下一段'}</button><button className="secondary" disabled={disabled || completed} onClick={() => void act('complete')}><Check size={17}/>{completed ? '阅读进度已保存' : '读完，保存进度'}</button></div><p>内容已写好，可以随时从目录重读。阅读足迹与测试成绩分别记录。</p></div>
    </article> : <section className="reading-empty"><BookOpen size={28}/><h2>阅读内容暂不可用</h2><p>重新加载后，从当前词表的第一篇未读段落继续。</p><button className="primary" disabled={disabled} onClick={() => void open()}>重新加载</button></section>}
    {history.length > 0 && <details className="reading-history"><summary>段落目录 · 共 {available} 篇 · 随时重读</summary><div>{history.map(item => <button key={item.id} className={passage?.id === item.id ? 'current' : ''} disabled={disabled} onClick={() => void open(item.id)}><span>{item.title}</span><small>{item.count} 词 · {item.completed || completedHere.includes(item.id) ? '已读' : '未读'}</small></button>)}</div>{nextCursor && <button className="secondary" disabled={disabled} onClick={() => void more()}>更多段落</button>}</details>}
  </div>;
}
