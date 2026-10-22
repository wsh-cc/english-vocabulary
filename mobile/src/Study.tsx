import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowRight, BookOpen, Check, CheckCheck, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Eye, Layers, List, NotebookPen, RotateCcw, Search,
  SkipForward, Sparkles, Target, Volume2, X,
} from 'lucide-react';
import {
  availableModes, chinaDay, DAY, MODES, modeNames, seedWords,
  type Mode, type Result, type State, type Word,
} from '@/lib/learning';
import { coursePassages, nextReading } from '@/lib/curriculum';
import { ChoicePicker } from './ChoicePicker';
import { Presence } from './Motion';
import { useStudyCache, warmWhenIdle } from './StudyCache';
import './Study.css';

export type QueueItem = { word: Word; mode: Mode };
export type StudyProps = {
  state: State;
  dispatch: (action: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  onSpeak: (text: string) => void;
  onPractice: (items: QueueItem[], browse?: boolean) => void;
};

const levelName = (level: string) => level === 'CET4' ? '四级' : '六级';
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const dateText = (time: number) => dateFormatter.format(time);
const outcomeText = (outcome: Result['outcome']) => outcome === 'correct'
  ? '独立答对' : outcome === 'hinted' ? '借助提示' : '需要重温';
const dayStart = (time: number) => Date.parse(`${chinaDay(time)}T00:00:00+08:00`);
type ChoiceTuple = [value: string, label: string, description?: string, icon?: ReactNode];
const studyChoices: Record<'direction' | 'gloss' | 'level' | 'filterFamiliar' | 'wordFamiliar', ChoiceTuple[]> = {
  direction: [
    ['all', '全部方向', '一起复习认义、回忆和已有的语境题', <Layers size={20} />],
    ['meaning', modeNames.meaning, '看到英文，回忆本轮学习的中文义项', <BookOpen size={20} />],
    ['recall', modeNames.recall, '从中文义项，主动想起英文单词', <NotebookPen size={20} />],
    ['context', modeNames.context, '在新的英文句子中理解这个词', <Sparkles size={20} />],
  ],
  gloss: [
    ['click', '点词释义', '先读完整句，遇到不懂的词再轻点查看', <Eye size={20} />],
    ['direct', '随句释义', '中文释义直接跟在英文目标词后面', <BookOpen size={20} />],
  ],
  level: [
    ['all', '全部词表', '显示四级、六级及已导入的全部义项', <Layers size={20} />],
    ['CET4', '四级', '只查看带有四级标签的义项', <BookOpen size={20} />],
    ['CET6', '六级', '只查看带有六级标签的义项', <Target size={20} />],
  ],
  filterFamiliar: [
    ['all', '全部程度', '查看当前词表里所有熟悉程度的词', <Layers size={20} />],
    ['learning', '正在学习', '查看仍在积累中的词条', <NotebookPen size={20} />],
    ['unknown', '陌生', '查看自己标记为陌生的词条', <RotateCcw size={20} />],
    ['familiar', '自评熟悉', '查看自己认为熟悉、仍待测试的词条', <CheckCheck size={20} />],
  ],
  wordFamiliar: [
    ['learning', '正在学习', '继续学习，保持已有的复习安排', <NotebookPen size={20} />],
    ['unknown', '陌生，加入复习', '加入回想练习，已有的复习进度会保留', <RotateCcw size={20} />],
    ['familiar', '熟悉，低频抽查', '未测试的方向安排低频抽查，不记为通过', <CheckCheck size={20} />],
  ],
};

function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    let timer = 0;
    const resume = () => {
      window.clearInterval(timer);
      if (!document.hidden) { tick(); timer = window.setInterval(tick, 30_000); }
    };
    resume();
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  return now;
}

function Heading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="ww-page-heading"><div><span className="ww-eyebrow">{eyebrow}</span><h1>{title}</h1></div>{children}</header>;
}

function Select({ label, value, options, onChange, disabled, description }: {
  label: string; value: string; options: ChoiceTuple[];
  onChange: (value: string) => void; disabled?: boolean; description?: string;
}) {
  return <ChoicePicker className="ww-study-picker" label={label} description={description} value={value} disabled={disabled} onChange={onChange} options={options.map(([key, text, detail, icon]) => ({ value: key, label: text, description: detail, icon }))} />;
}

function Speak({ text, onSpeak }: { text: string; onSpeak: (text: string) => void }) {
  return <button className="ww-icon-button" type="button" aria-label={`朗读 ${text}`} onClick={() => onSpeak(text)}><Volume2 size={20} /></button>;
}

