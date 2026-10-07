"use client";
import { useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Speak } from './ui';
import type { QueueItem } from './types';

export function BrowseReview({items,onDone}:{items:QueueItem[];onDone:()=>void}) {
  const words=useMemo(()=>[...new Map(items.map(item=>[item.word.id,item.word])).values()],[items]);
  const [index,setIndex]=useState(0);
  const word=words[index];
  if(!word)return <section className="paper-card complete"><BookOpen size={30}/><h2>本轮浏览完成</h2><p>看过 {words.length} 个词条，未记为测试通过，也未更改复习计划。</p><div className="action-row"><button className="secondary" onClick={()=>setIndex(0)} disabled={!words.length}><RotateCcw size={16}/>再看一遍</button><button className="primary" onClick={onDone}>回到今日任务</button></div></section>;
  return <section className="paper-card browse-card">
    <div className="section-label"><span><BookOpen size={17}/>快速浏览 · {index+1} / {words.length}</span><button className="text-button" onClick={onDone}>结束浏览</button></div>
    <Progress value={(index+1)/words.length*100} aria-label="本轮浏览进度"/>
    <div className="browse-word" aria-live="polite" aria-atomic="true" key={word.id}><div className="tag-row">{word.tags.map(tag=><span className="pill" key={tag}>{tag==='CET4'?'四级':'六级'}</span>)}</div><h2 className="big-word">{word.word}<Speak text={word.word}/></h2>{word.phonetic&&<p className="browse-phonetic">/{word.phonetic}/</p>}<p className="browse-meaning"><span>{word.pos}</span>{word.meaning}</p>{word.example&&<div className="browse-example"><p className="english">{word.example}<Speak text={word.example}/></p><p>{word.translation}</p>{word.collocation&&<p className="collocation">{word.collocation}</p>}</div>}</div>
    <div className="browse-navigation"><button className="secondary" disabled={index===0} onClick={()=>setIndex(i=>i-1)}><ChevronLeft size={18}/>上一个</button><span>{index+1} / {words.length}</span><button className="primary" onClick={()=>setIndex(i=>i+1)}>{index===words.length-1?'完成浏览':'下一个'}<ChevronRight size={18}/></button></div>
    <p className="small-note">仅浏览，不记分，不改变复习计划。</p>
  </section>;
}
