"use client";
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { ChevronLeft } from 'lucide-react';
import './appearance.css';

export const appearanceOptions = [
  {value: 'light', label: '纸白 · 浅色', name: '纸白', description: '柔白纸面，灰绿点缀', icon: <Sun size={22}/>},
  {value: 'dark', label: '深绿 · 深色', name: '深绿', description: '安静深绿，柔和低光', icon: <Moon size={22}/>},
  {value: 'system', label: '跟随系统', name: '跟随系统', description: '随系统设置自动切换纸白与深绿', icon: <Monitor size={22}/>},
];

function PaperBranch() {
  return <svg className="appearance-illustration" viewBox="0 0 160 180" fill="none" aria-hidden="true">
    <circle cx="104" cy="55" r="37" className="appearance-halo"/>
    <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M25 131c17-8 35-6 51 3V77c-15-9-33-11-51-3v57Zm51 3c17-10 36-11 54-5V72c-19-6-36-3-54 5" className="appearance-book"/>
      <path d="m20 80-4 55c21-7 42-4 60 5 17-10 36-12 60-7l-1-54M36 88c9-2 18-1 28 3M36 99c9-2 18-1 28 3M88 89c10-4 19-5 30-3" opacity=".5"/>
      <path d="M90 154c3-37 17-66 42-88m-28 49c-17-1-22-14-20-23 12 2 21 11 20 23Zm11-20c-2-14 2-24 15-29 3 13-3 22-15 29Zm-16 37c9-12 21-15 34-10-8 13-19 16-34 10Z"/>
      <path d="M39 150h28m-23 6h15" opacity=".35"/>
    </g>
  </svg>;
}

function ThemePreview({dark}: {dark: boolean}) {
  return <span className={`appearance-preview ${dark ? 'appearance-preview-dark' : ''}`} aria-hidden="true">
    <span className="appearance-preview-heading"><span>词间</span><span>•••</span></span>
    <span className="appearance-preview-card"><span className="appearance-preview-eyebrow">A LITTLE EVERY DAY</span><span className="appearance-preview-title">把单词，<br/>读进生活。</span><span className="appearance-preview-leaf"/><span className="appearance-preview-line"/></span>
    <span className="appearance-preview-bottom"><i/><i/><i/></span>
  </span>;
}

export function AppearancePage({value, onChange, disabled}: {value:string; onChange:(value:string)=>void; disabled:boolean}) {
  return <div className="appearance-page">
    <section className="appearance-story"><div><span className="ww-eyebrow">A QUIETER LIGHT</span><h2>留一点白，<br/>让阅读慢下来。</h2><p>像翻开一页书，<br/>选择此刻舒服的光线。</p></div><PaperBranch/></section>
    <div className="appearance-options" role="radiogroup" aria-label="主题外观" onKeyDown={event => {
      const index = appearanceOptions.findIndex(option => option.value === value);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : ['ArrowRight','ArrowDown'].includes(event.key) ? (index + 1) % 3 : ['ArrowLeft','ArrowUp'].includes(event.key) ? (index + 2) % 3 : -1;
      if (next < 0 || disabled) return;
      event.preventDefault(); onChange(appearanceOptions[next].value);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
    }}>
      {appearanceOptions.map(option => <button key={option.value} type="button" role="radio" aria-label={option.label} aria-checked={value === option.value} tabIndex={value === option.value ? 0 : -1} disabled={disabled} onClick={() => onChange(option.value)} className={`appearance-option ${option.value === 'system' ? 'appearance-system' : ''}`}>
        {option.value === 'system' ? <span className="appearance-system-icon">{option.icon}</span> : <ThemePreview dark={option.value === 'dark'}/>}
        <span className="appearance-option-info"><span className="appearance-option-heading"><strong>{option.name}</strong><span className="appearance-check" aria-hidden="true">{value === option.value && <Check size={13}/>}</span></span><small>{option.description}</small></span>
      </button>)}
    </div>
    <p className="appearance-note" role="status">已选择{appearanceOptions.find(option => option.value === value)?.name || '跟随系统'} · 自动保存在这台设备</p>
  </div>;
}

export function Appearance({onBack}:{onBack:()=>void}) { const {theme,setTheme}=useTheme(); return <div className="web-appearance"><button className="secondary" onClick={onBack}><ChevronLeft size={17}/>返回我的</button><AppearancePage value={theme??"system"} onChange={setTheme} disabled={false}/></div>; }
