import { useCallback, useEffect, useRef, useState } from 'react';
import { App as AndroidApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { BookOpen, House, LibraryBig, BarChart3, UserRound, Cloud, CloudOff, RefreshCw, Download, Upload, Settings2, LogOut, Moon, Sun, Monitor, ArrowRight, X, Leaf, ShieldCheck, Volume2, Check, ChevronRight } from 'lucide-react';
import { repository, type LearningSnapshot, type BackupPreview } from './data';
import { native } from './native';
import { ChoicePicker } from './ChoicePicker';
import { TodayView, ReadingView, LibraryView, ReviewView, WordSheet, StatisticsView, type QueueItem } from './Study';
import { allWords, dueItems, type Word } from '@/lib/learning';

type Tab = 'today' | 'reading' | 'library' | 'stats' | 'my';
const tabs = [{id:'today',label:'今日',icon:House},{id:'reading',label:'阅读',icon:BookOpen},{id:'library',label:'词库',icon:LibraryBig},{id:'stats',label:'记录',icon:BarChart3},{id:'my',label:'我的',icon:UserRound}] as const;
const empty: LearningSnapshot = {state:null,user:null,locked:false,revision:0,pending:0,conflicts:[],needsLogin:false,syncing:false,lastSync:0,error:'',hasRecovery:false};
const titles: Record<Tab,string> = {today:'把单词，读进生活。',reading:'在句子里，再遇见。',library:'每一个词，都有来处。',stats:'一点积累，一点熟悉。',my:'让学习适合你。'};
type ImportPreview = {words:Word[];duplicates:number};
const WORD_TEMPLATE = {words:[{id:'personal-serendipity-n',word:'serendipity',pos:'n.',meaning:'意外发现美好事物的运气',collocation:'a moment of serendipity',example:'Finding this quiet bookshop was pure serendipity.',translation:'找到这间安静的书店完全是意外的幸运。',test:'She discovered the old letter through serendipity.',testTranslation:'她因意外的机缘发现了那封旧信。',phonetic:'ˌserənˈdɪpəti',tags:['CET6'],source:'个人补充词表',version:'1',sourceUrl:'',scene:'',mnemonic:'在不经意的一角，遇见好事。',materialStatus:'complete'}]};

export default function App() {
  const [snapshot,setSnapshot] = useState(empty);
  const [loaded,setLoaded] = useState(false);
  const [fatal,setFatal] = useState('');
  const [tab,setTab] = useState<Tab>('today');
  const [word,setWord] = useState<Word|null>(null);
  const [practice,setPractice] = useState<{items:QueueItem[];browse:boolean;key:number}|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const [username,setUsername] = useState('');
  const [password,setPassword] = useState('');
  const [backup,setBackup] = useState<BackupPreview|null>(null);
  const [imports,setImports] = useState<ImportPreview|null>(null);
  const [confirmLogout,setConfirmLogout] = useState(false);
  const [relogin,setRelogin] = useState(false);
  const [exported,setExported] = useState(false);
  const [theme,setTheme] = useState(() => localStorage.getItem('wordweave-mobile-theme') || 'system');
  const saving = useRef(false);
  const retry = useRef<{key:string;operationId:string}|null>(null);
  const nav = useRef({tab,word,practice,backup,imports,confirmLogout,relogin,busy});
  nav.current={tab,word,practice,backup,imports,confirmLogout,relogin,busy};
  const toast = useCallback((text:string) => {setMessage(text);},[]);
  useEffect(() => {if (!message) return; const timer=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(timer);},[message]);
  useEffect(() => {
    const mq=matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>{const dark=theme==='dark'||(theme==='system'&&mq.matches);document.documentElement.classList.toggle('dark',dark);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#192820':'#f5f4ec');};
    localStorage.setItem('wordweave-mobile-theme',theme);apply();mq.addEventListener('change',apply);return()=>mq.removeEventListener('change',apply);
  },[theme]);
  useEffect(() => {
    let mounted=true;
    const unsubscribe=repository.subscribe(s=>{if(mounted)setSnapshot(s);});
    repository.read().then(s=>{if(mounted){setSnapshot(s);setLoaded(true);void repository.sync();}}).catch(e=>{if(mounted){setFatal(e.message);setLoaded(true);}});
    const resume=()=>{if(!document.hidden)void repository.sync();};
    const reconnect=()=>{if(!document.hidden)void repository.sync(true);};
    document.addEventListener('visibilitychange',resume);window.addEventListener('online',reconnect);window.addEventListener('focus',resume);
    const interval=setInterval(resume,45000);
    const listeners = Capacitor.isNativePlatform() ? [AndroidApp.addListener('appStateChange',({isActive})=>{if(isActive)void repository.sync();}),AndroidApp.addListener('backButton',()=>{
      const current=nav.current;
      if(current.busy)return;
      if(!window.dispatchEvent(new Event('ww:back',{cancelable:true})))return;
      if(current.word){setWord(null);return;}
      if(current.backup){setBackup(null);return;}
      if(current.imports){setImports(null);return;}
      if(current.confirmLogout){setConfirmLogout(false);return;}
      if(current.relogin){setRelogin(false);return;}
      if(current.practice){setPractice(null);return;}
      if(current.tab!=='today'){setTab('today');return;}
      void AndroidApp.exitApp();
    })] : [];
    return()=>{mounted=false;unsubscribe();clearInterval(interval);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',reconnect);window.removeEventListener('focus',resume);listeners.forEach(p=>{void p.then(handle=>handle.remove());});};
  },[]);
  const run = async (work:()=>Promise<void>) => {
    if(saving.current)return;
    saving.current=true;setBusy(true);setError('');
    try{await work();}catch(e){setError(e instanceof Error?e.message:'操作未完成，请重试。');}
    finally{saving.current=false;setBusy(false);}
  };
  const dispatch=useCallback(async(action:Record<string,unknown>)=>{
    if(saving.current)return false;
    saving.current=true;setBusy(true);setError('');
    const key=JSON.stringify(action);
    const operationId=retry.current?.key===key?retry.current.operationId:crypto.randomUUID();
    retry.current={key,operationId};
    try{await repository.dispatch({...action,operationId});retry.current=null;void repository.sync();return true;}
    catch(e){setError(e instanceof Error?e.message:'保存失败，输入已保留。');return false;}
    finally{saving.current=false;setBusy(false);}
  },[]);
  const speak=useCallback((text:string)=>{void native.speak({text}).catch(e=>setError(e.message || '朗读不可用，请安装本机英语语音。'));},[]);
  const navigate=(next:Tab)=>{if(busy)return;setWord(null);setPractice(null);setTab(next);window.scrollTo({top:0});};
  const startPractice=(items:QueueItem[],browse=false)=>{if(busy)return;setWord(null);setPractice({items,browse,key:Date.now()});window.scrollTo({top:0});};
  const login=()=>run(async()=>{await repository.login(username.trim(),password);setPassword('');setRelogin(false);toast('账号记录已下载，可以离线学习。');});
  const exportBackup=()=>run(async()=>{const file=repository.exportBackup();if((await native.writeBackup(file)).saved){setExported(true);toast(file.websiteCompatible?'完整备份已保存。':'备份已完整保存，体积超过网站恢复入口限额。');}});
  const readFile=(kind:'backup'|'words')=>run(async()=>{const file=await native.readBackup();if(file.cancelled||!file.text)return;if(kind==='backup')setBackup(repository.previewBackup(file.text));else setImports(repository.previewWords(file.text));});
  const state=snapshot.state;
  const isReady=loaded && !!state && !snapshot.locked && !relogin;
  if(!loaded)return <main className="app-boot"><img src="/icon.svg" alt=""/><p>正在打开你的学习空间…</p></main>;
  if(fatal)return <main className="app-boot"><h1>学习记录暂时无法读取</h1><p>{fatal}</p><p>当前档案未被清空。请保留本机数据。</p><button onClick={()=>location.reload()}>重新打开</button></main>;
  if(!isReady)return <main className="app-login">
    <header className="app-login-brand"><img src="/icon.svg" alt=""/><span>词间<small>WORDWEAVE</small></span></header>
    <div className="app-login-illustration" aria-hidden="true"><div className="app-book"><BookOpen size={68} strokeWidth={1.2}/></div><span className="app-floating-word word-one">remember</span><span className="app-floating-word word-two">encounter</span><Leaf className="app-leaf" size={28}/></div>
    <div className="app-login-copy"><p className="app-eyebrow">A LITTLE EVERY DAY</p><h1>在句子中学单词，<br/>让记忆慢慢生长。</h1><p>登录后，阅读和学习记录都会保存在手机上。<br/>断网也能继续，联网时自动同步。</p></div>
    <form className="app-login-form" onSubmit={e=>{e.preventDefault();void login();}}>
      <h2>{relogin?'重新登录，同步你的积累':'进入你的学习空间'}</h2>
      <label htmlFor="username">词间用户名</label><input id="username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} maxLength={32} placeholder="与你的网站账号相同" required disabled={busy}/>
      <label htmlFor="password">密码</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={12} maxLength={128} required placeholder="输入账号密码" disabled={busy}/>
      {error&&<p className="app-alert" role="alert">{error}</p>}
      <button className="ww-button ww-primary app-login-submit" disabled={busy}>{busy?'正在下载账号记录…':'登录并开始学习'}<ArrowRight size={18}/></button>
      {relogin&&<button type="button" className="ww-button ww-ghost" onClick={()=>setRelogin(false)}>继续本机学习，稍后登录</button>}
      <p className="app-login-note"><ShieldCheck size={15}/>首次需要联网，之后可离线使用。</p>
      <a href="https://wordweave-cet-study.shiw36663.chatgpt.site" target="_blank" rel="noreferrer">打开网站 · 注册与账号管理</a>
      {import.meta.env.DEV&&!Capacitor.isNativePlatform()&&<button type="button" className="app-preview-link" onClick={()=>void run(async()=>{await repository.initializePreview();})}>查看本机界面预览</button>}
    </form><footer>词间 WORDWEAVE · 一点积累，一点熟悉。</footer>
  </main>;
  const props={state:state!,dispatch,busy,onSpeak:speak,onPractice:startPractice};
  const syncLabel=snapshot.syncing?'同步中':snapshot.needsLogin?'需要登录':snapshot.conflicts.length?'待处理冲突':snapshot.pending?`待同步 ${snapshot.pending} 项`:snapshot.error?'连接暂不可用':snapshot.lastSync?'已同步':'已保存在本机';
  return <div className="app-shell">
    <header className="app-header"><div className="app-brand"><img src="/icon.svg" alt=""/><div>词间<span>WORDWEAVE</span></div></div><button className="app-sync" onClick={()=>{navigate('my');}} aria-label="查看同步状态">{snapshot.syncing?<RefreshCw className="app-spin" size={15}/>:snapshot.pending||snapshot.error?<CloudOff size={15}/>:<Cloud size={15}/>}<span>{syncLabel}</span></button></header>
    <div className="app-content">
      <div className={'app-page-title '+(tab==='my'?'':'app-study-title')}><div><span className="app-eyebrow">{practice?'A MOMENT TO REMEMBER':tab==='today'?'YOUR LEARNING SPACE':tabs.find(t=>t.id===tab)?.label+' / WORDWEAVE'}</span><h1>{practice?'给记忆，一次回响。':titles[tab]}</h1></div>{!practice&&<ChoicePicker className="app-level" label="学习词表" description="选择这段时间的学习重点，阅读和今日安排会随词表切换。" variant="compact" disabled={busy} value={state!.settings.level} onChange={level=>void dispatch({type:'settings',settings:{level}})} options={[
        {value:'CET6',label:'六级 CET-6',description:'按六级标签安排词汇学习与辅助阅读',icon:<LibraryBig size={22}/>,badge:`${allWords(state!).filter(item=>item.tags.includes('CET6')).length} 个义项`},
        {value:'CET4',label:'四级 CET-4',description:'按四级标签安排词汇学习与辅助阅读',icon:<BookOpen size={22}/>,badge:`${allWords(state!).filter(item=>item.tags.includes('CET4')).length} 个义项`},
      ]}/>}</div>
      {error&&<div className="app-alert app-alert-row" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={()=>setError('')}><X size={17}/></button></div>}
      {snapshot.needsLogin&&<div className="app-session-note"><span>记录仍保存在本机，重新登录后继续同步。</span><button onClick={()=>setRelogin(true)}>重新登录</button></div>}
      {snapshot.restorePending&&<div className="app-session-note"><span>备份恢复尚待确认，完成后可继续学习。</span><button disabled={busy} onClick={()=>void run(async()=>{await repository.resumeRestore();toast('备份恢复已确认完成。');})}>重试恢复</button></div>}
      <main id="main-content">
        {practice?<ReviewView key={practice.key} {...props} items={practice.items} browse={practice.browse} onDone={()=>{setPractice(null);setTab('today');window.scrollTo({top:0});void native.stopSpeech();}}/>:<>
          {tab==='today'&&<TodayView {...props} onRead={()=>navigate('reading')} onLibrary={()=>navigate('library')} onStats={()=>navigate('stats')}/>}
          {tab==='reading'&&<ReadingView {...props} onWord={setWord}/>}
          {tab==='library'&&<LibraryView {...props} onWord={setWord}/>}
          {tab==='stats'&&<StatisticsView state={state!}/>}
          {tab==='my'&&<div className="app-my">
            <section className="app-profile ww-card"><div className="app-avatar">{snapshot.user?.name[0]||'我'}</div><div><h2>{snapshot.user?.name}</h2><p>你的私人学习空间</p></div><span className="app-profile-badge"><ShieldCheck size={14}/>本机已保存</span></section>
            <section className="ww-card"><div className="app-section-title"><h2><Cloud size={19}/>学习同步</h2><span className="ww-tag">{snapshot.pending} 项待同步</span></div><p>{snapshot.syncing?'正在同步你的学习记录…':snapshot.lastSync?'上次同步：'+new Date(snapshot.lastSync).toLocaleString('zh-CN'):'联网后自动同步，断网期间保存在本机。'}</p>{snapshot.error&&<p className="ww-error">{snapshot.error}</p>}<div className="app-actions"><button className="ww-button ww-secondary" disabled={busy||snapshot.syncing} onClick={()=>void repository.sync(true)}><RefreshCw size={16}/>立即同步</button>{snapshot.needsLogin&&<button className="ww-button ww-primary" onClick={()=>setRelogin(true)}>重新登录</button>}</div><p className="ww-muted">重新打开应用、恢复网络和学习后会尝试同步。离线结果不会因登录到期被清空。</p>
              {snapshot.conflicts.length>0&&<div className="app-conflicts">{snapshot.conflicts.slice(0,10).map(conflict=><article key={conflict.operationId}><strong>{conflict.message}</strong>{conflict.local!==undefined&&<><p>本机联想：{conflict.local||'（空）'}</p><p>云端联想：{conflict.remote||'（空）'}</p></>}{conflict.code!=='generation'?<div className="app-actions">{conflict.local!==undefined&&<button className="ww-button ww-secondary" disabled={busy} onClick={()=>void run(async()=>{await repository.resolveConflict(conflict.operationId,true);})}>使用本机联想</button>}<button className="ww-button ww-ghost" disabled={busy} onClick={()=>void run(async()=>{await repository.resolveConflict(conflict.operationId,false);})}>接受云端，移除此操作</button></div>:null}</article>)}{snapshot.conflicts.some(c=>c.code==='generation')&&<div className="app-actions"><button className="ww-button ww-secondary" disabled={busy} onClick={()=>void exportBackup()}><Download size={16}/>先导出本机成果</button><button className="ww-button ww-primary" disabled={busy||!exported} onClick={()=>void run(async()=>{await repository.reloadAfterRestore();setExported(false);toast('云端记录已载入，旧档案已保留为安全副本。');})}>载入云端记录</button></div>}</div>}
            </section>
            <section className="ww-card"><div className="app-section-title"><h2><Settings2 size={19}/>学习偏好</h2></div>
              <div className="app-setting"><span>词义提示<small>阅读时何时显示中文释义</small></span><ChoicePicker label="词义提示" variant="setting" description="按你的阅读习惯，决定何时看到中文提示。" disabled={busy} value={state!.settings.gloss} onChange={gloss=>void dispatch({type:'settings',settings:{gloss}})} options={[
                {value:'click',label:'点词查看',description:'先独立阅读，遇到生词再点击查看词义'},
                {value:'direct',label:'随句显示',description:'中文释义随句展示，阅读时更容易理解'},
              ]}/></div>
              <div className="app-setting"><span>每日新词上限<small>仅用于新词练习</small></span><ChoicePicker label="每日新词上限" variant="setting" description="新词之外，也给复习留一点时间。调整后用于当天的新词安排。" disabled={busy} value={String(state!.settings.daily)} onChange={daily=>void dispatch({type:'settings',settings:{daily:Number(daily)}})} options={[...new Set([state!.settings.daily,6,10,20,30,40])].sort((a,b)=>a-b).map(n=>({value:String(n),label:`${n} 个词条`,description:n<=10?'轻松安排，慢慢积累':n<=20?'循序积累，兼顾复习':'较多新词，预留充足练习时间'}))}/></div>
              <div className="app-setting"><span>外观<small>保存在这台设备</small></span><ChoicePicker label="外观" variant="setting" description="选择更适合此刻的阅读光线。" disabled={busy} value={theme} onChange={setTheme} options={[
                {value:'light',label:'浅色',description:'温暖米白，搭配柔和的绿色',icon:<Sun size={22}/>},
                {value:'dark',label:'深色',description:'柔和暗色，适合较暗的环境',icon:<Moon size={22}/>},
                {value:'system',label:'跟随系统',description:'随设备的深浅色设置自动切换',icon:<Monitor size={22}/>},
              ]}/></div>
              <button className="app-setting app-setting-button" onClick={()=>void native.openSpeechSettings().catch(e=>setError(e.message))}><span><Volume2 size={16}/>英文朗读设置<small>安装本机英文语音后可离线朗读</small></span><ChevronRight size={18}/></button>
            </section>
            <section className="ww-card"><div className="app-section-title"><h2><Download size={19}/>数据与备份</h2></div><p>备份包含完整学习记录、个人联想和导入词条。恢复会替换账号数据，需联网并先处理待同步记录。</p><div className="app-actions"><button className="ww-button ww-secondary" disabled={busy} onClick={()=>void exportBackup()}><Download size={16}/>导出完整备份</button><button className="ww-button ww-secondary" disabled={busy} onClick={()=>void readFile('backup')}><Upload size={16}/>恢复备份</button>{snapshot.hasRecovery&&<button className="ww-button ww-ghost" disabled={busy} onClick={()=>void run(async()=>{if((await native.writeBackup(repository.exportRecovery())).saved)toast('恢复前安全副本已保存。');})}>导出恢复前副本</button>}</div><div className="app-data-counts"><span>{state!.events.length.toLocaleString()} 次练习</span><span>{allWords(state!).length.toLocaleString()} 个词条</span><span>{state!.custom.length} 个导入义项</span></div></section>
            <section className="ww-card"><div className="app-section-title"><h2><LibraryBig size={19}/>导入词表</h2></div><p>添加你的个人词汇。导入词条可查询和复习，暂不自动编入内置阅读。</p><div className="app-actions"><button className="ww-button ww-secondary" disabled={busy} onClick={()=>void readFile('words')}><Upload size={16}/>选择 JSON 词表</button><button className="ww-button ww-ghost" onClick={()=>void run(async()=>{await native.writeBackup({text:JSON.stringify(WORD_TEMPLATE,null,2),fileName:'词间-词表模板.json'});})}>下载格式模板</button></div></section>
            <section className="ww-card app-about"><img src="/icon.svg" alt=""/><h2>词间 WORDWEAVE</h2><p>在句子里相遇，在回忆中熟悉。</p><small>Android 0.1.2 · 2163 个内置义项 · 61 篇阅读</small><p className="ww-muted">四级现有 89 个带标签义项，六级 2128 个，两级有重叠。阅读接触不代表已掌握。</p><a href="https://wordweave-cet-study.shiw36663.chatgpt.site" target="_blank" rel="noreferrer">打开词间网站<ArrowRight size={14}/></a></section>
            <button className="app-logout" disabled={busy} onClick={()=>setConfirmLogout(true)}><LogOut size={17}/>退出登录</button>
          </div>}
        </>}
      </main><footer className="app-footer">一点积累，一点熟悉。<span>WORDWEAVE</span></footer>
    </div>
    {!practice&&<nav className="app-bottom-nav" aria-label="主导航">{tabs.map(({id,label,icon:Icon})=><button key={id} aria-label={label} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} disabled={busy} onClick={()=>navigate(id)}><span><Icon size={21} strokeWidth={tab===id?2.2:1.8}/></span>{label}</button>)}</nav>}
    {word&&<WordSheet {...props} word={word} onClose={()=>{if(!busy)setWord(null);}}/>}
    {(backup||imports||confirmLogout)&&<div className="app-modal-backdrop" onClick={()=>{if(!busy){setBackup(null);setImports(null);setConfirmLogout(false);}}}><section className="app-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e=>e.stopPropagation()}><div className="app-section-title"><h2 id="modal-title">{backup?'恢复这份备份？':imports?'导入这份词表？':'退出学习账号？'}</h2><button className="ww-icon-button" aria-label="关闭" disabled={busy} onClick={()=>{setBackup(null);setImports(null);setConfirmLogout(false);}}><X size={20}/></button></div>{backup?<><p>{backup.exportedAt?new Date(backup.exportedAt).toLocaleString('zh-CN'):'历史备份'}</p><div className="app-data-counts"><span>{backup.eventCount} 次练习</span><span>{backup.readingCount} 篇已读</span><span>{backup.customCount} 个导入义项</span></div><p>这将替换手机与网站的账号记录。请先导出当前备份，并确认待同步记录已处理。</p></>:imports?<><p>{imports.words.length} 个词条，{imports.duplicates} 个已有义项将按词义去重。</p><p>会保存来源和版本，已有内置内容不会被替换。</p><ul className="app-import-list">{imports.words.slice(0,5).map(w=><li key={w.id}><strong>{w.word}</strong><span>{w.meaning}</span></li>)}</ul></>:<p>本机档案会保留并锁定，再次登录同一账号后可继续。仍有 {snapshot.pending} 项待同步记录。</p>}{error&&<p className="ww-error" role="alert">{error}</p>}<div className="app-actions">{backup&&<button className="ww-button ww-secondary" disabled={busy} onClick={()=>void exportBackup()}>先导出当前备份</button>}<button className="ww-button ww-primary" disabled={busy} onClick={()=>{if(backup)void run(async()=>{await repository.restore(backup);setBackup(null);toast('备份已恢复并同步。');});else if(imports)void dispatch({type:'import',words:imports.words}).then(ok=>{if(ok){setImports(null);toast('词表已导入并保存在本机。');}});else void run(async()=>{await repository.logout();setConfirmLogout(false);});}}>{busy?'正在处理…':backup?'确认恢复':imports?'确认导入':'确认退出'}</button></div></section></div>}
    {message&&<div className="app-toast" role="status"><Check size={17}/>{message}</div>}
  </div>;
}
