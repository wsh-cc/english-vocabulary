"use client";
import { Empty,EmptyDescription } from '@/components/ui/empty';
import { useMemo, useState } from 'react';
import { Cloud,Download,Upload } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction } from '@/components/ui/alert-dialog';
import { MODES,modeNames,chinaDay,seedWords,type State } from '@/lib/learning';
import { stateSchema } from '@/lib/validation';
import { download } from '@/lib/download';
import { dateText } from './ui';
import type { AppProps } from './types';
import { ReviewPlan } from './today';
import { toast } from 'sonner';
export function Statistics({state,save,busy,revision,cancelPending}:AppProps&{revision:number}){const [backup,setBackup]=useState<State|null>(null);const [restoreError,setRestoreError]=useState('');
const words=useMemo(()=>[...seedWords,...state.custom],[state.custom]);
const wordMap=useMemo(()=>new Map(words.map(word=>[word.id,word])),[words]);
const ids=useMemo(()=>new Set(words.filter(w=>w.tags.includes(state.settings.level)).map(w=>w.id)),[words,state.settings.level]);
const {events,delayed,wrong,rates,hinted,recent}=useMemo(()=>{
  const events=state.events.filter(event=>ids.has(event.wordId));
  const delayed=events.filter(e=>e.delayed);
  const wrong=Object.entries(events.filter(e=>e.outcome==='wrong').reduce<Record<string,number>>((m,e)=>{m[e.wordId]=(m[e.wordId]??0)+1;return m;},{})).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const rates=MODES.map(mode=>{const tested=events.filter(e=>e.mode===mode&&e.delayed);return {mode,tested:tested.length,count:tested.filter(e=>e.outcome==='correct').length};});
  const hinted=events.filter(e=>e.outcome==='hinted').length;
  return {events,delayed,wrong,rates,hinted,recent:events.slice(-20).reverse()};
},[state.events,ids]);
async function readBackup(file:File){try{if(file.size>4000000)throw Error('备份不能超过 4 MB。');const data=JSON.parse(await file.text());if(data.app!=='wordweave'||data.schema!==1)throw Error('这不是词间支持的备份文件。');const validated=stateSchema.safeParse(data.state);if(!validated.success)throw Error('备份内容不完整或格式无效：'+validated.error.issues[0].message);setRestoreError('');setBackup(validated.data);}catch(e){toast.error(e instanceof Error?e.message:'读取失败');}}
return <><div className="section-label"><h2>延后独立答对率</h2><span>当前词表 · 三个方向分别记录</span></div><div className="stats-grid">{rates.map(({mode,tested,count})=><section className="paper-card" key={mode}><span className="eyebrow">{modeNames[mode]}</span><h2 className="stat-number">{tested?Math.round(count/tested*100)+'%':'—'}</h2><Progress value={tested?count/tested*100:0} aria-label={modeNames[mode]+'延后独立答对率'}/><p>{tested?`${count} / ${tested} 次延后测试独立答对`:'积累间隔至少一天的测试后显示'}</p></section>)}</div><div className="dashboard stats-section"><ReviewPlan state={state}/><section className="paper-card"><h2>值得再看一眼</h2>{wrong.length?wrong.map(([id,count])=>{const w=wordMap.get(id)!;return <div className="track-row" key={id}><strong>{w.word}</strong><span>{w.meaning}</span><small>{count} 次需要重温</small></div>;}):<Empty className="empty-state"><EmptyDescription>暂时没有答错记录。练习后，这里会显示常错义项。</EmptyDescription></Empty>}<p className="small-note">延后测试 {delayed.length} 次 · 使用提示完成 {hinted} 次</p></section></div><section className="paper-card stats-section"><div className="section-label"><h2>最近的回忆</h2><span>{events.length} 次练习记录</span></div>{events.length?<div className="history-list">{recent.map(e=><div className="history-row" key={e.id}><strong>{wordMap.get(e.wordId)?.word}</strong><span>{modeNames[e.mode]}</span><span className={'outcome '+e.outcome}>{e.outcome==='correct'?'独立答对':e.outcome==='hinted'?'借助提示':'需要重温'}</span><time>{dateText(e.at)}{e.delayed?' · 延后测试':''}</time></div>)}</div>:<p>完成一次练习后，这里会记录训练方向、结果和时间。</p>}</section><section id="data-backup" className="paper-card stats-section"><div className="section-label"><h2><Cloud size={22}/>跨端与备份</h2><span className="pill">按账号保存</span></div><p>在手机和电脑打开同一网站，并登录同一账号，便可继续学习。打开页面、切回页面时会重新读取记录；同时作答会合并保存。</p><p className="muted">备份包含学习设置、所有练习记录、个人联想和导入词汇。恢复会替换账号当前数据，请先导出一份备份。</p><div className="action-row"><button className="secondary" disabled={busy} onClick={()=>download('词间-学习备份-'+chinaDay(Date.now())+'.json',{app:'wordweave',schema:1,exportedAt:new Date().toISOString(),catalog:seedWords,state})}><Download size={18}/>导出完整备份</button><label className="secondary file-label"><Upload size={18}/>恢复备份<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void readBackup(file);e.target.value='';}}/></label></div></section><AlertDialog open={!!backup} onOpenChange={open=>{if(!open&&!busy){setBackup(null);cancelPending?.();}}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>用备份替换当前学习记录？</AlertDialogTitle><AlertDialogDescription>备份有 {backup?.events.length} 次练习和 {backup?.custom.length} 个导入义项。账号当前记录会被替换，手机和电脑都会读取恢复后的数据。请先导出当前备份。</AlertDialogDescription></AlertDialogHeader>{restoreError&&<p role="alert" className="note-error">{restoreError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={async e=>{e.preventDefault();if(backup){setRestoreError('');if(await save({type:'restore',backup,revision})){setBackup(null);toast.success('备份恢复完成。');}else setRestoreError('恢复未完成，备份仍保留。请检查连接；如其他设备更新了记录，请取消并重新载入后再恢复。');}}}>确认恢复</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
