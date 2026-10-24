'use client';

import { useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronRight, Coffee, Database, ImagePlus, Leaf, Mountain, Palette, Pencil, Settings2, Sun, Users, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { readingPassages } from '@/lib/curriculum';
import { seedWords, type State } from '@/lib/learning';
import { profileSchema, type PersonalProfile, type ProfileAvatar } from '@/mobile/src/profile';
import { WebAvatarPhoto } from './avatar-photo';
import { browserProfileIdentity, readBrowserProfile, readBrowserProfileDraft, saveBrowserProfile, saveBrowserProfileDraft, useBrowserProfile } from './browser-profile';
import './personal.css';

export { browserProfileIdentity, readBrowserProfile, useBrowserProfile } from './browser-profile';
export type { PersonalProfile } from './browser-profile';

const wordIds = new Set(seedWords.map(word => word.id));
const passageIds = new Set(readingPassages.map(passage => passage.id));
export function personalTotals(state: State) {
  return {
    passages: Object.keys(state.reading?.completed ?? {}).filter(id => passageIds.has(id)).length,
    encountered: Object.entries(state.reading?.encounters ?? {}).filter(([id, value]) => wordIds.has(id) && value.count > 0).length,
    practices: state.events.length,
  };
}

const avatars = [
  { id: 'initial', label: '首字', Icon: null }, { id: 'book', label: '书页', Icon: BookOpen },
  { id: 'sprout', label: '新芽', Icon: Leaf }, { id: 'sun', label: '晨光', Icon: Sun },
  { id: 'mountain', label: '远山', Icon: Mountain }, { id: 'coffee', label: '咖啡', Icon: Coffee },
] as const;

export function PersonalAvatar({ kind, name, photo }: { kind: ProfileAvatar; name: string; photo?: string }) {
  const Icon = avatars.find(avatar => avatar.id === kind)?.Icon;
  // The saved avatar is an already compressed, local 128 px data URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="web-personal-avatar" aria-hidden="true">{kind === 'custom' && photo ? <img src={photo} alt=""/> : Icon ? <Icon size={30} strokeWidth={1.5}/> : [...name][0] || '我'}</span>;
}

function Entry({ icon, title, detail, onClick, disabled }: { icon: ReactNode; title: string; detail: string; onClick: () => void; disabled: boolean }) {
  const descriptionId = useId();
  return <button type="button" className="web-personal-entry" aria-label={title} aria-describedby={descriptionId} onClick={onClick} disabled={disabled}>
    <span className="web-personal-entry-icon" aria-hidden="true">{icon}</span><span className="web-personal-entry-copy"><strong>{title}</strong><small id={descriptionId}>{detail}</small></span><ChevronRight size={18} aria-hidden="true"/>
  </button>;
}

export type PersonalProps = {
  state: State; username: string; userId?: string; busy: boolean;
  onSettings: () => void; onBackup: () => void; onRead: () => void; onStats: () => void;
  onFriends: (profile: PersonalProfile) => void; onAppearance: () => void;
};

const subscribeHydration = () => () => {};
export function Personal(props: PersonalProps) {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const identity = browserProfileIdentity(props.username, props.userId);
  if (!hydrated) return <div className="web-personal-home" role="status">正在打开个人空间…</div>;
  return <PersonalAccount key={identity} {...props} identity={identity}/>;
}
export default Personal;

function PersonalAccount({ state, username, busy, onSettings, onBackup, onRead, onStats, onFriends, onAppearance, identity }: PersonalProps & { identity: string }) {
  const profile = useBrowserProfile(identity);
  const totals = useMemo(() => personalTotals(state), [state]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PersonalProfile>(() => readBrowserProfileDraft(identity) ?? readBrowserProfile(identity));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const savingRef = useRef(false);
  const [photoView, setPhotoView] = useState<{ draft: boolean; file?: File } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const dirty = draft.nickname !== profile.nickname || draft.signature !== profile.signature || draft.avatar !== profile.avatar || draft.avatarDataUrl !== profile.avatarDataUrl;
  const name = profile.nickname || username || '学习者';
  const hasLearning = totals.passages + totals.encountered + totals.practices > 0;

  function updateDraft(value: PersonalProfile) {
    setDraft(value);
    try { saveBrowserProfileDraft(identity, value); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '草稿未能保存在浏览器中。'); }
  }
  function edit() {
    if (!dirty) setDraft({ ...profile });
    setError(''); setMessage(''); setEditing(true);
  }
  function choosePhoto(file?: File) {
    if (!file || savingRef.current || busy) return;
    setPhotoView({ draft: true, file });
    if (photoInput.current) photoInput.current.value = '';
  }
  async function applyPhoto(avatarDataUrl: string) {
    if (photoView?.draft) { updateDraft({ ...draft, avatar: 'custom', avatarDataUrl }); return; }
    const saved = saveBrowserProfile(identity, { ...profile, avatar: 'custom', avatarDataUrl });
    const nextDraft = dirty ? { ...draft, avatar: 'custom' as const, avatarDataUrl } : saved;
    updateDraft(nextDraft);
    setMessage('头像已保存到当前浏览器。');
  }
  async function save() {
    if (savingRef.current || busy || photoView) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const parsed = profileSchema.safeParse(draft);
      if (!parsed.success) throw Error(parsed.error.issues[0].message);
      const saved = saveBrowserProfile(identity, parsed.data);
      setDraft(saved); setEditing(false); setMessage('个人资料已保存到当前浏览器。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '资料未保存，输入已保留，请重试。'); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <div className="web-personal-home">
    <header className="web-personal-heading"><span className="eyebrow">A SPACE OF YOUR OWN</span><h1>我的学习空间</h1><p>把每一点积累，留给更好的自己。</p></header>
    <div className="web-personal-grid">
      <div className="web-personal-overview">
        <section className="web-personal-identity" aria-label="个人资料">
          <div className="web-personal-identity-top"><button type="button" className="web-personal-avatar-trigger" aria-label="查看个人头像" onClick={() => setPhotoView({ draft: false })} disabled={busy}><PersonalAvatar kind={profile.avatar} photo={profile.avatarDataUrl} name={name}/></button><div className="web-personal-name"><h2>{name}</h2><span>词间学习者</span></div><button type="button" className="web-personal-edit" aria-label="编辑个人资料" onClick={edit} disabled={busy}><Pencil size={15}/><span>编辑</span></button></div>
          <p className="web-personal-signature">{profile.signature || '在句子里相遇，在回忆中熟悉。'}</p>
          <div className="web-personal-identity-foot"><span><Leaf size={14}/>一点积累，一点熟悉</span>{dirty && <small>有未保存的资料草稿</small>}</div>
        </section>
        <section className="web-personal-progress" aria-labelledby="web-personal-progress-title">
          <div className="web-personal-section-heading"><h2 id="web-personal-progress-title">学习的足迹</h2><button type="button" onClick={onStats} disabled={busy}>查看记录<ArrowUpRight size={15}/></button></div>
          <dl className="web-personal-totals"><div><dt>已读篇数</dt><dd data-profile-total="passages">{totals.passages.toLocaleString()}</dd></div><div><dt>接触词数</dt><dd data-profile-total="encountered">{totals.encountered.toLocaleString()}</dd></div><div><dt>练习次数</dt><dd data-profile-total="practices">{totals.practices.toLocaleString()}</dd></div></dl>
          {hasLearning ? <p className="web-personal-caption">累计全部学习记录 · 阅读接触不代表已掌握</p> : <div className="web-personal-empty"><p>还没有学习足迹，从一篇阅读开始吧。</p><button type="button" onClick={onRead} disabled={busy}>开始阅读<ChevronRight size={14}/></button></div>}
        </section>
      </div>
      <section className="web-personal-entries" aria-label="个人主页功能">
        <Entry icon={<Palette size={21}/>} title="主题外观" detail="选择舒服的阅读光线" onClick={onAppearance} disabled={busy}/>
        <Entry icon={<Users size={21}/>} title="我的好友" detail="和好友一起，慢慢积累" onClick={() => onFriends(profile)} disabled={busy}/>
        <Entry icon={<Settings2 size={21}/>} title="学习偏好" detail={`${state.settings.level === 'CET4' ? '四级' : '六级'}词表 · 每日 ${state.settings.daily} 个新词`} onClick={onSettings} disabled={busy}/>
        <Entry icon={<Database size={21}/>} title="数据与备份" detail="导出、恢复与跨端学习记录" onClick={onBackup} disabled={busy}/>
      </section>
    </div>
    <p className="web-personal-browser-note">头像、昵称与签名只保存在当前浏览器，不包含在学习备份中。好友展示需在「我的好友」中主动发布。</p>
    {message && <p className="web-personal-status" role="status"><Check size={15}/>{message}</p>}
    <p className="web-personal-home-note">按照自己的节奏，慢慢来。</p>

    <Dialog open={editing} onOpenChange={open => { if (!savingRef.current && !busy && !photoView) setEditing(open); }}>
      <DialogContent className="web-personal-dialog" showCloseButton={false}>
        <div className="web-personal-dialog-heading"><DialogTitle>编辑个人资料</DialogTitle><button type="button" className="web-personal-icon-button" aria-label="关闭资料编辑" disabled={saving || busy || !!photoView} onClick={() => setEditing(false)}><X size={20}/></button></div>
        <DialogDescription>头像、昵称和签名只保存在当前浏览器。关闭编辑会保留草稿。</DialogDescription>
        <form className="web-personal-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="web-personal-form-intro"><button type="button" className="web-personal-avatar-trigger" aria-label="查看草稿头像" disabled={saving || busy} onClick={() => setPhotoView({ draft: true })}><PersonalAvatar kind={draft.avatar} photo={draft.avatarDataUrl} name={draft.nickname || username || '我'}/></button><div><h2>让这里，更像你</h2><p>写下此刻的自己。</p></div></div>
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像照片" hidden onChange={event => choosePhoto(event.target.files?.[0])}/>
          <button type="button" className="web-personal-button web-personal-secondary web-personal-photo-button" onClick={() => photoInput.current?.click()} disabled={saving || busy || !!photoView}><ImagePlus size={18}/>选择头像照片</button>
          <p className="web-personal-field-hint">支持 JPG、PNG、WebP，最大 10 MB。选择后可拖动、缩放或用方向键调整取景。</p>
          <fieldset className="web-personal-avatar-picker" disabled={saving || busy || !!photoView}><legend>或选择内置头像</legend><div role="radiogroup" aria-label="选择头像" onKeyDown={event => {
            const index = avatars.findIndex(avatar => avatar.id === draft.avatar);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? avatars.length - 1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % avatars.length : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (Math.max(index, 0) + avatars.length - 1) % avatars.length : -1;
            if (next < 0 || saving || busy || photoView) return;
            event.preventDefault(); updateDraft({ ...draft, avatar: avatars[next].id, avatarDataUrl: undefined }); event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
          }}>{avatars.map(({ id, label, Icon }, index) => <button type="button" role="radio" aria-checked={draft.avatar === id} aria-label={label} tabIndex={draft.avatar === id || draft.avatar === 'custom' && index === 0 ? 0 : -1} key={id} onClick={() => updateDraft({ ...draft, avatar: id, avatarDataUrl: undefined })}><span>{Icon ? <Icon size={22} strokeWidth={1.5}/> : [...(draft.nickname || username || '我')][0]}</span><small>{label}</small>{draft.avatar === id && <Check className="web-personal-avatar-check" size={12}/>}</button>)}</div></fieldset>
          <label htmlFor={`${inputId}-nickname`}>昵称<span>{draft.nickname.length}/24</span></label><input id={`${inputId}-nickname`} autoComplete="nickname" maxLength={24} value={draft.nickname} placeholder={username || '给自己起个昵称'} disabled={saving || busy} onChange={event => updateDraft({ ...draft, nickname: event.target.value })}/>
          <p className="web-personal-field-hint">留空使用账号名；登录用户名仍为「{username}」。</p>
          <label htmlFor={`${inputId}-signature`}>个人签名<span>{draft.signature.length}/80</span></label><textarea id={`${inputId}-signature`} rows={3} maxLength={80} value={draft.signature} placeholder="写一句此刻想对自己说的话" disabled={saving || busy} onChange={event => updateDraft({ ...draft, signature: event.target.value })}/>
          {error && <p className="web-personal-error" role="alert">{error}</p>}
          <div className="web-personal-form-actions"><button type="button" className="web-personal-button web-personal-ghost" disabled={!dirty || saving || busy || !!photoView} onClick={() => updateDraft({ ...profile })}>放弃修改</button><button type="submit" className="web-personal-button web-personal-primary" disabled={!dirty || saving || busy || !!photoView}>{saving ? '正在保存…' : '保存资料'}</button></div>
        </form>
      </DialogContent>
    </Dialog>
    {photoView && <WebAvatarPhoto initialFile={photoView.file} draft={photoView.draft} preview={<PersonalAvatar kind={(photoView.draft ? draft : profile).avatar} photo={(photoView.draft ? draft : profile).avatarDataUrl} name={photoView.draft ? draft.nickname || name : name}/>} onApply={applyPhoto} onClose={() => setPhotoView(null)}/>}
  </div>;
}