function Meter({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, value));
  return <div className="ww-meter" role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div>;
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ww-empty"><BookOpen size={28} strokeWidth={1.5} /><h3>{title}</h3><p>{children}</p></div>;
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const isTopOverlay = () => {
      const overlays = document.querySelectorAll('[data-ww-overlay]');
      return overlays.length > 0 && overlays.item(overlays.length - 1) === overlayRef.current;
    };
    node?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]')?.focus({ preventScroll: true });
    const back = (event: Event) => {
      if (event.defaultPrevented || !isTopOverlay()) return;
      event.preventDefault(); closeRef.current();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopOverlay()) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !node) return;
      const targets = Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(target => target.getClientRects().length > 0);
      const first = targets[0], last = targets[targets.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (!node.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keydown);
    window.addEventListener('ww:back', back);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('ww:back', back);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
    return <div ref={overlayRef} className="ww-overlay" data-ww-overlay onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} className={`ww-sheet${wide ? ' ww-sheet-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="ww-sheet-scroll"><div className="ww-sheet-handle" /><div className="ww-sheet-top"><span className="ww-eyebrow">{title}</span><button className="ww-icon-button" onClick={onClose} aria-label="关闭详情"><X size={22} /></button></div>{children}</div></div></div>;
}

function SevenDays({ state, now }: { state: State; now: number }) {
  const days = useStudyCache().sevenDays(state, now);
  const max = Math.max(1, ...days.map(day => day.count));
  return <section className="ww-card ww-burden"><div className="ww-section-title"><h2>未来七天</h2><span className="ww-muted">复习安排</span></div><div className="ww-burden-chart" aria-label="未来七天每天计划到期练习数，不含此前逾期练习">{days.map((day, index) => <div key={day.day}><strong>{day.count}</strong><div className="ww-bar-track"><span style={{ height: `${day.count ? Math.max(6, day.count / max * 100) : 0}%` }} /></div><span>{index === 0 ? '今天' : day.day.slice(5).replace('-', '/')}</span></div>)}</div><p className="ww-small">按北京时间安排 · 逾期练习已计入待复习</p></section>;
}

function History({ state, limit = 5 }: { state: State; limit?: number }) {
  const cache = useStudyCache();
  const wordMap = cache.index(state).byId;
  const events = cache.stats(state).events.slice(-limit).reverse();
  return events.length ? <div className="ww-history">{events.map(event => <div className="ww-history-row" key={event.id}><div><strong>{wordMap.get(event.wordId)?.word ?? '词条'}</strong><span>{modeNames[event.mode]} · {dateText(event.at)}{event.delayed ? ' · 延后测试' : ''}</span></div><span className={`ww-outcome ww-outcome-${event.outcome}`}>{outcomeText(event.outcome)}</span></div>)}</div> : <Empty title="回想，也是一种积累">完成练习后，这里会留下训练方向、结果和时间。</Empty>;
}

export function TodayView({ state, dispatch, busy, onSpeak, onPractice, onRead, onLibrary, onStats }: StudyProps & {
  onRead: () => void; onLibrary: () => void; onStats: () => void;
}) {
  const now = useClock();
  const cache = useStudyCache();
  const due = cache.due(state, now);
  const summary = cache.summary(state);
  const start = dayStart(now);
  const readToday = useMemo(() => Object.values(state.reading?.completed ?? {}).filter(time => time >= start && time < start + DAY).length, [state.reading?.completed, start]);
  const practicedToday = useMemo(() => state.events.filter(event => event.at >= start && event.at < start + DAY).length, [state.events, start]);
  const percent = Math.round(summary.covered / Math.max(1, summary.total) * 100);
  const [mode, setMode] = useState('all');
  const [assessing, setAssessing] = useState(false);
  const [assessmentIndex, setAssessmentIndex] = useState(0);
  const [assessmentFinished, setAssessmentFinished] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const words = cache.index(state).byLevel[state.settings.level];
  const assessment = useMemo(() => words.filter((_, index) => index % Math.max(1, Math.floor(words.length / 5)) === 0).slice(0, 5), [words]);
  const assessmentWord = assessment[assessmentIndex];
  const filtered = due.filter(item => mode === 'all' || item.mode === mode);
  const beijingHour = new Date(now + 8 * 3_600_000).getUTCHours();
  const greeting = beijingHour < 6 ? '夜深了' : beijingHour < 11 ? '早上好' : beijingHour < 14 ? '中午好' : beijingHour < 18 ? '下午好' : '晚上好';
  const assessmentLevel = useRef(state.settings.level);
  useEffect(() => {
    if(assessmentLevel.current===state.settings.level)return;
    assessmentLevel.current=state.settings.level;
    setAssessing(false); setAssessmentIndex(0); setAssessmentFinished(false); setRevealed(false);
  }, [state.settings.level]);
  async function finishAssessment() {
    if (busy || saving.current) return;
    saving.current = true;
    try {
      if (await dispatch({ type: 'settings', settings: { onboarded: true } })) setAssessing(false);
      else setError('初测设置未能保存，请重试。');
    } finally { saving.current = false; }
  }
  async function assess(familiar: boolean) {
    if (busy || saving.current || !assessmentWord) return;
    saving.current = true; setError('');
    try {
      if (!await dispatch({ type: 'familiar', wordId: assessmentWord.id, value: familiar ? 'familiar' : 'unknown' })) {
        setError('熟悉度未能保存，请重试。'); return;
      }
      if (assessmentIndex === assessment.length - 1) {
        setAssessmentFinished(true);
        if (await dispatch({ type: 'settings', settings: { onboarded: true } })) setAssessing(false);
        else setError('最后一项已保存，请重试完成初测。');
      } else { setAssessmentIndex(index => index + 1); setRevealed(false); }
    } finally { saving.current = false; }
  }
  return <div className="ww-page ww-today">
    <Heading eyebrow="A LITTLE EVERY DAY" title={`${greeting}，学习者。`}><span className="ww-tag">{levelName(state.settings.level)}学习</span></Heading>
    <section className="ww-reading-hero"><div className="ww-hero-illustration" aria-hidden="true"><div className="ww-illustration-sun" /><BookOpen size={108} strokeWidth={1.05} /><span className="ww-illustration-leaf" /><span className="ww-illustration-dot" /></div><span className="ww-eyebrow">WORDS IN CONTEXT</span><h2>在故事里，<br />与单词慢慢熟悉。</h2><p>每天读一段，让每一次相遇都有意义。</p><button className="ww-button ww-primary" disabled={busy} onClick={onRead}>{summary.covered ? '继续阅读' : '开始阅读'}<ArrowRight size={18} /></button><div className="ww-hero-progress"><div><span>内置词表阅读覆盖</span><strong>{percent}%</strong></div><Meter value={percent} label="内置词表阅读覆盖" /><small>{summary.covered.toLocaleString()} / {summary.total.toLocaleString()} 个词条 · 接触不等于掌握</small></div></section>
    <div className="ww-today-counts"><div><BookOpen size={19} /><strong>{readToday}<small>段</small></strong><span>今日阅读</span></div><div><NotebookPen size={19} /><strong>{practicedToday}<small>次</small></strong><span>今日回想</span></div><div><RotateCcw size={19} /><strong>{due.length}<small>项</small></strong><span>当前待复习</span></div></div>
    <section className="ww-card ww-agenda"><div className="ww-section-title"><h2>给记忆一次回响</h2><span className="ww-tag">{due.length} 项到期</span></div><p className="ww-muted">先试着想起来，再核对答案。每个方向独立安排。</p><Select label="训练方向" value={mode} onChange={setMode} description="选一个方向，给记忆一次有针对性的回响。" options={studyChoices.direction} /><button className="ww-button ww-primary ww-full" disabled={busy || !filtered.length} onClick={() => onPractice(filtered.slice(0, 30))}><RotateCcw size={18} />{filtered.length ? `开始复习 · ${Math.min(30, filtered.length)} 项` : '当前没有到期练习'}</button><div className="ww-mode-counts" role="group" aria-label="按训练方向筛选">{MODES.map(value => <button key={value} className={mode === value ? 'ww-selected' : ''} aria-pressed={mode === value} disabled={busy} onClick={() => setMode(value)}><span>{value === 'meaning' ? '认义' : value === 'recall' ? '回忆' : '语境'}</span><strong>{due.filter(item => item.mode === value).length}</strong></button>)}</div></section>
    {!state.settings.onboarded && <section className="ww-card ww-assessment"><span className="ww-eyebrow">找到学习起点</span><div className="ww-section-title"><h2>{assessmentFinished ? '五个词的自评已保存' : assessing ? '揭晓前，先想一想' : '用五个词，认识你的起点'}</h2><Sparkles size={20} /></div><p className="ww-muted">自评熟悉度，熟悉的词安排低频抽查。初测不计为测试通过。</p>{assessmentFinished ? <button className="ww-button ww-primary ww-full" disabled={busy} onClick={() => void finishAssessment()}>完成初测</button> : assessing && assessmentWord ? <div className="ww-assessment-content"><div className="ww-row"><strong className="ww-large-word">{assessmentWord.word}</strong><Speak text={assessmentWord.word} onSpeak={onSpeak} /><span className="ww-muted">{assessmentIndex + 1} / {assessment.length}</span></div>{revealed ? <><p className="ww-definition">{assessmentWord.pos} {assessmentWord.meaning}</p><div className="ww-row"><button className="ww-button ww-secondary" disabled={busy} onClick={() => void assess(false)}>还不熟悉</button><button className="ww-button ww-primary" disabled={busy} onClick={() => void assess(true)}>原本就知道</button></div></> : <button className="ww-button ww-secondary ww-full" onClick={() => setRevealed(true)}>揭晓词义</button>}<button className="ww-button ww-ghost ww-full" disabled={busy} onClick={() => void finishAssessment()}>结束初测，之后再学习</button></div> : <div className="ww-row"><button className="ww-button ww-secondary" disabled={busy || !assessment.length} onClick={() => { setAssessing(true); setAssessmentIndex(0); setAssessmentFinished(false); setRevealed(false); }}>开始初测</button><button className="ww-button ww-ghost" disabled={busy} onClick={() => void finishAssessment()}>跳过初测</button></div>}{error && <p className="ww-error" role="alert">{error}</p>}</section>}
    <div className="ww-shortcuts"><button onClick={onLibrary} disabled={busy}><span><Layers size={21} /></span><div><strong>我的词库</strong><small>搜索、联想与新词学习</small></div><ChevronRight size={18} /></button><button onClick={onStats} disabled={busy}><span><Target size={21} /></span><div><strong>学习记录</strong><small>看看回想留下的足迹</small></div><ChevronRight size={18} /></button></div>
    <SevenDays state={state} now={now} /><section className="ww-card"><div className="ww-section-title"><h2>最近的回想</h2><button className="ww-button ww-ghost" onClick={onStats}>全部<ChevronRight size={15} /></button></div><History state={state} /></section>
    <p className="ww-page-note">不必一次记住所有。每一次相遇，都在加深印象。</p>
  </div>;
}

export function ReadingView({ state, dispatch, busy, onSpeak, onPractice, onWord }: StudyProps & { onWord: (word: Word) => void }) {
  const cache = useStudyCache();
  const passages = useMemo(() => coursePassages(state), [state.settings.level]);
  const [id, setId] = useState(() => nextReading(state)?.id ?? '');
  const [directory, setDirectory] = useState(false);
  const [directoryFilter, setDirectoryFilter] = useState('all');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const words = cache.index(state).byId;
  const summary = cache.summary(state);
  const passage = passages.find(item => item.id === id) ?? passages.find(item => !state.reading?.completed[item.id]) ?? passages[0];
  useEffect(() => {
    const index = passages.findIndex(item => item.id === passage?.id);
    return warmWhenIdle(passages.slice(index + 1, index + 3).map(item => () => { cache.parts(item.text); }));
  }, [cache, passages, passage?.id]);
  const completed = !!passage && !!state.reading?.completed[passage.id];
  const doneCount = passages.filter(item => state.reading?.completed[item.id]).length;
  const locked = busy || working;
  const currentLevel = useRef(state.settings.level);
  useEffect(() => {
    if (currentLevel.current !== state.settings.level) {
      currentLevel.current = state.settings.level;
      setId(nextReading(state)?.id ?? ''); setError('');
    }
  }, [state]);
  function next() {
    if (!passage) return;
    const start = passages.findIndex(item => item.id === passage.id) + 1;
    const ordered = [...passages.slice(start), ...passages.slice(0, start)];
    const following = ordered.find(item => item.id !== passage.id && !state.reading?.completed[item.id]) ?? ordered.find(item => item.id !== passage.id) ?? passage;
    setId(following.id);
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  async function complete(advance = false) {
    if (!passage || locked || saving.current) return;
    if (completed) { if (advance) next(); return; }
    saving.current = true; setWorking(true); setError('');
    try {
      if (await dispatch({ type: 'reading-complete', passage, passageId: passage.id })) { if (advance) next(); }
      else setError('阅读进度未保存，请重试。当前段落仍保留。');
    } finally { saving.current = false; setWorking(false); }
  }
  const targetWords = passage?.wordIds.flatMap(wordId => words.get(wordId) ? [words.get(wordId)!] : []) ?? [];
  const visiblePassages = passages.filter(item => directoryFilter === 'all' || (directoryFilter === 'unread' ? !state.reading?.completed[item.id] : !!state.reading?.completed[item.id]));
  return <div className="ww-page ww-reading">
    <Heading eyebrow="READ & DISCOVER" title="在句子中学单词"><button className="ww-icon-button ww-bordered" onClick={() => setDirectory(true)} aria-label="打开阅读目录"><List size={22} /></button></Heading>
    <div className="ww-reading-options"><div className="ww-segments" role="group" aria-label="阅读词表">{(['CET4', 'CET6'] as const).map(level => <button key={level} aria-pressed={state.settings.level === level} className={state.settings.level === level ? 'ww-active' : ''} disabled={locked} onClick={() => void dispatch({ type: 'settings', settings: { level } })}>{levelName(level)}阅读</button>)}</div><Select label="词义提示" value={state.settings.gloss} description="按你的阅读习惯，决定何时看到中文提示。" options={studyChoices.gloss} disabled={locked} onChange={gloss => void dispatch({ type: 'settings', settings: { gloss } })} /></div>
    <div className="ww-reading-summary"><span><strong>{doneCount}</strong> / {passages.length} 篇已读</span><span><strong>{summary.covered.toLocaleString()}</strong> 个词条已接触</span></div>
    {state.settings.level === 'CET4' && <p className="ww-small ww-content-note">当前四级含 {summary.total} 个带标签义项、{passages.length} 篇辅助段落，内容仍在补充。</p>}
    {error && <p className="ww-error" role="alert">{error}</p>}
    {passage ? <>
      <article className="ww-reading-paper" key={passage.id}>
        <div className="ww-reading-paper-top"><span className="ww-eyebrow">STORY {String(passages.findIndex(item => item.id === passage.id) + 1).padStart(2, '0')}</span><span className={`ww-tag ${completed ? 'ww-tag-done' : ''}`}>{completed ? <><Check size={12} />已读 · 可重读</> : `${passage.wordIds.length} 个目标词`}</span></div>
        <h2>{passage.title}</h2><div className="ww-reading-rule" /><div className="ww-story">{cache.parts(passage.text).map((part, index) => {
          if (part.type === 'text') return <span key={index}>{part.text}</span>;
          const word = words.get(part.id);
          return word ? <span key={index}><button className="ww-word-link" onClick={() => onWord(word)} aria-label={`查看 ${word.word} 的释义`}>{word.word}</button>{state.settings.gloss === 'direct' && <span className="ww-inline-gloss">（{word.meaning}）</span>}</span> : <span key={index}>〔词条暂不可用〕</span>;
        })}</div><p className="ww-reading-footnote"><CircleHelp size={14} />中英混合记忆辅助段落 · 点击英文词查看详情</p>
      </article>
      <div className="ww-reading-finish"><button className="ww-button ww-primary ww-full" disabled={locked} onClick={() => void complete(true)}>{working ? '正在保存…' : completed ? '继续下一段' : '读完，继续下一段'}<ArrowRight size={18} /></button><button className="ww-button ww-ghost ww-full" disabled={locked || completed} onClick={() => void complete()}><CheckCheck size={17} />{completed ? '这一篇的阅读进度已保存' : '只保存阅读进度'}</button><p className="ww-small">阅读记为接触，主动回想才会产生练习成绩。</p></div>
      <section className="ww-card"><div className="ww-section-title"><h2>这一篇遇见的词</h2><button className="ww-button ww-ghost" disabled={locked || !targetWords.length} onClick={() => onPractice(targetWords.map(word => ({ word, mode: 'meaning' })), true)}>浏览<ArrowRight size={15} /></button></div><div className="ww-target-words">{targetWords.map(word => <button key={word.id} onClick={() => onWord(word)}><strong>{word.word}</strong><span>{word.meaning}</span></button>)}</div></section>
    </> : <Empty title="这个词表暂无阅读内容">可以切换词表，或在词库中开始卡片学习。</Empty>}
    <button className="ww-directory-button" onClick={() => setDirectory(true)}><List size={19} /><span>查看全部阅读目录</span><ChevronRight size={18} /></button>
    <Presence show={directory} portal><Modal title="阅读目录" onClose={() => setDirectory(false)} wide><h2 className="ww-sheet-title">每一篇，都可以再相遇</h2><p className="ww-muted">{levelName(state.settings.level)}辅助阅读 · {doneCount} / {passages.length} 篇已读</p><div className="ww-segments ww-directory-filters" role="group" aria-label="按阅读状态筛选">{[['all', '全部'], ['unread', '未读'], ['read', '已读']].map(([value, label]) => <button key={value} className={directoryFilter === value ? 'ww-active' : ''} aria-pressed={directoryFilter === value} onClick={() => setDirectoryFilter(value)}>{label}</button>)}</div><div className="ww-directory-list">{visiblePassages.map(item => <button className={item.id === passage?.id ? 'ww-current-passage' : ''} key={item.id} disabled={locked} onClick={() => { setId(item.id); setDirectory(false); setError(''); window.scrollTo({ top: 0 }); }}><span className="ww-directory-number">{String(passages.findIndex(p => p.id === item.id) + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.wordIds.length} 个目标词 · {state.reading?.completed[item.id] ? '已读 · 可以重读' : '尚未阅读'}</small></span>{state.reading?.completed[item.id] ? <Check size={18} /> : <ChevronRight size={18} />}</button>)}{!visiblePassages.length && <Empty title="这里暂时没有段落">试试其他筛选条件。</Empty>}</div></Modal></Presence>
  </div>;
}

const LibraryWords = memo(function LibraryWords({state, words, limit, onWord}: {state: State; words: Word[]; limit: number; onWord: (word: Word) => void}) {
  return <div className="ww-word-list">{words.slice(0, limit).map(word => {
      const familiar = state.familiar[word.id];
      const wrong = Object.values(state.progress[word.id] ?? {}).some(track => track.wrong > 0);
      return <button className="ww-word-card" key={word.id} onClick={() => onWord(word)}><div className="ww-word-card-top"><strong>{word.word}</strong><span className="ww-mini-tag">{word.tags.map(levelName).join(' / ')}</span></div><p><span>{word.pos}</span> {word.meaning}</p><div className="ww-word-card-bottom"><span className={familiar === 'familiar' ? 'ww-status-familiar' : ''}>{familiar === 'familiar' ? '自评熟悉 · 待抽查' : familiar === 'unknown' ? '陌生 · 已加入复习' : wrong ? '需要巩固' : state.learned[word.id] ? '已加入学习' : state.reading?.encounters[word.id] ? '已在阅读中接触' : '尚未学习'}</span><ChevronRight size={17} /></div></button>;
    })}</div>;
});

export function LibraryView({ state, busy, onPractice, onWord }: StudyProps & { onWord: (word: Word) => void }) {
  const cache = useStudyCache();
  const now = useClock();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<string>(state.settings.level);
  const [status, setStatus] = useState('all');
  const [limit, setLimit] = useState(30);
  const learningLevel = useRef(state.settings.level);
  useEffect(() => {
    if(learningLevel.current===state.settings.level)return;
    learningLevel.current=state.settings.level;
    setLevel(state.settings.level); setLimit(30);
  }, [state.settings.level]);
  const words = cache.index(state).words;
  const query = useDeferredValue(search.trim().toLowerCase());
  const filtered = cache.search(state, query, level, status);
  const start = dayStart(now);
  const remaining = useMemo(() => Math.max(0, state.settings.daily - Object.values(state.learned).filter(time => time >= start && time < start + DAY).length), [state.settings.daily, state.learned, start]);
  const fresh = useMemo(() => {
    const result: Word[] = [], count = Math.min(10, remaining);
    for (const word of filtered) {
      if (result.length >= count) break;
      if (!state.learned[word.id] && state.familiar[word.id] !== 'familiar') result.push(word);
    }
    return result;
  }, [filtered, state.learned, state.familiar, remaining]);
  function changeFilter(setter: (value: string) => void, value: string) { setter(value); setLimit(30); }
  return <div className="ww-page ww-library">
    <Heading eyebrow="YOUR WORD COLLECTION" title="我的词库"><span className="ww-tag">{words.length.toLocaleString()} 义项</span></Heading><p className="ww-intro">查找一个词，留下属于你的联想。</p>
    <label className="ww-search"><Search size={20} /><input type="search" aria-label="搜索英文单词或中文释义" placeholder="搜索单词或中文释义" value={search} onChange={event => changeFilter(setSearch, event.target.value)} />{search && <button className="ww-icon-button" aria-label="清空搜索" onClick={() => changeFilter(setSearch, '')}><X size={18} /></button>}</label>
    <div className="ww-library-filters"><Select label="词表" value={level} onChange={value => changeFilter(setLevel, value)} description="筛选这里显示的词条，不改变学习词表设置。" options={studyChoices.level} /><Select label="熟悉程度" value={status} onChange={value => changeFilter(setStatus, value)} description="按自己的熟悉程度查看词条，不改变复习安排。" options={studyChoices.filterFamiliar} /></div>
    <section className="ww-library-actions"><div className="ww-row"><button className="ww-button ww-primary" disabled={busy || !fresh.length} onClick={() => onPractice(fresh.flatMap(word => availableModes(word).map(mode => ({ word, mode }))))}><Sparkles size={17} />{remaining ? `学习 ${fresh.length} 个新词` : '今日新词额度完成'}</button><button className="ww-button ww-secondary" disabled={busy || !filtered.length} onClick={() => onPractice(filtered.map(word => ({ word, mode: 'meaning' })), true)}><BookOpen size={17} />快速浏览</button></div><p className="ww-small">今日可学 {remaining} 个新词 · 浏览和到期复习不占额度</p></section>
    <div className="ww-section-title ww-list-heading"><span className="ww-muted">{filtered.length.toLocaleString()} 个匹配义项</span><span className="ww-small">重叠标签合并显示</span></div>
    <LibraryWords state={state} words={filtered} limit={limit} onWord={onWord} />
    {!filtered.length && <Empty title="没有找到这个词">换一个关键词，或切换词表与熟悉程度。</Empty>}
    {filtered.length > limit && <button className="ww-button ww-secondary ww-full ww-load-more" onClick={() => setLimit(value => value + 30)}>再显示 30 个<ArrowDown size={16} /></button>}
    <p className="ww-page-note">需要补充自己的词表？前往「我的」导入 JSON 词表。</p>
  </div>;
}

function Browse({ items, onDone, onSpeak }: { items: QueueItem[]; onDone: () => void; onSpeak: (text: string) => void }) {
  const words = useMemo(() => [...new Map(items.map(item => [item.word.id, item.word])).values()], [items]);
  const [index, setIndex] = useState(0);
  const word = words[index];
  if (!word) return <div className="ww-page ww-session"><section className="ww-card ww-session-complete"><div className="ww-complete-icon"><BookOpen size={34} /></div><span className="ww-eyebrow">BROWSING COMPLETE</span><h1>这一轮浏览完成了。</h1><p className="ww-muted">看过 {words.length} 个词条。浏览不会记为测试通过，也不更改复习计划。</p><button className="ww-button ww-primary ww-full" onClick={onDone}>回到今日任务</button><button className="ww-button ww-ghost ww-full" disabled={!words.length} onClick={() => setIndex(0)}><RotateCcw size={17} />再看一遍</button></section></div>;
  return <div className="ww-page ww-session"><div className="ww-session-top"><span><BookOpen size={18} />快速浏览</span><button className="ww-button ww-ghost" onClick={onDone}>结束浏览</button></div><div className="ww-session-progress"><Meter value={(index + 1) / words.length * 100} label="本轮浏览进度" /><span>{index + 1} / {words.length}</span></div><section className="ww-card ww-browse-card" key={word.id}><div className="ww-row">{word.tags.map(tag => <span className="ww-tag" key={tag}>{levelName(tag)}</span>)}</div><div className="ww-browse-word"><h1>{word.word}</h1><Speak text={word.word} onSpeak={onSpeak} /></div>{word.phonetic && <p className="ww-phonetic">/{word.phonetic}/</p>}<p className="ww-browse-meaning"><span>{word.pos}</span>{word.meaning}</p>{word.example ? <div className="ww-example"><div className="ww-row"><p className="ww-english">{word.example}</p><Speak text={word.example} onSpeak={onSpeak} /></div><p>{word.translation}</p>{word.collocation && <p className="ww-collocation">常用搭配 · {word.collocation}</p>}</div> : <p className="ww-notice">基础词条 · 独立英文例句尚待补充。</p>}<div className="ww-browse-directions">{[...new Set(items.filter(item => item.word.id === word.id).map(item => item.mode))].map(mode => <span className="ww-mini-tag" key={mode}>{modeNames[mode]}</span>)}</div></section><div className="ww-browse-navigation"><button className="ww-button ww-secondary" disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ChevronLeft size={18} />上一个</button><button className="ww-button ww-primary" onClick={() => setIndex(value => value + 1)}>{index === words.length - 1 ? '完成浏览' : '下一个'}<ChevronRight size={18} /></button></div><p className="ww-page-note">仅浏览 · 不记分 · 不消耗新词额度</p></div>;
}

export function ReviewView({ items, state, dispatch, busy, onSpeak, onDone, browse = false }: Omit<StudyProps, 'onPractice'> & {
  items: QueueItem[]; browse?: boolean; onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [peeked, setPeeked] = useState(false);
  const [hint, setHint] = useState(false);
  const [browsing, setBrowsing] = useState(browse);
  const [failed, setFailed] = useState(false);
  const [score, setScore] = useState({ correct: 0, hinted: 0, wrong: 0, skipped: 0 });
  const saving = useRef(false);
  const queued = items[index];
  const cache = useStudyCache();
  const canonicalWord = queued && cache.resolve(state, queued.word);
  const current = queued && { ...queued, word: canonicalWord ?? queued.word };
  function next() { setIndex(value => value + 1); setAnswer(''); setRevealed(false); setPeeked(false); setHint(false); setFailed(false); }
  function skip() { if (busy || saving.current || failed) return; setScore(value => ({ ...value, skipped: value.skipped + 1 })); next(); }
  async function submit(outcome: 'correct' | 'wrong') {
    if (!current || busy || saving.current || peeked || !answer.trim()) return;
    saving.current = true; setFailed(false);
    const actual = outcome === 'correct' && hint ? 'hinted' : outcome;
    try {
      if (await dispatch({ type: 'result', wordId: current.word.id, mode: current.mode, outcome: actual, answer })) {
        setScore(value => ({ ...value, [actual]: value[actual] + 1 })); next();
      } else setFailed(true);
    } finally { saving.current = false; }
  }
  if (browsing) return <Browse items={items.slice(index)} onDone={onDone} onSpeak={onSpeak} />;
  if (!current) return <div className="ww-page ww-session"><section className="ww-card ww-session-complete"><div className="ww-complete-icon"><CheckCheck size={35} /></div><span className="ww-eyebrow">SESSION COMPLETE</span><h1>今天的回想，<br />又积累了一点。</h1><div className="ww-score-grid">{[[score.correct, '独立完成'], [score.hinted, '借助提示'], [score.wrong, '需要重温'], [score.skipped, '跳过 / 看答案']].map(([count, label]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div><p className="ww-muted">已提交的练习已经保存，并安排了下次复习。</p><button className="ww-button ww-primary ww-full" onClick={onDone}>回到今日任务<ArrowRight size={18} /></button></section></div>;
  const { word, mode } = current;
  if (!canonicalWord || !availableModes(word).includes(mode)) return <div className="ww-page ww-session"><section className="ww-card"><h2>这个练习的材料已更新</h2><p className="ww-muted">词条可能已被其他设备合并或从恢复后的档案移除。可以跳过这一项，新的词库会保留有效义项。</p><button className="ww-button ww-primary ww-full" disabled={busy || failed} onClick={skip}>跳过，不记分<SkipForward size={17} /></button><button className="ww-button ww-ghost ww-full" disabled={busy} onClick={onDone}>返回今日任务</button></section></div>;
  const last = state.progress[word.id]?.[mode]?.last;
  return <div className="ww-page ww-session"><div className="ww-session-top"><span><RotateCcw size={18} />专注回想</span><button className="ww-button ww-ghost" disabled={busy} onClick={onDone}>结束本轮</button></div><div className="ww-session-progress"><Meter value={index / items.length * 100} label="本轮练习进度" /><span>{index + 1} / {items.length}</span></div><section className="ww-card ww-review-card"><span className="ww-tag">{modeNames[mode]}</span><div className="ww-question" key={`${word.id}-${mode}-${index}`}>{mode === 'recall' ? <><h1 className="ww-recall-prompt">{word.meaning}</h1><p>{word.pos} · 试着写出本轮目标词。</p></> : mode === 'meaning' ? <><div className="ww-question-word"><h1>{word.word}</h1><Speak text={word.word} onSpeak={onSpeak} /></div><p>试着写出这个词本轮所学的中文义项。</p></> : <><p className="ww-english ww-context-question">{word.test}</p><p>在这个语境中，<strong>{word.word}</strong> 是什么意思？</p></>}</div>
      {!peeked && <label className="ww-field" htmlFor="ww-review-answer"><span>你的答案</span><textarea id="ww-review-answer" value={answer} onChange={event => setAnswer(event.target.value)} disabled={revealed || busy} autoComplete="off" spellCheck={false} maxLength={1000} rows={3} placeholder={mode === 'recall' ? '先尝试写出英文单词…' : '用中文写下你的理解…'} /></label>}
      {!revealed && <><button className="ww-button ww-primary ww-full" disabled={busy || !answer.trim()} onClick={() => setRevealed(true)}>核对答案<ArrowRight size={18} /></button><div className="ww-review-tools"><button className="ww-button ww-ghost" disabled={busy || hint} onClick={() => setHint(true)}><Sparkles size={16} />一点提示</button><button className="ww-button ww-ghost" disabled={busy} onClick={() => { setPeeked(true); setRevealed(true); }}><Eye size={16} />直接看答案</button></div></>}
      {hint && !revealed && <p className="ww-hint" role="status">{mode === 'recall' ? `首字母 ${word.word[0]}，共 ${word.word.length} 个字符。` : `词义线索：${word.meaning.slice(0, 1)}……`}<br />使用提示后，答对记为“借助提示”。</p>}
      {revealed && <div className="ww-feedback" aria-live="polite"><span className="ww-eyebrow">核对答案</span><h2>{word.word}<span>{word.pos}</span></h2><p className="ww-definition">{word.meaning}</p>{mode === 'context' && <p>{word.testTranslation}</p>}{word.example && <div className="ww-example"><div className="ww-row"><p className="ww-english">{word.example}</p><Speak text={word.example} onSpeak={onSpeak} /></div><p>{word.translation}</p></div>}{!peeked && <>{mode === 'recall' && answer.trim().toLowerCase() !== word.word.toLowerCase() && <p className="ww-notice">拼写与本轮目标词不同。请检查是否想起了 <strong>{word.word}</strong>。</p>}<p className="ww-small">请按揭晓前的回答判断；看完才想起来，选择“需要重温”。</p><div className="ww-self-assess"><button className="ww-button ww-secondary" disabled={busy} onClick={() => void submit('wrong')}><RotateCcw size={16} />需要重温</button><button className="ww-button ww-primary" disabled={busy || !answer.trim()} onClick={() => void submit('correct')}><Check size={17} />{hint ? '提示后答对' : '独立答对'}</button></div></>}</div>}
      {failed && <p className="ww-error" role="alert">保存未完成，你的答案已保留。请再次选择结果以重试。</p>}
    </section><button className={`ww-button ${peeked ? 'ww-primary' : 'ww-ghost'} ww-full ww-session-skip`} disabled={busy || failed} onClick={skip}><SkipForward size={17} />{peeked ? '下一个，不记分' : '跳过这题'}</button><p className="ww-small ww-session-note">跳过或直接看答案，不改变复习时间。<br />{last ? `上次练习：${dateText(last)}` : '这个方向尚未完成练习。'}</p><button className="ww-button ww-ghost ww-full" disabled={busy || failed} onClick={() => setBrowsing(true)}><BookOpen size={16} />改为浏览剩余词</button></div>;
}

export function WordSheet({ word: requestedWord, onClose, state, dispatch, busy, onSpeak, onPractice }: StudyProps & {
  word: Word; onClose: () => void;
}) {
  const canonicalWord = useStudyCache().resolve(state, requestedWord);
  const word = canonicalWord ?? requestedWord;
  const semanticKey = `${word.word.toLowerCase()}|${word.pos}|${word.meaning}`;
  const [note, setNote] = useState(state.notes[word.id] ?? word.mnemonic ?? '');
  const [baseNote, setBaseNote] = useState(state.notes[word.id] ?? '');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const saving = useRef(false);
  const modes = availableModes(word);
  const encounters = state.reading?.encounters[word.id];
  // Preserve the draft and the version it was based on during foreground sync
  // and canonical ID remapping. A fresh semantic entry starts a new draft.
  useEffect(() => { setNote(state.notes[word.id] ?? word.mnemonic ?? ''); setBaseNote(state.notes[word.id] ?? ''); setStatus(''); }, [semanticKey]);
  async function saveNote() {
    if (busy || saving.current) return;
    saving.current = true; setStatus('正在保存…');
    try {
      const ok = await dispatch({ type: 'note', wordId: word.id, note, baseNote });
      if (ok) setBaseNote(note);
      setError(!ok); setStatus(ok ? '联想已保存。' : '保存失败，输入仍保留，请重试。');
    } finally { saving.current = false; }
  }
  async function changeFamiliar(value: string) {
    if (busy || saving.current) return;
    saving.current = true;
    try {
      const ok = await dispatch({ type: 'familiar', wordId: word.id, value });
      if (!ok) { setError(true); setStatus('熟悉程度保存失败，请重试。'); }
    } finally { saving.current = false; }
  }
  if (!canonicalWord) return <Modal title="词条已更新" onClose={onClose}><h2>这个义项已从当前档案移除</h2><p className="ww-muted">已写下的联想仍显示在下方，可复制保存。返回词库后查看新的有效词条。</p><label className="ww-field"><span>保留的联想草稿</span><textarea readOnly value={note} rows={4} /></label><button className="ww-button ww-primary ww-full" onClick={onClose}>返回词库</button></Modal>;
  return <Modal title="词条详情" onClose={onClose}><div className="ww-word-detail"><div className="ww-detail-title"><h1>{word.word}</h1><Speak text={word.word} onSpeak={onSpeak} /></div>{word.phonetic && <p className="ww-phonetic">/{word.phonetic}/</p>}<p className="ww-detail-meaning"><span>{word.pos}</span>{word.meaning}</p><div className="ww-row">{word.tags.map(tag => <span className="ww-tag" key={tag}>{levelName(tag)}</span>)}<span className="ww-small">{word.example && word.test ? '完整语境材料' : '基础词条'}{encounters ? ` · 阅读接触 ${encounters.count} 次` : ''}</span></div><div className="ww-detail-practice"><button className="ww-button ww-primary ww-full" disabled={busy} onClick={() => onPractice(modes.map(mode => ({ word, mode })))}>开始回想练习<ArrowRight size={18} /></button><div className="ww-mode-links">{modes.map(mode => <button key={mode} className="ww-button ww-ghost" disabled={busy} onClick={() => onPractice([{ word, mode }])}>{modeNames[mode]}</button>)}</div></div>
      {word.example ? <section className="ww-detail-section"><h2>在英文中遇见</h2><div className="ww-example"><div className="ww-row"><p className="ww-english">{word.example}</p><Speak text={word.example} onSpeak={onSpeak} /></div><p>{word.translation}</p>{word.collocation && <p className="ww-collocation">常用搭配 · {word.collocation}</p>}</div></section> : <p className="ww-notice">基础词条提供英文认义与中文回忆；独立英文例句仍在补充。</p>}
      <section className="ww-detail-section"><div className="ww-section-title"><h2>我的联想</h2><NotebookPen size={18} /></div><label className="ww-field" htmlFor="ww-personal-note"><span className="ww-sr-only">这个词的个人联想</span><textarea id="ww-personal-note" value={note} rows={4} maxLength={1000} disabled={busy} placeholder="记录让你记住它的画面、故事或联系…" onChange={event => { setNote(event.target.value); setStatus(''); }} /></label><div className="ww-row ww-note-save"><span className="ww-small">{note.length} / 1000</span><button className="ww-button ww-secondary" disabled={busy || note === (state.notes[word.id] ?? word.mnemonic ?? '')} onClick={() => void saveNote()}>{busy ? '保存中…' : '保存联想'}</button></div></section>
      <section className="ww-detail-section"><h2>自己的熟悉程度</h2><Select label="熟悉程度" value={state.familiar[word.id] ?? 'learning'} onChange={value => void changeFamiliar(value)} disabled={busy} description="记录自己的感觉；真正掌握还需要间隔后的独立测试。" options={studyChoices.wordFamiliar} /><p className="ww-small">“陌生”会安排回想，“熟悉”仍需要间隔后的独立测试。</p>{status && <p className={error ? 'ww-error' : 'ww-save-status'} role={error ? 'alert' : 'status'}>{status}</p>}</section>
      <section className="ww-detail-section"><h2>每个方向的进度</h2><div className="ww-word-tracks">{modes.map(mode => { const track = state.progress[word.id]?.[mode]; return <div key={mode}><span>{modeNames[mode]}</span><strong>{track?.attempts ? `${track.correct} 次独立答对` : '尚未独立测试'}</strong><small><Clock3 size={12} />{track ? `下次 ${dateText(track.due)}` : '练习后安排复习'}</small></div>; })}</div></section>
      <details className="ww-source"><summary>词条来源与材料说明</summary><p>{word.source} · 版本 {word.version.slice(0, 16)}</p>{word.sourceUrl && <p><a href={word.sourceUrl} target="_blank" rel="noreferrer">查看原始来源<ArrowRight size={13} /></a></p>}{word.references?.filter(reference => reference.url !== word.sourceUrl).map(reference => <p key={`${reference.source}-${reference.url}`}><a href={reference.url} target="_blank" rel="noreferrer">{reference.source}</a> · {reference.version.slice(0, 16)}</p>)}<p>{seedWords.some(item => item.id === word.id) ? '内置义项已编入记忆辅助阅读。' : '导入词条暂未编入阅读段落。'}词表标签来自整理材料，已提供的阅读、例句与联想为本站编写。</p></details>
    </div></Modal>;
}

export function StatisticsView({ state }: { state: State }) {
  const now = useClock();
  const [historyLimit, setHistoryLimit] = useState(20);
  const cache = useStudyCache();
  const wordMap = cache.index(state).byId;
  const {events, delayed, hinted, rates, wrong} = cache.stats(state);
  const summary = cache.summary(state);
  const passages = useMemo(() => coursePassages(state), [state.settings.level]);
  const readingHistory = useMemo(() => passages.filter(passage => state.reading?.completed[passage.id]).sort((a, b) => state.reading!.completed[b.id] - state.reading!.completed[a.id]), [passages, state.reading?.completed]);
  const percent = Math.round(summary.covered / Math.max(1, summary.total) * 100);
  return <div className="ww-page ww-statistics"><Heading eyebrow="SMALL STEPS, REAL PROGRESS" title="学习留下的足迹"><span className="ww-tag">{levelName(state.settings.level)}词表</span></Heading><section className="ww-card ww-stat-summary"><div className="ww-section-title"><h2>回想的积累</h2><Target size={21} /></div><div className="ww-stat-summary-counts"><div><strong>{events.length.toLocaleString()}</strong><span>总练习</span></div><div><strong>{delayed.length.toLocaleString()}</strong><span>延后测试</span></div><div><strong>{hinted.toLocaleString()}</strong><span>提示完成</span></div></div></section>
    <section className="ww-card"><h2>延后独立答对率</h2><p className="ww-muted">同方向间隔至少一天的测试，才计入这里。</p><div className="ww-rate-list">{rates.map(({ mode, total, correct }) => <div key={mode}><div className="ww-row"><span>{modeNames[mode]}</span><strong>{total ? `${Math.round(correct / total * 100)}%` : '—'}</strong></div><Meter value={total ? correct / total * 100 : 0} label={`${modeNames[mode]}延后独立答对率`} /><small>{total ? `${correct} / ${total} 次延后测试独立答对` : '积累延后测试后显示'}</small></div>)}</div><p className="ww-small">阅读、自评熟悉、初测与浏览都不计为测试答对。</p></section>
    <SevenDays state={state} now={now} />
    <section className="ww-card"><div className="ww-section-title"><h2>值得再看一眼</h2><RotateCcw size={19} /></div>{wrong.length ? <div className="ww-frequent-wrong">{wrong.map(([id, count]) => <div key={id}><div><strong>{wordMap.get(id)?.word}</strong><span>{wordMap.get(id)?.meaning}</span></div><small>{count} 次重温</small></div>)}</div> : <Empty title="还没有重温记录">完成回想后，常错义项会出现在这里。</Empty>}</section>
    <section className="ww-card"><div className="ww-section-title"><h2>语境中的相遇</h2><BookOpen size={20} /></div><div className="ww-coverage-number"><strong>{summary.covered.toLocaleString()}</strong><span>/ {summary.total.toLocaleString()} 个词条</span><span className="ww-tag">{percent}%</span></div><Meter value={percent} label="阅读词汇覆盖" /><p className="ww-small">已读 {readingHistory.length} / {passages.length} 篇 · 阅读覆盖只表示接触。</p>{readingHistory.length ? <div className="ww-reading-history">{readingHistory.slice(0, 10).map(passage => <div key={passage.id}><Check size={15} /><span>{passage.title}</span><time>{dateText(state.reading!.completed[passage.id])}</time></div>)}</div> : <p className="ww-muted">读完一篇后，这里会留下阅读足迹。</p>}{readingHistory.length > 10 && <p className="ww-small">显示最近 10 篇，全部段落可从阅读目录重读。</p>}</section>
    <section className="ww-card"><div className="ww-section-title"><h2>最近的回忆</h2><span className="ww-muted">{events.length} 次记录</span></div><History state={state} limit={historyLimit} />{events.length > historyLimit && <button className="ww-button ww-ghost ww-full" onClick={() => setHistoryLimit(limit => limit + 20)}>再看 20 次记录<ArrowDown size={16} /></button>}</section><p className="ww-page-note">每个训练方向分别记录 · 日期以北京时间显示</p>
  </div>;
}
