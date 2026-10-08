"use client";
import { useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { BookOpen, RotateCcw, SlidersHorizontal, Check, Layers, Target, PenLine } from 'lucide-react';
import { allWords, dueItems, chinaDay, MODES, modeNames } from '@/lib/learning';
import { readingSummary } from '@/lib/reading';
import { Choice } from './ui';
import type {AppProps,QueueItem} from './types';

export function Today({state,save,busy,onLearn,onLibrary,onReview}:AppProps&{onLearn:()=>void;onLibrary:()=>void;onReview:(items:QueueItem[],browse?:boolean)=>void}) {
  const [assessing,setAssessing]=useState(false);
  const [index,setIndex]=useState(0);
  const [reveal,setReveal]=useState(false);
  const [mode,setMode]=useState('all');
  const words=allWords(state).filter(w=>w.tags.includes(state.settings.level));
  const due=dueItems(state);
  const doneToday=Object.values(state.reading?.completed??{}).filter(t=>chinaDay(t)===chinaDay(Date.now())).length;
  const reading=readingSummary(state);
  const assessment=words.filter((_,i)=>i%Math.max(1,Math.floor(words.length/5))===0).slice(0,5);
  const w=assessment[index];
  const known=reading.covered;
  const reviewed=state.events.filter(e=>chinaDay(e.at)===chinaDay(Date.now())).length;
  async function assessed(familiar:boolean) {
    if(await save({type:'familiar',wordId:w.id,value:familiar?'familiar':'unknown'})) {
      if(index===assessment.length-1) {if(await save({type:'settings',settings:{onboarded:true}}))setAssessing(false);}
      else {setIndex(i=>i+1);setReveal(false);}
    }
  }
  const filtered=due.filter(x=>mode==='all'||x.mode===mode);
  return <>
    <section className="reading-primary"><div><h2>在句子里，读懂并记住单词</h2><p>故事已写好，每段 20～40 个目标词。跟着句子读，逐步覆盖整个内置词表。</p><small>已在语境中读过 {reading.covered} / {reading.total} 个词条</small></div><button className="primary" disabled={busy} onClick={onLearn}><BookOpen size={18}/>{reading.covered?'继续读句子':'开始读句子'}</button></section>
    <div className="overview-intro"><p>把精力留给今天，把记忆交给时间。</p><span>{state.settings.level==='CET6'?'大学英语六级':'大学英语四级'} · {words.length.toLocaleString()} 个词条</span><button className="secondary" disabled={busy||!words.length} onClick={()=>onReview(words.map(word=>({word,mode:'meaning'})),true)}><BookOpen size={16}/>快速浏览词表</button></div>
    <section className="overview-metrics" aria-label="学习概况">
      {[{label:'待复习',value:due.length,caption:'个到期练习',icon:RotateCcw,color:'green'},{label:'今日阅读',value:doneToday,caption:'篇已读段落',icon:PenLine,color:'blue'},{label:'今日练习',value:reviewed,caption:'次主动回忆',icon:Target,color:'rose'},{label:'语境覆盖',value:known,caption:`共 ${reading.total.toLocaleString()} 个内置词条`,icon:Layers,color:'gray'}].map(({label,value,caption,icon:Icon,color})=><div className={'overview-metric '+color} key={label}><div><span>{label}</span><Icon size={17}/></div><strong>{value.toLocaleString()}<small>{label==='今日新词'?'/ '+state.settings.daily:''}</small></strong><p>{caption}</p></div>)}
    </section>
    {!state.settings.onboarded&&<section className="onboarding"><div><span className="eyebrow">起点测试</span><h2>{assessing?'先想一想，这个词是什么意思？':'用 5 个词，找到学习起点'}</h2><p>约 1 分钟，自评熟悉程度。</p></div>{assessing&&w?<div className="assessment"><div className="section-label"><strong className="big-word">{w.word}</strong><span>{index+1} / 5</span></div>{reveal?<><p>{w.pos} {w.meaning}</p><div className="action-row"><button className="secondary" disabled={busy} onClick={()=>assessed(false)}>还不熟悉</button><button className="primary" disabled={busy} onClick={()=>assessed(true)}>揭晓前就知道</button></div></>:<button className="primary" onClick={()=>setReveal(true)}>揭晓词义</button>}</div>:<div className="onboarding-controls"><button className="secondary" disabled={busy} onClick={()=>{setAssessing(true);setIndex(0);setReveal(false);}}>开始初测</button><button className="text-button" disabled={busy} onClick={()=>save({type:'settings',settings:{onboarded:true}})}>跳过，直接学习</button></div>}</section>}
    <div className="today-columns"><section className="study-agenda"><div className="section-label"><h2>今日计划</h2><span>按自己的节奏</span></div><article className="agenda-item"><div className="agenda-icon green"><RotateCcw size={23}/></div><div className="agenda-copy"><h3>温故 · 到期复习</h3><p>{filtered.length?`${filtered.length} 个练习，等你再次想起。`:'当前没有到期练习。'}</p></div><button className="primary" disabled={busy||!filtered.length} onClick={()=>onReview(filtered.slice(0,30))}>开始复习</button></article><article className="agenda-item"><div className="agenda-icon blue"><BookOpen size={23}/></div><div className="agenda-copy"><h3>查阅 · 我的词库</h3><p>按需查询释义和维护词条。</p></div><button className="secondary" disabled={busy} onClick={onLibrary}>查看词库</button></article><article className="agenda-item"><div className="agenda-icon rose"><PenLine size={23}/></div><div className="agenda-copy"><h3>阅读 · 句子学习</h3><p>通过完整句子逐步读完当前词表。</p></div><button className="secondary" disabled={busy} onClick={onLearn}>继续阅读</button></article>
      <div className="progress-section"><div className="section-label"><h3>内置词表阅读进度</h3><span>{known} / {reading.total.toLocaleString()}</span></div><Progress value={known/Math.max(1,reading.total)*100} aria-label="已接触义项比例"/><p className="muted">已在句子中读过 {Math.round(known/Math.max(1,reading.total)*100)}% · 阅读不等于测试通过</p></div>
    </section><aside className="ability-section"><div className="section-label"><h2>回忆的三个方向</h2></div><div className="ability-list">{MODES.map((m,i)=><button key={m} disabled={busy||!due.some(item=>item.mode===m)} onClick={()=>onReview(due.filter(item=>item.mode===m).slice(0,30))}><span className="circle-number">0{i+1}</span><div><h3>{modeNames[m]}</h3><p>{['由英文，回想词义','由中文，回想拼写','换个句子，理解词义'][i]}</p></div><strong>{due.filter(x=>x.mode===m).length}</strong></button>)}</div><p className="small-note"><Check size={15}/>提示后答对，会单独记录。</p><div className="reading-photo"><img src="/images/reading-room.jpg" alt="安静的图书馆阅览室"/><span>留一点时间，给专注。</span></div></aside></div>
    <section className="study-settings"><div className="section-label"><h2><SlidersHorizontal size={18}/>学习安排</h2></div><div className="toolbar compact-toolbar"><Choice label="复习方向" value={mode} onChange={setMode} options={ [['all','全部方向'],...MODES.map(m=>[m,modeNames[m]] as [string,string])] }/><Choice label="学习词表" value={state.settings.level} onChange={level=>save({type:'settings',settings:{level}})} options={ [['CET4','大学英语四级'],['CET6','大学英语六级']] } disabled={busy||assessing}/></div></section>
  </>;
}
