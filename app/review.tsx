"use client";
import { useRef, useState } from 'react';
import { BookOpen, Eye, SkipForward } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { modeNames } from '@/lib/learning';
import { Speak, dateText } from './ui';
import { BrowseReview } from './browse-review';
import type {AppProps, QueueItem} from './types';

export function Review({items,state,save,busy,onDone,browse=false}:AppProps&{items:QueueItem[];onDone:()=>void;browse?:boolean}) {
  const [index,setIndex]=useState(0);
  const [answer,setAnswer]=useState('');
  const [revealed,setRevealed]=useState(false);
  const [peeked,setPeeked]=useState(false);
  const [hint,setHint]=useState(false);
  const [browsing,setBrowsing]=useState(browse);
  const [failed,setFailed]=useState(false);
  const saving=useRef(false);
  const [score,setScore]=useState({correct:0,hinted:0,wrong:0,skipped:0});
  const current=items[index];
  const locked=busy||failed;
  function next() { setIndex(i=>i+1);setAnswer('');setRevealed(false);setPeeked(false);setHint(false);setFailed(false); }
  function skip() { if(locked||saving.current)return;setScore(s=>({...s,skipped:s.skipped+1}));next(); }
  async function submit(outcome:'correct'|'wrong') {
    if(!current||saving.current||busy||peeked)return;
    saving.current=true;
    const actual=outcome==='correct'&&hint?'hinted':outcome;
    try {
      if(await save({type:'result',wordId:current.word.id,mode:current.mode,outcome:actual,answer})) { setScore(s=>({...s,[actual]:s[actual]+1}));next(); }
      else setFailed(true);
    } finally { saving.current=false; }
  }
  if(browsing)return <BrowseReview items={items.slice(index)} onDone={onDone}/>;
  if(!current)return <section className="paper-card complete"><div className="eyebrow">SESSION COMPLETE</div><h2>这一轮结束了。</h2><div className="mini-stats"><div><strong>{score.correct}</strong>独立完成</div><div><strong>{score.hinted}</strong>借助提示</div><div><strong>{score.wrong}</strong>需要重温</div><div><strong>{score.skipped}</strong>跳过 / 只看答案</div></div><p>仅已提交的练习会安排下次复习，跳过的练习保持原计划。</p><button className="primary" onClick={onDone}>回到今日任务</button></section>;
  const {word:w,mode}=current;
  return <section className="paper-card review-card">
    <div className="section-label review-heading"><span>{modeNames[mode]} · {index+1} / {items.length}</span><div className="action-row"><button className="text-button" disabled={locked} onClick={()=>setBrowsing(true)}><BookOpen size={16}/>快速浏览剩余词</button><button className="text-button" disabled={locked} onClick={onDone}>结束本轮</button></div></div>
    <Progress value={index/items.length*100} aria-label="本轮复习进度"/>
    <div className="question"><span className="pill">回忆练习</span>{mode==='recall'?<><h2>{w.meaning}</h2><p>{w.pos} · 想起本轮目标词，用英文写下来。</p></>:mode==='meaning'?<><h2 className="big-word">{w.word}<Speak text={w.word}/></h2><p>写出这个词本轮所学的中文义项。</p></>:<><p className="english context-sentence">{w.test}</p><p>在这句新语境中，<strong>{w.word}</strong> 表达什么含义？</p></>}</div>
    {!peeked&&<><label htmlFor="review-answer" className="field-label">你的答案</label><textarea id="review-answer" autoComplete="off" spellCheck={false} value={answer} onChange={e=>setAnswer(e.target.value)} disabled={revealed||busy} placeholder={mode==='recall'?'先尝试写出英文单词':'用中文写下你的理解'} maxLength={1000} rows={2}/></>}
    {!revealed&&<div className="action-row review-actions"><button className="secondary" onClick={()=>setHint(true)} disabled={hint||busy}>给我一点提示</button><button className="secondary" disabled={busy} onClick={()=>{setPeeked(true);setRevealed(true);}}><Eye size={16}/>直接看答案</button><button className="primary" disabled={busy||!answer.trim()} onClick={()=>setRevealed(true)}>提交并核对答案</button></div>}
    {hint&&!revealed&&<p className="hint" role="status">{mode==='recall'?`首字母 ${w.word[0]}，共 ${w.word.length} 个字母。`:`词义线索：${w.meaning.slice(0,1)}……`} 本题将标为借助提示完成。</p>}
    {revealed&&<div className="feedback" aria-live="polite"><h3>{w.word} · {w.pos} {w.meaning}</h3>{mode==='context'&&<p>{w.testTranslation}</p>}{w.example&&<><p className="english">{w.example}<Speak text={w.example}/></p><p>{w.translation}</p></>}{!peeked&&<>{mode==='recall'&&answer.trim().toLowerCase()!==w.word.toLowerCase()&&<p>拼写与目标词不同。其他表达可能成立，请核对本轮是否想起了 <strong>{w.word}</strong>。</p>}<p className="muted">请按揭晓前的回答判断；看完答案才想起来，选择“需要重温”。</p><div className="action-row"><button className="secondary" disabled={busy} onClick={()=>submit('wrong')}>需要重温</button><button className="primary" disabled={busy||!answer.trim()} onClick={()=>submit('correct')}>{hint?'借助提示答对':'核对后，独立答对'}</button></div></>}</div>}
    <div className="review-skip-row"><button className={peeked?'primary':'text-button'} disabled={locked} onClick={skip}><SkipForward size={17}/>{peeked?'下一个，不记分':'跳过本题'}</button><span>不计答对，也不更改复习时间</span></div>
    <p className="small-note">{state.progress[w.id]?.[mode]?.last?'上次练习：'+dateText(state.progress[w.id][mode]!.last):'该方向尚未完成练习'}</p>
  </section>;
}
