"use client";
import { useMemo, useState } from 'react';
import { BookOpen, RotateCcw, Layers, BarChart3, Check, Sparkles, CalendarDays } from 'lucide-react';
import { allWords, dueItems, chinaDay, MODES, modeNames, DAY, availableModes, type State } from '@/lib/learning';
import { readingSummary } from '@/lib/reading';
import { Choice, dateText, useLearningClock } from './ui';
import type { AppProps, QueueItem } from './types';

export function ReviewPlan({ state, compact = false }: { state: State; compact?: boolean }) {
  const now = useLearningClock();
  const tracks = useMemo(() => allWords(state).filter(w => w.tags.includes(state.settings.level)).flatMap(w => availableModes(w).flatMap(mode => state.progress[w.id]?.[mode] ? [state.progress[w.id][mode]!] : [])), [state]);
  const today = chinaDay(now);
  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const track of tracks) { const day = chinaDay(track.due); counts.set(day, (counts.get(day) ?? 0) + 1); }
    const start = Date.parse(today + 'T00:00:00+08:00');
    return Array.from({ length: 7 }, (_, i) => { const day = chinaDay(start + i * DAY); return { day, count: counts.get(day) ?? 0 }; });
  }, [tracks, today]);
  return <section className={compact ? 'overview-section' : 'paper-card'}><div className="section-label"><h2>{compact ? '未来七天' : '接下来七天的复习安排'}</h2><span className="mini-tag">计划</span></div><div className="burden-chart" aria-label="未来七天计划到期练习数，不含此前逾期项目">{days.map((day, index) => <div key={day.day}><strong>{day.count}</strong><div className="bar-track"><span style={{ height: `${day.count ? Math.max(5, day.count / Math.max(1, ...days.map(d => d.count)) * 100) : 0}%` }}/></div><span>{index === 0 ? '今天' : day.day.slice(5).replace('-', '/')}</span></div>)}</div><p className="muted">{!compact&&`当前到期 ${dueItems(state, now).length} 项练习 · `}按北京时间排程 · 此前逾期项目计入待复习。</p></section>;
}

export function RecentPractice({ state, limit = 5 }: { state: State; limit?: number }) {
  const words = allWords(state);
  const ids = new Set(words.filter(w => w.tags.includes(state.settings.level)).map(w => w.id));
  const events = state.events.filter(e => ids.has(e.wordId)).slice(-limit).reverse();
  return events.length ? <div className="history-list">{events.map(event => <div className="history-row" key={event.id}><strong>{words.find(w => w.id === event.wordId)?.word}</strong><span>{modeNames[event.mode]}</span><span className={`outcome ${event.outcome}`}>{event.outcome === 'correct' ? '独立答对' : event.outcome === 'hinted' ? '借助提示' : '需要重温'}</span><time>{dateText(event.at)}</time></div>)}</div> : <div className="empty-state"><span className="empty-icon"><BookOpen size={23}/></span><h3>每一次回想，都会留下足迹</h3><p>完成练习后，这里会显示训练方向、结果与时间。</p></div>;
}

