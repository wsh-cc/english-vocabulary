import catalog from '@/content/catalog.json';
import corrections from '@/content/reading-corrections.json';
import type { ReadingProgress } from './reading';
import { completeReading } from './reading';
export const MODES=['meaning','recall','context'] as const;
export type Mode=typeof MODES[number];
export const modeNames:Record<Mode,string>={meaning:'英文认义',recall:'中文回忆英文',context:'英文语境理解'};
export type Word={id:string;word:string;pos:string;meaning:string;collocation:string;example:string;translation:string;test:string;testTranslation:string;phonetic:string;tags:string[];source:string;version:string;sourceUrl:string;scene:string;mnemonic:string;materialStatus?:"complete"|"basic";references?:{source:string;url:string;listUrl:string;version:string}[]};
export type Track={due:number;streak:number;attempts:number;correct:number;hinted:number;wrong:number;last:number;interval:number};
export type Result={id:string;wordId:string;mode:Mode;outcome:'correct'|'hinted'|'wrong';at:number;delayed:boolean;answer:string;nextDue:number};
export type State={version:1;settings:{level:'CET4'|'CET6';daily:number;length:'long'|'short';count:number;gloss:'click'|'direct';onboarded:boolean};reading?:ReadingProgress;progress:Record<string,Partial<Record<Mode,Track>>>;notes:Record<string,string>;familiar:Record<string,string>;learned:Record<string,number>;custom:Word[];events:Result[];operations:string[]};
export const seedWords:Word[]=catalog.words.map(w=>({...w,meaning:(corrections as Record<string,{meaning:string}>)[w.word]?.meaning??w.meaning,materialStatus:w.materialStatus==='basic'?'basic':'complete'}));
export const scenes=catalog.scenes;
export const hasContext=(w:Word)=>!!(w.test?.trim()&&w.testTranslation?.trim());
export const availableModes=(w:Word|undefined):Mode[]=>!w?[]:hasContext(w)?[...MODES]:['meaning','recall'];
export const initialState=():State=>({version:1,settings:{level:'CET6',daily:6,length:'long',count:6,gloss:'click',onboarded:false},reading:{encounters:{},completed:{}},progress:{},notes:{},familiar:{},learned:{},custom:[],events:[],operations:[]});
export const allWords=(s:State)=>[...seedWords,...s.custom];
export const DAY=86400000;
export const chinaDay=(t:number)=>new Date(t+8*3600000).toISOString().slice(0,10);
export function dueItems(s:State,now=Date.now()){return allWords(s).filter(w=>w.tags.includes(s.settings.level)).flatMap(w=>availableModes(w).filter(m=>s.progress[w.id]?.[m]&&s.progress[w.id][m]!.due<=now).map(mode=>({word:w,mode,due:s.progress[w.id][mode]!.due}))).sort((a,b)=>a.due-b.due);}
export function schedule(previous:Track|undefined,outcome:Result['outcome'],now:number):Track {const streak=outcome==='correct'?Math.max(1,(previous?.streak??0)+(!previous?.last||now-previous.last>=DAY?1:0)):0;const interval=outcome==='wrong'?600000:outcome==='hinted'?DAY:[1,3,7,14,30,60][Math.min(streak-1,5)]*DAY;return {due:now+interval,streak,interval,last:now,attempts:(previous?.attempts??0)+1,correct:(previous?.correct??0)+(outcome==='correct'?1:0),hinted:(previous?.hinted??0)+(outcome==='hinted'?1:0),wrong:(previous?.wrong??0)+(outcome==='wrong'?1:0)};}
const fresh=(due:number):Track=>({due,streak:0,attempts:0,correct:0,hinted:0,wrong:0,last:0,interval:0});
export function introduce(s:State,ids:string[],now:number){for(const id of ids){s.learned[id]??=now;s.progress[id]??={};for(const m of availableModes(allWords(s).find(w=>w.id===id)))s.progress[id][m]??=fresh(now);}}
export function applyAction(s:State,a:any,now=Date.now()):State {if(s.operations.includes(a.operationId))return s;const ids=new Set(allWords(s).map(w=>w.id));const valid=(id:string)=>{if(!ids.has(id))throw Error('词汇不存在');};
if(a.type==='settings')s.settings={...s.settings,...a.settings};
if(a.type==='reading-complete'){a.passage.wordIds.forEach(valid);completeReading(s,a.passage,now);}
if(a.type==='introduce'){a.ids.forEach(valid);introduce(s,a.ids,now);}
if(a.type==='note'){valid(a.wordId);s.notes[a.wordId]=a.note;}
if(a.type==='familiar'){valid(a.wordId);s.familiar[a.wordId]=a.value;if(a.value==='familiar'){s.progress[a.wordId]??={};for(const m of availableModes(allWords(s).find(w=>w.id===a.wordId))){const old=s.progress[a.wordId][m];if(!old||old.attempts===0)s.progress[a.wordId][m]=fresh(now+7*DAY);}}else if(a.value==='unknown'){s.progress[a.wordId]??={};for(const m of availableModes(allWords(s).find(w=>w.id===a.wordId)))s.progress[a.wordId][m]??=fresh(now);}}
if(a.type==='result'){valid(a.wordId);if(!availableModes(allWords(s).find(w=>w.id===a.wordId)).includes(a.mode))throw Error('该词汇尚未提供这一训练方向');introduce(s,[a.wordId],now);const prior=s.progress[a.wordId][a.mode as Mode];const track=schedule(prior,a.outcome,now);s.progress[a.wordId][a.mode as Mode]=track;s.events.push({id:a.operationId,wordId:a.wordId,mode:a.mode,outcome:a.outcome,answer:a.answer,at:now,nextDue:track.due,delayed:!!prior?.last&&now-prior.last>=DAY});}
if(a.type==='import'){const byKey=new Map(allWords(s).map(w=>[`${w.word.toLowerCase()}|${w.pos}|${w.meaning}`,w]));for(const w of a.words as Word[]){const existing=byKey.get(`${w.word.toLowerCase()}|${w.pos}|${w.meaning}`);if(existing){if(seedWords.some(x=>x.id===existing.id)){continue;}existing.tags=[...new Set([...existing.tags,...w.tags])];continue;}if(ids.has(w.id))throw Error('导入的义项编号重复');s.custom.push(w);ids.add(w.id);byKey.set(`${w.word.toLowerCase()}|${w.pos}|${w.meaning}`,w);}}
if(a.type==='restore')s=a.backup;
s.operations=[...s.operations,a.operationId].slice(-1000);return s;}
