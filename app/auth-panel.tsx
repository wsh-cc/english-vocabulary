"use client";
import { useState, type FormEvent } from 'react';
import { BookOpen, Eye, EyeOff, KeyRound, LogIn, UserRoundPlus } from 'lucide-react';

export function AuthPanel({onAuthenticated}: {onAuthenticated: () => Promise<void>}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: mode, username: data.get('username'), password: data.get('password'), ...(mode === 'register' ? {invitation: data.get('invitation')} : {})})});
      const result = await response.json() as {error?: string};
      if (!response.ok) throw Error(result.error ?? '暂时无法登录，请重试。');
      await onAuthenticated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '连接失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <div className="auth-page">
    <section className="auth-form-area" aria-label="账号登录与注册">
      <div className="auth-symbol"><BookOpen size={24}/></div><p className="eyebrow">A SPACE FOR YOUR WORDS</p><h1>{mode === 'login' ? '欢迎回到词间' : '创建你的私人账号'}</h1><p className="auth-subtitle">{mode==='login'?'接着上次的进度，继续积累。':'从今天开始，让记忆慢慢生长。'}</p>
      <div className="auth-tabs" role="tablist" aria-label="账号操作"><button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => {setMode('login'); setError('');}}>登录</button><button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => {setMode('register'); setError('');}}>注册</button></div>
      <form onSubmit={submit} key={mode}>
        <label className="auth-field">用户名<input name="username" autoComplete="username" required minLength={3} maxLength={32} placeholder="你的用户名" disabled={busy}/></label>
        <label className="auth-field">密码<span className="password-field"><input name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} placeholder={mode === 'login' ? '输入密码' : '至少 12 位，可使用长短语'} disabled={busy}/><button type="button" title={visible ? '隐藏密码' : '显示密码'} aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
        {mode === 'register' && <label className="auth-field">私人注册密钥<input name="invitation" type="password" autoComplete="off" required maxLength={200} placeholder="输入专属密钥" disabled={busy}/></label>}
        {error && <p role="alert" className="auth-error">{error}</p>}
        <button className="primary auth-submit" disabled={busy} type="submit">{mode === 'login' ? <LogIn size={18}/> : <UserRoundPlus size={18}/>} {busy ? '请稍候…' : mode === 'login' ? '登录词间' : '创建账号'}</button>
      </form>
      <p className="auth-note"><KeyRound size={15}/>{mode === 'register' ? '密钥仅用于首次开通，注册后使用密码登录。' : '你的词汇、联想和学习足迹，都在这里。'}</p>
    </section>
  </div>;
}