export function Today({ state, save, busy, onLearn, onLibrary, onReview, onStats, username }: AppProps & { onLearn: () => void; onLibrary: () => void; onReview: (items: QueueItem[], browse?: boolean) => void; onStats: () => void; username: string }) {
  const now = useLearningClock();
  const [assessing, setAssessing] = useState(false);
  const [index, setIndex] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [mode, setMode] = useState('all');
  const words = useMemo(() => allWords(state).filter(w => w.tags.includes(state.settings.level)), [state]);
  const due = useMemo(() => dueItems(state, now), [state, now]);
  const reading = useMemo(() => readingSummary(state), [state]);
  const today = chinaDay(now);
  const doneToday = useMemo(() => Object.values(state.reading?.completed ?? {}).filter(t => chinaDay(t) === today).length, [state.reading, today]);
  const reviewed = useMemo(() => state.events.filter(e => chinaDay(e.at) === today).length, [state.events, today]);
  const assessment = words.filter((_, i) => i % Math.max(1, Math.floor(words.length / 5)) === 0).slice(0, 5);
  const word = assessment[index];
  const filtered = due.filter(item => mode === 'all' || item.mode === mode);
  const percent = Math.round(reading.covered / Math.max(1, reading.total) * 100);
  const hour = new Date(now).getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  async function assessed(familiar: boolean) {
    if (await save({ type: 'familiar', wordId: word.id, value: familiar ? 'familiar' : 'unknown' })) {
      if (index === assessment.length - 1) { if (await save({ type: 'settings', settings: { onboarded: true } })) setAssessing(false); }
      else { setIndex(i => i + 1); setReveal(false); }
    }
  }
  const cards = [
    { title: '句子学习', en: 'Reading', icon: BookOpen, color: 'blue', info: `已接触 ${reading.covered.toLocaleString()} 个词条`, action: onLearn },
    { title: '到期复习', en: 'Review', icon: RotateCcw, color: 'purple', info: due.length ? `${due.length} 项练习等待回想` : '当前没有到期练习', action: () => onReview(due.slice(0, 30)), disabled: !due.length },
    { title: '我的词库', en: 'Vocabulary', icon: Layers, color: 'teal', info: `${words.length.toLocaleString()} 个词条 · 搜索与个人联想`, action: onLibrary },
    { title: '学习记录', en: 'Insights', icon: BarChart3, color: 'amber', info: '看看每一次回想的积累', action: onStats },
  ];
  return <div className="home-layout"><div className="home-main">
    <section className="welcome-card"><div className="welcome-top"><span className="eyebrow">A LITTLE EVERY DAY</span><span className="welcome-tag">{state.settings.level === 'CET6' ? '大学英语六级' : '大学英语四级'}</span></div><h2>{greeting}，{username || '学习者'}<span className="greeting-dot">。</span></h2><p>今天也读一段，让单词慢慢熟悉起来。</p><div className="welcome-actions"><button className="primary" disabled={busy} onClick={onLearn}><BookOpen size={18}/>{reading.covered ? '继续读句子' : '开始读句子'}</button><span>在句子中学单词</span></div><div className="welcome-progress"><div><span>内置词表 · 阅读覆盖</span><strong>{percent}%</strong></div><div className="progress-track" role="progressbar" aria-label="内置词表阅读覆盖" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }}/></div><small>{reading.covered.toLocaleString()} / {reading.total.toLocaleString()} 个词条已在语境中接触 · 不代表已掌握</small></div></section>
    <section className="feature-grid" aria-label="学习入口">{cards.map(({ title, en, icon: Icon, color, info, action, disabled }) => <button key={en} className={`feature-card ${color}`} aria-label={`${title} · ${en} · ${info}`} disabled={busy || disabled} onClick={action} title={disabled ? '当前没有到期练习，阅读或词库学习后可安排复习' : title}><span className="feature-icon"><Icon size={22}/></span><h3>{title}<small>{en}</small></h3><p>{info}</p></button>)}</section>
    <section className="paper-card agenda-panel"><div className="section-label"><h2>今日学习安排</h2><span>按自己的节奏</span></div><article className="agenda-item"><span className="agenda-icon blue"><BookOpen size={20}/></span><div className="agenda-copy"><h3>读一段，走进新的语境</h3><p>优先继续未读段落，也可以重读熟悉的故事。</p></div><button className="secondary" disabled={busy} onClick={onLearn}>继续阅读</button></article><article className="agenda-item"><span className="agenda-icon purple"><RotateCcw size={20}/></span><div className="agenda-copy"><h3>给记忆一次回响</h3><p>{filtered.length ? `${filtered.length} 项到期练习，本轮最多 30 项。` : '这个方向暂无到期练习，可以先读一段。'}</p></div><button className="secondary" disabled={busy || !filtered.length} onClick={() => onReview(filtered.slice(0, 30))}>开始复习</button></article><div className="agenda-options"><Choice label="复习方向" value={mode} onChange={setMode} options={ [['all', '全部方向'], ...MODES.map(m => [m, modeNames[m]] as [string, string])] }/><button className="text-button" disabled={busy} onClick={onLibrary}>查找单词</button></div></section>
    {!state.settings.onboarded && <section className="onboarding"><div><span className="eyebrow">从熟悉的地方开始</span><h2>{assessing ? '揭晓前，先想想它的意思' : `用 ${assessment.length} 个词，找到学习起点`}</h2><p>自评熟悉度，随时可以跳过。</p></div>{assessing && word ? <div className="assessment"><div className="section-label"><strong className="big-word">{word.word}</strong><span>{index + 1} / {assessment.length}</span></div>{reveal ? <><p>{word.pos} {word.meaning}</p><div className="action-row"><button className="secondary" disabled={busy} onClick={() => void assessed(false)}>还不熟悉</button><button className="primary" disabled={busy} onClick={() => void assessed(true)}>揭晓前就知道</button></div></> : <button className="secondary" onClick={() => setReveal(true)}>揭晓词义</button>}</div> : <div className="onboarding-controls"><button className="secondary" disabled={busy || !assessment.length} onClick={() => { setAssessing(true); setIndex(0); setReveal(false); }}>开始初测</button><button className="text-button" disabled={busy} onClick={() => void save({ type: 'settings', settings: { onboarded: true } })}>跳过</button></div>}</section>}
    <section className="paper-card recent-panel"><div className="section-label"><h2>最近练习记录</h2><button className="text-button" onClick={onStats} disabled={busy}>查看全部</button></div><RecentPractice state={state}/></section>
  </div><aside className="learning-overview" aria-label="学习概览"><div className="overview-heading"><h2>学习概览</h2><CalendarDays size={18}/></div><section className="due-overview"><span>当前待复习</span><div><strong>{due.length}</strong><span>项练习</span></div><p>让记忆在恰当的时候重逢。</p><button className="primary" disabled={busy || !due.length} onClick={() => onReview(due.slice(0, 30))}>{due.length ? '开始复习' : '暂无到期练习'}</button></section><div className="daily-overview"><div><span>今日已读</span><strong>{doneToday}<small>段</small></strong></div><div><span>主动回忆</span><strong>{reviewed}<small>次</small></strong></div></div><p className="overview-footnote">今日数据涵盖所有词表 · 北京时间</p><section className="overview-section"><div className="section-label"><h2>语境中的相遇</h2><Sparkles size={17}/></div><div className="coverage-number"><strong>{reading.covered.toLocaleString()}</strong><span>/ {reading.total.toLocaleString()} 个词条</span></div><div className="progress-track"><i style={{ width: `${percent}%` }}/></div><p className="muted">阅读覆盖 {percent}% · 接触不等于掌握</p></section><section className="overview-section"><div className="section-label"><h2>三个回忆方向</h2></div><div className="ability-list">{MODES.map((m, i) => { const count = due.filter(item => item.mode === m).length; return <button key={m} disabled={busy || !count} onClick={() => onReview(due.filter(item => item.mode === m).slice(0, 30))} title={count ? `${count} 项到期练习` : '这个方向暂无到期练习'}><span className="circle-number">0{i + 1}</span><span>{modeNames[m]}</span><strong>{count}</strong></button>; })}</div><p className="small-note"><Check size={15}/>同一词条的不同方向分别计数。</p></section><ReviewPlan state={state} compact/><div className="quiet-note"><BookOpen size={19}/><p>不必一次记住所有，<br/>每一次相遇，都在加深印象。</p></div></aside></div>;
}
