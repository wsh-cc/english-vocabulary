"use client";

import { Cloud, SlidersHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Choice } from './ui';
import { ThemeControl } from './theme';
import type { AppProps } from './types';

export function Settings({ state, save, busy, open, onClose, onBackup, error, retry }: AppProps & { open: boolean; onClose: () => void; onBackup: () => void; error: string; retry: () => void }) {
  return <Sheet open={open} onOpenChange={value => { if (!value) onClose(); }}><SheetContent className="settings-sheet"><SheetHeader><SheetTitle><SlidersHorizontal size={21}/>学习设置</SheetTitle><SheetDescription>让词间适合你的阅读习惯。</SheetDescription></SheetHeader><div className="detail-body settings-body">
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="secondary" disabled={busy} onClick={retry}>重试保存</button></div>}
    {busy && <p role="status" className="muted">正在保存设置…</p>}
    <section><h3>外观</h3><ThemeControl expanded/><p className="muted">外观选择保存在这台设备上。</p></section>
    <section><h3>学习偏好</h3><Choice label="学习词表" value={state.settings.level} disabled={busy} options={ [['CET4', '大学英语四级'], ['CET6', '大学英语六级']] } onChange={level => void save({ type: 'settings', settings: { level } })}/><p className="muted">切换词表会保留两级的学习进度。</p><Choice label="词义提示" value={state.settings.gloss} disabled={busy} options={ [['click', '点词查看'], ['direct', '随句显示']] } onChange={gloss => void save({ type: 'settings', settings: { gloss } })}/><Choice label="每日新词上限" value={String(state.settings.daily)} disabled={busy} options={ [...new Set([state.settings.daily, 6, 10, 20, 30, 40])].sort((a, b) => a - b).map(n => [String(n), `${n} 个词条`] as [string, string]) } onChange={daily => void save({ type: 'settings', settings: { daily: Number(daily) } })}/><p className="muted">仅用于词库的新词练习，不限制阅读和到期复习。</p></section>
    <section><h3><Cloud size={19}/>数据与备份</h3><p>学习偏好和记录随账号同步。完整备份与校验恢复可在学习记录中操作。</p><button className="secondary" disabled={busy} onClick={onBackup}>管理学习备份</button></section>
  </div></SheetContent></Sheet>;
}
