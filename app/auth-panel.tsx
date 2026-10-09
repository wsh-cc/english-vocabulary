"use client";
import { useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, LogIn, UserRound, UserRoundPlus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function AuthPanel({onAuthenticated}: {onAuthenticated: () => Promise<void>}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
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
  return <div className="auth-experience">
    <div className="auth-composition">
      <div className="auth-editorial">
        <div className="auth-editorial-heading"><span className="auth-edition">A WORLD BETWEEN WORDS</span><h1>词间<span>Wordweave.</span></h1><p>在句子中学单词，<br/>在回想中慢慢熟悉。</p><div className="auth-learning-note">你的私人四六级学习空间。<br/>读句子、理解词义，让每一次回忆都有迹可循。</div></div>
      </div>
      <section className="auth-entry" aria-label="账号登录与注册">
        <div className="auth-entry-heading"><span className="auth-entry-number">{mode === 'login' ? '01' : '02'}</span><span>{mode === 'login' ? 'YOUR NEXT CHAPTER' : 'A NEW BEGINNING'}</span></div>
        <h2>{mode === 'login' ? '欢迎回来。' : '在词间，启程。'}</h2>
        <p className="auth-entry-intro">{mode === 'login' ? '翻开今天，接着上次的故事。' : '用一把专属密钥，开启你的学习空间。'}</p>
        <Tabs value={mode} onValueChange={value => {setMode(value as 'login' | 'register'); setError(''); setVisible(false);}} className="auth-mode">
          <TabsList className="auth-mode-tabs" aria-label="账号操作">
            <TabsTrigger value="login" disabled={busy}>登录</TabsTrigger><TabsTrigger value="register" disabled={busy}>注册</TabsTrigger>
          </TabsList>
          <TabsContent value={mode} key={mode} className="auth-fields-panel">
            <form onSubmit={submit} aria-busy={busy}>
              <label className="entry-field" htmlFor={id + '-username'}><span>用户名</span><div className="entry-input"><UserRound size={18}/><input id={id + '-username'} name="username" autoComplete="username" required minLength={3} maxLength={32} placeholder="你的用户名" disabled={busy}/></div></label>
              <label className="entry-field" htmlFor={id + '-password'}><span id={id + '-password-label'}>密码</span><div className="entry-input"><LockKeyhole size={18}/><input id={id + '-password'} aria-labelledby={id + '-password-label'} name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} placeholder={mode === 'login' ? '输入密码' : '至少 12 位，可使用长短语'} disabled={busy}/><button className="entry-password-toggle" type="button" disabled={busy} title={visible ? '隐藏密码' : '显示密码'} aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
              {mode === 'register' && <label className="entry-field" htmlFor={id + '-invitation'}><span>私人注册密钥</span><div className="entry-input"><KeyRound size={18}/><input id={id + '-invitation'} name="invitation" type="password" autoComplete="off" required maxLength={200} placeholder="输入你的专属密钥" disabled={busy}/></div></label>}
              {error && <p role="alert" className="entry-error">{error}</p>}
              <button className="entry-submit" disabled={busy} type="submit">{busy ? <LoaderCircle size={19} className="entry-spinner"/> : mode === 'login' ? <LogIn size={19}/> : <UserRoundPlus size={19}/>}<span>{busy ? '请稍候…' : mode === 'login' ? '登录词间' : '创建我的账号'}</span></button>
            </form>
          </TabsContent>
        </Tabs>
        <p className="auth-entry-note"><KeyRound size={15}/><span>{mode === 'register' ? '密钥仅用于首次注册，之后使用账号密码登录。' : '你的进度与回忆，安放在这里。'}</span></p>
      </section>
    </div>
    <div className="auth-bottom-line"><span className="auth-footer-word"><em>serendipity</em><span>n. 不期而遇的美好</span></span><span>慢一点，也在向前。</span></div>
  </div>;
}
