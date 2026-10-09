"use client";
import { useEffect, useState } from 'react';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Volume2 } from 'lucide-react';
import { toast } from 'sonner';
export function Choice({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(v:string)=>void;options:[string,string][];disabled?:boolean}){return <label className="choice"><span>{label}</span><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{options.map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></label>}
export function Speak({text}:{text:string}){return <button className="icon-button" aria-label={'朗读 '+text} onClick={()=>{if(!('speechSynthesis' in window)){toast.error('当前浏览器不支持朗读，请使用支持语音的浏览器。');return;}window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='en-US';u.rate=.85;const voice=window.speechSynthesis.getVoices().find(v=>v.lang.startsWith('en'));if(voice)u.voice=voice;u.onerror=e=>{if(e.error!=='interrupted'&&e.error!=='canceled')toast.error('朗读暂不可用，请检查设备的英语语音设置。');};window.speechSynthesis.speak(u);}}><Volume2 size={18}/></button>}
export const dateText=(t:number)=>new Date(t).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'});

export function useLearningClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  return now;
}
