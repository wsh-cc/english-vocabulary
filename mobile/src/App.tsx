import { memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { App as AndroidApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { BookOpen, House, LibraryBig, BarChart3, UserRound, Cloud, CloudOff, RefreshCw, Download, Upload, Settings2, LogOut, ArrowRight, X, Leaf, ShieldCheck, Volume2, Check, ChevronRight } from 'lucide-react';
import { repository, type LearningSnapshot, type BackupPreview } from './data';
import { native } from './native';
import { ChoicePicker } from './ChoicePicker';
import { TodayView, ReadingView, LibraryView, ReviewView, WordSheet, StatisticsView, type QueueItem } from './Study';
import { allWords, dueItems, type Word } from '@/lib/learning';
import { Page, PageStack, Presence, type PageStackHandle } from './Motion';
import { StudyCacheProvider } from './StudyCache';
import { PersonalPage, PersonalDetail, type PersonalSection } from './PersonalPage';
import { defaultProfile, type PersonalProfile } from './profile';
import { FriendsPage } from './FriendsPage';
import { FriendsService } from './friends';
import { AppearancePage, appearanceOptions } from './Appearance';

const TodayPage = memo(TodayView);
const ReadingPage = memo(ReadingView);
const LibraryPage = memo(LibraryView);
const StatisticsPage = memo(StatisticsView);

type Tab = 'today' | 'reading' | 'library' | 'stats' | 'my';
const tabs = [{id:'today',label:'今日',icon:House},{id:'reading',label:'阅读',icon:BookOpen},{id:'library',label:'词库',icon:LibraryBig},{id:'stats',label:'记录',icon:BarChart3},{id:'my',label:'我的',icon:UserRound}] as const;
const empty: LearningSnapshot = {profile:defaultProfile(),state:null,user:null,locked:false,revision:0,pending:0,conflicts:[],needsLogin:false,syncing:false,lastSync:0,error:'',hasRecovery:false};
const titles: Record<Tab,string> = {today:'把单词，读进生活。',reading:'在句子里，再遇见。',library:'每一个词，都有来处。',stats:'一点积累，一点熟悉。',my:'让学习适合你。'};
type ImportPreview = {words:Word[];duplicates:number};
const WORD_TEMPLATE = {words:[{id:'personal-serendipity-n',word:'serendipity',pos:'n.',meaning:'意外发现美好事物的运气',collocation:'a moment of serendipity',example:'Finding this quiet bookshop was pure serendipity.',translation:'找到这间安静的书店完全是意外的幸运。',test:'She discovered the old letter through serendipity.',testTranslation:'她因意外的机缘发现了那封旧信。',phonetic:'ˌserənˈdɪpəti',tags:['CET6'],source:'个人补充词表',version:'1',sourceUrl:'',scene:'',mnemonic:'在不经意的一角，遇见好事。',materialStatus:'complete'}]};

export default function App() {
  const [snapshot,setSnapshot] = useState(empty);
  const [loaded,setLoaded] = useState(false);
  const [fatal,setFatal] = useState('');
  const [tab,setTab] = useState<Tab>('today');
  const contentTab = useDeferredValue(tab);
  const [personalSection,setPersonalSection] = useState<PersonalSection>('home');
  const personalOrigin = useRef<HTMLElement|null>(null);
  const personalFocus = useRef<PersonalSection|null>(null);
  useEffect(()=>{if(contentTab!=='my')setPersonalSection('home');},[contentTab]);
  const pageStack = useRef<PageStackHandle>(null);
  const [word,setWord] = useState<Word|null>(null);
  const [practice,setPractice] = useState<{items:QueueItem[];browse:boolean;key:number}|null>(null);
  const [retainedPractice,setRetainedPractice] = useState(practice);
  useLayoutEffect(()=>{if(practice)setRetainedPractice(practice);},[practice]);
  const renderedPractice=practice??retainedPractice;
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
  const nav = useRef({tab,word,practice,backup,imports,confirmLogout,relogin,busy,personalSection});
  nav.current={tab,word,practice,backup,imports,confirmLogout,relogin,busy,personalSection};
  const releasePractice = useCallback(()=>{if(!nav.current.practice)setRetainedPractice(null);},[]);
  const toast = useCallback((text:string) => {setMessage(text);},[]);
  useEffect(() => {if (!message) return; const timer=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(timer);},[message]);
  useEffect(() => {
    const mq=matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>{const dark=theme==='dark'||(theme==='system'&&mq.matches);document.documentElement.classList.toggle('dark',dark);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#192820':'#f6f7f4');void native.setAppearance({theme}).catch(error=>console.warn('System appearance could not be updated',error));};
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
      if(current.practice){pageStack.current?.captureScroll();setPractice(null);void native.stopSpeech();return;}
      if(current.tab!=='today'){pageStack.current?.captureScroll();setTab('today');return;}
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
  const navigate=useCallback((next:Tab)=>{if(saving.current||nav.current.tab===next&&!nav.current.practice&&(next!=='my'||nav.current.personalSection==='home'))return;personalFocus.current=null;pageStack.current?.captureScroll();setWord(null);setPractice(null);if(next==='my')setPersonalSection('home');setTab(next);},[]);
  const openPersonalSection=useCallback((section:PersonalSection)=>{if(saving.current)return;pageStack.current?.captureScroll();if(section!=='home')personalOrigin.current=document.activeElement instanceof HTMLElement&&document.activeElement.closest('.personal-home')?document.activeElement:null;personalFocus.current=section;setWord(null);if(nav.current.practice){setPractice(null);void native.stopSpeech();}setPersonalSection(section);setTab('my');},[]);
  const personalHome=useCallback(()=>openPersonalSection('home'),[openPersonalSection]);
  useLayoutEffect(()=>{
    if(contentTab!=='my'||practice||personalFocus.current!==personalSection)return;
    const target=personalSection==='home'?(personalOrigin.current?.isConnected?personalOrigin.current:document.querySelector<HTMLElement>('.personal-heading h1')):document.querySelector<HTMLElement>('.app-view[data-active] :is(.personal-detail-heading,.friends-heading) h1');
    if(target){target.focus({preventScroll:true});personalFocus.current=null;}
  },[contentTab,personalSection,practice]);
  const saveProfile=useCallback(async(profile:PersonalProfile)=>{if(saving.current)throw Error('正在保存，请稍后重试。');saving.current=true;setBusy(true);try{await repository.saveProfile(profile);toast('个人资料已保存到此设备。');}finally{saving.current=false;setBusy(false);}},[toast]);
  useEffect(()=>{
    const back=(event:Event)=>{const current=nav.current;if(event.defaultPrevented||current.busy||current.tab!=='my'||current.personalSection==='home'||document.querySelector('[data-ww-overlay], .app-modal-backdrop'))return;event.preventDefault();personalHome();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')back(event);};
    window.addEventListener('ww:back',back);document.addEventListener('keydown',key);return()=>{window.removeEventListener('ww:back',back);document.removeEventListener('keydown',key);};
  },[personalHome]);
  const startPractice=useCallback((items:QueueItem[],browse=false)=>{if(saving.current)return;pageStack.current?.captureScroll();pageStack.current?.resetScroll('practice');setWord(null);setPractice({items,browse,key:Date.now()});},[]);
  const read=useCallback(()=>navigate('reading'),[navigate]);
  const library=useCallback(()=>navigate('library'),[navigate]);
  const stats=useCallback(()=>navigate('stats'),[navigate]);
  const finishPractice=useCallback(()=>{pageStack.current?.captureScroll();startTransition(()=>{setPractice(null);setTab('today');});void native.stopSpeech();},[]);
  const login=()=>run(async()=>{await repository.login(username.trim(),password);setPassword('');setRelogin(false);toast('账号记录已下载，可以离线学习。');});
  const exportBackup=()=>run(async()=>{const file=repository.exportBackup();if((await native.writeBackup(file)).saved){setExported(true);toast(file.websiteCompatible?'完整备份已保存。':'备份已完整保存，体积超过网站恢复入口限额。');}});
  const readFile=(kind:'backup'|'words')=>run(async()=>{const file=await native.readBackup();if(file.cancelled||!file.text)return;if(kind==='backup')setBackup(repository.previewBackup(file.text));else setImports(repository.previewWords(file.text));});
  const state=snapshot.state;
  const wordCounts=useMemo(()=>{
    const words=state?allWords(state):[];
    return {CET6:words.filter(item=>item.tags.includes('CET6')).length,CET4:words.filter(item=>item.tags.includes('CET4')).length};
  },[state?.custom]);
  const isReady=loaded && !!state && !snapshot.locked && !relogin;
  const [friendsService,setFriendsService]=useState<FriendsService|null>(null);
  useEffect(()=>{
    if(!isReady||!snapshot.user?.userId){setFriendsService(null);return;}
    const service=new FriendsService(snapshot.user.userId);
    setFriendsService(service);
    return()=>service.dispose();
  },[isReady,snapshot.user?.userId]);
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
  return <StudyCacheProvider key={snapshot.user?.userId} state={state!}><div className="app-shell">
    <header className="app-header"><div className="app-brand"><img src="/icon.svg" alt=""/><div>词间<span>WORDWEAVE</span></div></div><button className="app-sync" onClick={()=>{openPersonalSection('sync');}} aria-label="查看同步状态">{snapshot.syncing?<RefreshCw className="app-spin" size={15}/>:snapshot.pending||snapshot.error?<CloudOff size={15}/>:<Cloud size={15}/>}<span>{syncLabel}</span></button></header>
    <div className="app-content">
      {contentTab!=='my'&&(<div className="app-page-title app-study-title"><div><span className="app-eyebrow">{practice?'A MOMENT TO REMEMBER':contentTab==='today'?'YOUR LEARNING SPACE':tabs.find(t=>t.id===contentTab)?.label+' / WORDWEAVE'}</span><h1>{practice?'给记忆，一次回响。':titles[contentTab]}</h1></div>{!practice&&<ChoicePicker className="app-level" label="学习词表" description="选择这段时间的学习重点，阅读和今日安排会随词表切换。" variant="compact" disabled={busy} value={state!.settings.level} onChange={level=>void dispatch({type:'settings',settings:{level}})} options={[
        {value:'CET6',label:'六级 CET-6',description:'按六级标签安排词汇学习与辅助阅读',icon:<LibraryBig size={22}/>,badge:`${wordCounts.CET6} 个义项`},
        {value:'CET4',label:'四级 CET-4',description:'按四级标签安排词汇学习与辅助阅读',icon:<BookOpen size={22}/>,badge:`${wordCounts.CET4} 个义项`},
      ]}/>}</div>)}
      {error&&<div className="app-alert app-alert-row" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={()=>setError('')}><X size={17}/></button></div>}
      {snapshot.needsLogin&&<div className="app-session-note"><span>记录仍保存在本机，重新登录后继续同步。</span><button onClick={()=>setRelogin(true)}>重新登录</button></div>}
      {snapshot.restorePending&&<div className="app-session-note"><span>备份恢复尚待确认，完成后可继续学习。</span><button disabled={busy} onClick={()=>void run(async()=>{await repository.resumeRestore();toast('备份恢复已确认完成。');})}>重试恢复</button></div>}
      <main id="main-content">
        <PageStack ref={pageStack} active={practice?'practice':contentTab==='my'&&personalSection!=='home'?`my-${personalSection}`:contentTab} onSettled={releasePractice}>
          <Page id="today"><TodayPage {...props} onRead={read} onLibrary={library} onStats={stats}/></Page>
          <Page id="reading"><ReadingPage {...props} onWord={setWord}/></Page>
          <Page id="library"><LibraryPage {...props} onWord={setWord}/></Page>
          <Page id="stats"><StatisticsPage state={state!}/></Page>
          <Page id="my"><PersonalPage snapshot={snapshot} busy={busy} syncLabel={syncLabel} theme={theme} onSection={openPersonalSection} onStats={stats} onRead={read} onSave={saveProfile}/></Page>
          <Page id="my-appearance" retain={false}><PersonalDetail title="主题外观" subtitle="把喜欢的光线，留在阅读里。" onBack={personalHome} busy={busy}><AppearancePage value={theme} onChange={setTheme} disabled={busy}/></PersonalDetail></Page>
          <Page id="my-friends" retain={false}>{friendsService?.userId===snapshot.user?.userId&&friendsService&&<FriendsPage userId={snapshot.user!.userId} localProfile={snapshot.profile} service={friendsService} onBack={personalHome} onLogin={()=>setRelogin(true)}/>}</Page>
          <Page id="my-settings" retain={false}><PersonalDetail title="学习偏好" subtitle="找到适合自己的学习节奏。" onBack={personalHome} busy={busy}>
            <section className="ww-card"><div className="app-section-title"><h2><Settings2 size={19}/>学习偏好</h2></div>
              <div className="app-setting"><span>学习词表<small>阅读与复习的学习重点</small></span><ChoicePicker className="personal-level" label="学习词表" description="选择这段时间的学习重点，阅读和今日安排会随词表切换。" variant="setting" disabled={busy} value={state!.settings.level} onChange={level=>void dispatch({type:'settings',settings:{level}})} options={[
        {value:'CET6',label:'六级 CET-6',description:'按六级标签安排词汇学习与辅助阅读',icon:<LibraryBig size={22}/>,badge:`${wordCounts.CET6} 个义项`},
        {value:'CET4',label:'四级 CET-4',description:'按四级标签安排词汇学习与辅助阅读',icon:<BookOpen size={22}/>,badge:`${wordCounts.CET4} 个义项`},
      ]}/></div>
              <div className="app-setting"><span>词义提示<small>阅读时何时显示中文释义</small></span><ChoicePicker label="词义提示" variant="setting" description="按你的阅读习惯，决定何时看到中文提示。" disabled={busy} value={state!.settings.gloss} onChange={gloss=>void dispatch({type:'settings',settings:{gloss}})} options={[
                {value:'click',label:'点词查看',description:'先独立阅读，遇到生词再点击查看词义'},
                {value:'direct',label:'随句显示',description:'中文释义随句展示，阅读时更容易理解'},
              ]}/></div>
              <div className="app-setting"><span>每日新词上限<small>仅用于新词练习</small></span><ChoicePicker label="每日新词上限" variant="setting" description="新词之外，也给复习留一点时间。调整后用于当天的新词安排。" disabled={busy} value={String(state!.settings.daily)} onChange={daily=>void dispatch({type:'settings',settings:{daily:Number(daily)}})} options={[...new Set([state!.settings.daily,6,10,20,30,40])].sort((a,b)=>a-b).map(n=>({value:String(n),label:`${n} 个词条`,description:n<=10?'轻松安排，慢慢积累':n<=20?'循序积累，兼顾复习':'较多新词，预留充足练习时间'}))}/></div>
              <div className="app-setting"><span>外观<small>保存在这台设备</small></span><ChoicePicker label="外观" variant="setting" description="选择更适合此刻的阅读光线。" disabled={busy} value={theme} onChange={setTheme} options={appearanceOptions}/></div>
              <button className="app-setting app-setting-button" onClick={()=>void native.openSpeechSettings().catch(e=>setError(e.message))}><span><Volume2 size={16}/>英文朗读设置<small>安装本机英文语音后可离线朗读</small></span><ChevronRight size={18}/></button>
            </section>
          </PersonalDetail></Page>
          <Page id="my-sync" retain={false}><PersonalDetail title="同步与账号" subtitle="让每一点积累，安心留在这里。" onBack={personalHome} busy={busy}>
            <section className="ww-card personal-account"><ShieldCheck size={22}/><div><h2>当前登录账号</h2><p>{snapshot.user?.name}</p><small>个人昵称不会改变登录用户名。</small></div></section>
            <section className="ww-card"><div className="app-section-title"><h2><Cloud size={19}/>学习同步</h2><span className="ww-tag">{snapshot.pending} 项待同步</span></div><p>{snapshot.syncing?'正在同步你的学习记录…':snapshot.lastSync?'上次同步：'+new Date(snapshot.lastSync).toLocaleString('zh-CN'):'联网后自动同步，断网期间保存在本机。'}</p>{snapshot.error&&<p className="ww-error">{snapshot.error}</p>}<div className="app-actions"><button className="ww-button ww-secondary" disabled={busy||snapshot.syncing} onClick={()=>void repository.sync(true)}><RefreshCw size={16}/>立即同步</button>{snapshot.needsLogin&&<button className="ww-button ww-primary" onClick={()=>setRelogin(true)}>重新登录</button>}</div><p className="ww-muted">重新打开应用、恢复网络和学习后会尝试同步。离线结果不会因登录到期被清空。</p>
              {snapshot.conflicts.length>0&&<div className="app-conflicts">{snapshot.conflicts.slice(0,10).map(conflict=><article key={conflict.operationId}><strong>{conflict.message}</strong>{conflict.local!==undefined&&<><p>本机联想：{conflict.local||'（空）'}</p><p>云端联想：{conflict.remote||'（空）'}</p></>}{conflict.code!=='generation'?<div className="app-actions">{conflict.local!==undefined&&<button className="ww-button ww-secondary" disabled={busy} onClick={()=>void run(async()=>{await repository.resolveConflict(conflict.operationId,true);})}>使用本机联想</button>}<button className="ww-button ww-ghost" disabled={busy} onClick={()=>void run(async()=>{await repository.resolveConflict(conflict.operationId,false);})}>接受云端，移除此操作</button></div>:null}</article>)}{snapshot.conflicts.some(c=>c.code==='generation')&&<div className="app-actions"><button className="ww-button ww-secondary" disabled={busy} onClick={()=>void exportBackup()}><Download size={16}/>先导出本机成果</button><button className="ww-button ww-primary" disabled={busy||!exported} onClick={()=>void run(async()=>{await repository.reloadAfterRestore();setExported(false);toast('云端记录已载入，旧档案已保留为安全副本。');})}>载入云端记录</button></div>}</div>}
            </section>
            <button className="app-logout" disabled={busy} onClick={()=>setConfirmLogout(true)}><LogOut size={17}/>退出登录</button>
          </PersonalDetail></Page>
          <Page id="my-data" retain={false}><PersonalDetail title="数据与备份" subtitle="整理自己的词库，保存学习的足迹。" onBack={personalHome} busy={busy}>
            <section className="ww-card"><div className="app-section-title"><h2><Download size={19}/>数据与备份</h2></div><p>备份包含完整学习记录、个人联想和导入词条。恢复会替换账号数据，需联网并先处理待同步记录。</p><div className="app-actions"><button className="ww-button ww-secondary" disabled={busy} onClick={()=>void exportBackup()}><Download size={16}/>导出完整备份</button><button className="ww-button ww-secondary" disabled={busy} onClick={()=>void readFile('backup')}><Upload size={16}/>恢复备份</button>{snapshot.hasRecovery&&<button className="ww-button ww-ghost" disabled={busy} onClick={()=>void run(async()=>{if((await native.writeBackup(repository.exportRecovery())).saved)toast('恢复前安全副本已保存。');})}>导出恢复前副本</button>}</div><div className="app-data-counts"><span>{state!.events.length.toLocaleString()} 次练习</span><span>{allWords(state!).length.toLocaleString()} 个词条</span><span>{state!.custom.length} 个导入义项</span></div></section>
            <section className="ww-card"><div className="app-section-title"><h2><LibraryBig size={19}/>导入词表</h2></div><p>添加你的个人词汇。导入词条可查询和复习，暂不自动编入内置阅读。</p><div className="app-actions"><button className="ww-button ww-secondary" disabled={busy} onClick={()=>void readFile('words')}><Upload size={16}/>选择 JSON 词表</button><button className="ww-button ww-ghost" onClick={()=>void run(async()=>{await native.writeBackup({text:JSON.stringify(WORD_TEMPLATE,null,2),fileName:'词间-词表模板.json'});})}>下载格式模板</button></div></section>
          </PersonalDetail></Page>
          <Page id="my-about" retain={false}><PersonalDetail title="关于词间" subtitle="在句子里相遇，在回忆中熟悉。" onBack={personalHome} busy={busy}>
            <section className="ww-card app-about"><img src="/icon.svg" alt=""/><h2>词间 WORDWEAVE</h2><p>在句子里相遇，在回忆中熟悉。</p><small>Android 0.1.12 · 2463 个内置义项 · 71 篇阅读</small><p className="ww-muted">四级现有 389 个带标签义项，六级 2128 个，两级有重叠。阅读接触不代表已掌握。</p><a href="https://wordweave-cet-study.shiw36663.chatgpt.site" target="_blank" rel="noreferrer">打开词间网站<ArrowRight size={14}/></a></section>
          </PersonalDetail></Page>
          <Page id="practice" retain={false}>{renderedPractice&&<ReviewView key={renderedPractice.key} {...props} items={renderedPractice.items} browse={renderedPractice.browse} onDone={finishPractice}/>}</Page>
        </PageStack>
      </main><footer className="app-footer">一点积累，一点熟悉。<span>WORDWEAVE</span></footer>
    </div>
    {!practice&&<nav className="app-bottom-nav" aria-label="主导航">{tabs.map(({id,label,icon:Icon})=><button key={id} aria-label={label} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} disabled={busy} onClick={()=>navigate(id)}><span><Icon size={21} strokeWidth={tab===id?2.2:1.8}/></span>{label}</button>)}</nav>}
    <Presence show={!!word} portal>{word&&<WordSheet {...props} word={word} onClose={()=>{if(!busy)setWord(null);}}/>}</Presence>
    <Presence show={!!(backup||imports||confirmLogout)} portal><div className="app-modal-backdrop" onClick={()=>{if(!busy){setBackup(null);setImports(null);setConfirmLogout(false);}}}><section className="app-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e=>e.stopPropagation()}><div className="app-section-title"><h2 id="modal-title">{backup?'恢复这份备份？':imports?'导入这份词表？':'退出学习账号？'}</h2><button className="ww-icon-button" aria-label="关闭" disabled={busy} onClick={()=>{setBackup(null);setImports(null);setConfirmLogout(false);}}><X size={20}/></button></div>{backup?<><p>{backup.exportedAt?new Date(backup.exportedAt).toLocaleString('zh-CN'):'历史备份'}</p><div className="app-data-counts"><span>{backup.eventCount} 次练习</span><span>{backup.readingCount} 篇已读</span><span>{backup.customCount} 个导入义项</span></div><p>这将替换手机与网站的账号记录。请先导出当前备份，并确认待同步记录已处理。</p></>:imports?<><p>{imports.words.length} 个词条，{imports.duplicates} 个已有义项将按词义去重。</p><p>会保存来源和版本，已有内置内容不会被替换。</p><ul className="app-import-list">{imports.words.slice(0,5).map(w=><li key={w.id}><strong>{w.word}</strong><span>{w.meaning}</span></li>)}</ul></>:<p>本机档案会保留并锁定，再次登录同一账号后可继续。仍有 {snapshot.pending} 项待同步记录。</p>}{error&&<p className="ww-error" role="alert">{error}</p>}<div className="app-actions">{backup&&<button className="ww-button ww-secondary" disabled={busy} onClick={()=>void exportBackup()}>先导出当前备份</button>}<button className="ww-button ww-primary" disabled={busy} onClick={()=>{if(backup)void run(async()=>{await repository.restore(backup);setBackup(null);toast('备份已恢复并同步。');});else if(imports)void dispatch({type:'import',words:imports.words}).then(ok=>{if(ok){setImports(null);toast('词表已导入并保存在本机。');}});else void run(async()=>{await repository.logout();setConfirmLogout(false);});}}>{busy?'正在处理…':backup?'确认恢复':imports?'确认导入':'确认退出'}</button></div></section></div></Presence>
    {message&&<div className="app-toast" role="status"><Check size={17}/>{message}</div>}
  </div></StudyCacheProvider>;
}
