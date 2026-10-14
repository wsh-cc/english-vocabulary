"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, LibraryBig, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AuthPanel } from './auth-panel';
import { ThemeControl } from './theme';
import { ModuleBoundary, ModuleLoading } from './module-boundary';
import type { StateSnapshot } from './types';
import { createLazyModule } from '@/lib/lazy-module';

const studyModule = createLazyModule(() => import('./study-app'));
const StudyApp = lazy(studyModule.load);

// Keep the catalogue and learning tools out of the signed-out entry bundle.
export default function Entry() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const task = (async () => {
      try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (response.status === 401) { setError(''); return; }
        // Once authenticated, overlap module loading with the snapshot body.
        if (response.ok) studyModule.preload();
        const data = await response.json() as StateSnapshot & { error?: string };
        if (!response.ok) throw Error(data.error || '学习记录加载失败，请重试。');
        setSnapshot({ ...data, etag: response.headers.get('etag') });
        setError('');
      } catch (cause) { setError(cause instanceof Error ? cause.message : '连接暂不可用，请重试。'); }
      finally { setLoaded(true); inFlight.current = null; }
    })();
    inFlight.current = task;
    return task;
  }, []);
  useEffect(() => {
    if (snapshot) return;
    const timer = setTimeout(() => void refresh(), 0);
    const focus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearTimeout(timer); window.removeEventListener('focus', focus); };
  }, [refresh, snapshot]);

  if (snapshot) return <ModuleBoundary><Suspense fallback={<ModuleLoading/>}><StudyApp initialSnapshot={snapshot}/></Suspense></ModuleBoundary>;
  return <div className="app-shell is-guest"><a className="skip-link" href="#learning-content">跳到学习内容</a><header className="site-header"><Link className="brand" href="/" aria-label="词间首页"><span className="brand-mark"><LibraryBig size={23}/></span><span>词间<small>WORDWEAVE</small></span></Link><div className="guest-tools"><span className="header-note">在句子中学单词</span><ThemeControl/></div></header><div className="main-area"><main id="learning-content" tabIndex={-1} className="signed-out">{error && <div className="error-banner" role="alert"><span>{error}</span><button className="secondary" onClick={() => void refresh()}><RefreshCw size={16}/>重新连接</button></div>}{loaded ? <AuthPanel onAuthenticated={async () => { studyModule.preload(); await inFlight.current; await refresh(); }}/> : <div className="loading-state" role="status"><BookOpen size={28}/><p>正在读取学习记录…</p><div className="skeleton-line"/><div className="skeleton-line short"/><div className="skeleton-card"/></div>}</main></div></div>;
}
