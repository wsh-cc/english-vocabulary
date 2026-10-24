"use client";

import { ThemeProvider, useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="wordweave-appearance">{children}</ThemeProvider>;
}

export function ThemeControl({ expanded = false }: { expanded?: boolean }) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const selected = mounted ? theme : 'system';
  const options = [{ value: 'system', label: '跟随系统', icon: Monitor }, { value: 'light', label: '纸白', icon: Sun }, { value: 'dark', label: '深绿', icon: Moon }];
  const current = options.find(option => option.value === selected) ?? options[0];
  const next = options[(options.indexOf(current) + 1) % options.length];
  if (expanded) return <div className="theme-options" role="group" aria-label="外观模式">{options.map(({ value, label, icon: Icon }) => <button key={value} className={selected === value ? 'selected' : ''} aria-pressed={selected === value} onClick={() => setTheme(value)}><Icon size={17}/>{label}</button>)}</div>;
  return <button className="icon-button theme-toggle" onClick={() => setTheme(next.value)} aria-label={`外观：${current.label}，切换为${next.label}`} title={`外观：${current.label}，切换为${next.label}`}><current.icon size={18}/></button>;
}
