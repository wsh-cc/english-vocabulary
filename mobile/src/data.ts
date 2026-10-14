import { initialState, applyAction, allWords, chinaDay, type State, type Word } from '@/lib/learning';
import { readingPassages } from '@/lib/curriculum';
import { actionSchema, stateSchema, wordSchema } from '@/lib/validation';
import { MOBILE_CONTENT_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_STATE_MAX_BYTES, MOBILE_SYNC_BATCH_SIZE, type MobileOperation, type MobileSnapshot, type MobileSyncResponse, type MobileConflict, type MobileLoginResponse, type MobileRestoreRequest } from '@/lib/mobile-protocol';
import { native, type StatePersistence } from './native';

const ORIGIN = 'https://wordweave-cet-study.shiw36663.chatgpt.site';
const copy = <T,>(value: T): T => structuredClone(value);
type Envelope = {
  version: 2; user: MobileSnapshot['user'] | null; locked: boolean;
  deviceId: string; nextSequence: number; base: State | null; state: State | null;
  serverRevision: number; generation: number; serverTime: number; deviceTime: number;
  outbox: MobileOperation[]; conflicts: MobileConflict[]; incoming?: MobileSnapshot; idMap?: Record<string,string>; restoreRequest?: MobileRestoreRequest;
};
export type LearningSnapshot = {
  state: State | null; user: Envelope['user']; locked: boolean; revision: number;
  pending: number; conflicts: MobileConflict[]; needsLogin: boolean;
  syncing: boolean; lastSync: number; error: string; hasRecovery: boolean; restorePending?: boolean;
};
export type BackupPreview = {state: State; exportedAt: string | null; eventCount: number; customCount: number; readingCount: number};
export interface Remote {
  request(path: string, method: string, body?: unknown, token?: string): Promise<unknown>;
  readToken(): Promise<string | null>;
  writeToken(token: string | null): Promise<void>;
}
export class RemoteError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export const remote: Remote = {
  async request(path, method, body, token) {
    const response = await native.request({url: ORIGIN + '/api/mobile/' + path, method, ...(body === undefined ? {} : {body: JSON.stringify(body)}), ...(token ? {token} : {})});
    let data: any; try { data = JSON.parse(response.body); } catch { throw new RemoteError('同步服务暂时不可用，请稍后重试。', response.status); }
    if (response.status < 200 || response.status >= 300) throw new RemoteError(data.error || '同步未完成，请重试。', response.status, data.code);
    return data;
  },
  async readToken() { return (await native.readCredential()).token; },
  async writeToken(token) { await native.writeCredential({token}); },
};
function validateSnapshot(raw: unknown): MobileSnapshot {
  const value = raw as MobileSnapshot;
  if (!value || value.protocolVersion !== MOBILE_PROTOCOL_VERSION || value.contentVersion !== MOBILE_CONTENT_VERSION) throw Error('学习内容或同步协议已更新，请安装最新版本。');
  if (!value.user?.userId || !value.user.name || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.generation) || value.generation < 1 || !Number.isSafeInteger(value.serverTime)) throw Error('账号记录格式无效，请重试。');
  return {...value, state: stateSchema.parse(value.state)};
}
function materialize(action: Record<string, unknown>, state: State): Record<string, unknown> {
  if (action.type === 'reading-complete') {
    const id = action.passageId ?? (action.passage as {id?: string})?.id;
    const passage = readingPassages.find(item => item.id === id);
    if (!passage) throw Error('未找到内置阅读段落。');
    if (action.contentVersion && action.contentVersion !== MOBILE_CONTENT_VERSION) throw Error('阅读内容版本不匹配。');
    return {type: 'reading-complete', passage};
  }
  const parsed = actionSchema.parse({...action, operationId: action.operationId ?? 'validation'});
  if (parsed.type === 'restore') throw Error('请通过在线备份恢复入口替换记录。');
  if (parsed.type === 'note' && !allWords(state).some(word => word.id === parsed.wordId)) throw Error('词汇不存在。');
  return parsed;
}
function project(base: State, operations: MobileOperation[], ids: Record<string,string> = {}) {
  let state = copy(base);
  for (const raw of operations) {
    const op = rewrite(raw,ids);
    state = applyAction(state, {...materialize(op.action, state), operationId: op.operationId}, op.occurredAt);
  }
  return stateSchema.parse(state);
}
function rewrite(operation: MobileOperation, ids: Record<string, string>): MobileOperation {
  const action = {...operation.action};
  if (typeof action.wordId === 'string') action.wordId = ids[action.wordId] ?? action.wordId;
  if (Array.isArray(action.ids)) action.ids = action.ids.map(id => ids[String(id)] ?? id);
  if (Array.isArray(action.words)) action.words = (action.words as Word[]).map(word => ({...word, id: ids[word.id] ?? word.id}));
  return {...operation, action};
}
export class LearningRepository {
  private envelope: Envelope;
  private revision = 0;
  private recovery: string | null = null;
  private token: string | null = null;
  private listeners = new Set<(snapshot: LearningSnapshot) => void>();
  private serial: Promise<unknown> = Promise.resolve();
  private syncTask: Promise<void> | null = null;
  private loaded = false;
  private status = {needsLogin: false, syncing: false, error: '', lastSync: 0};
  private preview = false;
  private prepared = new Map<string,MobileOperation>();
  private retryAfter = 0;
  private syncFailures = 0;
  constructor(private persistence: StatePersistence = native, private transport: Remote = remote, private now: () => number = Date.now, private uuid: () => string = () => crypto.randomUUID()) {
    this.envelope = {version: 2,user: null,locked: false,deviceId: this.uuid(),nextSequence: 1,base: null,state: null,serverRevision: 0,generation: 1,serverTime: 0,deviceTime: 0,outbox: [],conflicts: []};
  }
  get snapshot(): LearningSnapshot {
    return {state: this.envelope.state, user: this.envelope.user, locked: this.envelope.locked, revision: this.revision, pending: this.envelope.outbox.length, conflicts: this.envelope.conflicts, hasRecovery: !!this.recovery,restorePending:!!this.envelope.restoreRequest,...this.status};
  }
  subscribe(listener: (snapshot: LearningSnapshot) => void) { this.listeners.add(listener); return () => {this.listeners.delete(listener);}; }
  private notify() { for (const listener of this.listeners) listener(this.snapshot); }
  private exclusive<T>(task: () => Promise<T>): Promise<T> { const next = this.serial.then(task, task); this.serial = next.catch(() => {}); return next; }
  async read() {
    if (!this.loaded) await this.exclusive(async () => {
      if (this.loaded) return;
      const saved = await this.persistence.readState();
      if (saved.stateJson) {
        const raw = JSON.parse(saved.stateJson) as Envelope;
        if (raw.version !== 2 || typeof raw.deviceId !== 'string' || !Array.isArray(raw.outbox) || !Array.isArray(raw.conflicts) || !Number.isSafeInteger(raw.nextSequence) || raw.nextSequence < 1) throw Error('本机档案格式无效，请保留数据并联系维护者。');
        if (raw.state) stateSchema.parse(raw.state);
        if (raw.base) stateSchema.parse(raw.base);
        this.envelope = raw;
      }
      this.revision = saved.revision; this.recovery = saved.recoveryJson;
      this.token = await this.transport.readToken();
      this.status.needsLogin = !!this.envelope.user && !this.token;
      this.loaded = true; this.notify();
    });
    return this.snapshot;
  }
  private async commit(next: Envelope, keepRecovery = false) {
    const text = JSON.stringify(next);
    const result = await this.persistence.writeState({stateJson: text, expectedRevision: this.revision, keepRecovery});
    if (keepRecovery) this.recovery = JSON.stringify(this.envelope);
    this.envelope = next; this.revision = result.revision; this.notify();
  }
  async login(username: string, password: string) {
    await this.read();
    const logged = await this.transport.request('auth','POST',{action: 'login',username,password,deviceId: this.envelope.deviceId}) as MobileLoginResponse;
    if (!logged?.token || !logged.user?.userId) throw Error('登录结果无效。');
    const bootstrap = validateSnapshot(await this.transport.request('bootstrap','GET',undefined,logged.token));
    await this.exclusive(async () => {
      const same = this.envelope.user?.userId === bootstrap.user.userId;
      if (this.envelope.user && !same) throw Error('这台设备保留着另一个账号的记录，请先导出备份并退出。');
      const priorToken = this.token;
      await this.transport.writeToken(logged.token);
      try {
        if (same && this.envelope.outbox.length && this.envelope.generation !== bootstrap.generation) {
          await this.commit({...this.envelope, locked: false, incoming: bootstrap, conflicts: this.envelope.outbox.map(op => ({operationId: op.operationId,code: 'generation',message: '其他设备恢复了备份，请先导出本机成果，再载入云端记录。'}))});
        } else {
          const pending = same ? this.envelope.outbox : [];
          await this.commit({...this.envelope,user: bootstrap.user,locked: false,base: bootstrap.state,state: project(bootstrap.state,pending,same?this.envelope.idMap:{}),serverRevision: bootstrap.revision,generation: bootstrap.generation,serverTime: bootstrap.serverTime,deviceTime: this.now(),outbox: pending,conflicts: same ? this.envelope.conflicts : [],incoming: undefined,idMap:same?this.envelope.idMap:{}});
        }
      } catch (error) { await this.transport.writeToken(priorToken); throw error; }
      this.token = logged.token; this.preview = false; this.status.needsLogin = false; this.status.error = ''; this.status.lastSync = this.now(); this.notify();
    });
    await this.sync(true);
  }
  async initializePreview() {
    await this.read();
    await this.exclusive(async () => {
      if (!this.envelope.user) await this.commit({...this.envelope,user: {userId: 'preview',name: '学习者'},locked: false,state: initialState(),base: initialState(),serverTime: this.now(),deviceTime: this.now()});
      this.preview = true; this.status.needsLogin = false; this.notify();
    });
  }
  async dispatch(action: Record<string, unknown>) {
    await this.read();
    return this.exclusive(async () => {
      const current = this.envelope;
      if (!current.user || !current.state || current.locked) throw Error('请先登录并下载学习记录。');
      if (current.restoreRequest) throw Error('备份恢复尚未确认完成，请在“我的”中重试恢复。');
      if (current.incoming) throw Error('云端已恢复为另一份记录，请先处理备份冲突。');
      const opId = typeof action.operationId === 'string' ? action.operationId : this.uuid();
      if (current.outbox.some(op => op.operationId === opId) || current.state.operations.includes(opId) || current.state.events.some(event=>event.id===opId)) {this.prepared.delete(opId);return;}
      materialize(action,current.state);
      let command = {...action}; delete command.operationId;
      const draftBaseNote=typeof command.baseNote==='string'?command.baseNote:undefined;
      if(draftBaseNote!==undefined&&draftBaseNote.length>1000)throw Error('联想原始版本过长。');
      delete command.baseNote;
      if (command.type === 'reading-complete') command = {type: 'reading-complete',passageId: command.passageId ?? (command.passage as {id: string}).id,contentVersion: MOBILE_CONTENT_VERSION};
      const realNow = this.now();
      const occurredAt = current.serverTime ? current.serverTime + (realNow - current.deviceTime) : realNow;
      const cached=this.prepared.get(opId);
      if(cached&&JSON.stringify(cached.action)!==JSON.stringify(command))throw Error('同一操作编号不能用于不同内容。');
      if (!cached&&current.outbox.length && occurredAt < current.outbox.at(-1)!.occurredAt - 300000) throw Error('设备时间发生回退，请校准手机时间后重试。');
      const sequence=Math.max(current.nextSequence,...Array.from(this.prepared.values(),op=>op.deviceSequence+1));
      const op: MobileOperation = cached??{operationId: opId,deviceId: current.deviceId,deviceSequence: sequence,occurredAt,generation: current.generation,action: command,...(command.type === 'note' ? {baseNote: draftBaseNote ?? [...current.outbox].reverse().find(o => o.action.type === 'note' && o.action.wordId === command.wordId)?.action.note as string ?? current.base?.notes[String(command.wordId)] ?? ''} : {})};
      this.prepared.set(opId,op);
      const state = applyAction(copy(current.state), {...materialize(op.action,current.state),operationId: opId},op.occurredAt);
      stateSchema.parse(state);
      await this.commit({...current,state,nextSequence: Math.max(current.nextSequence,op.deviceSequence+1),outbox: [...current.outbox,op]});
      this.prepared.delete(opId);
      this.status.error = ''; this.notify();
    });
  }
  async sync(force=false): Promise<void> {
    if (this.syncTask) return this.syncTask;
    if(!force&&this.now()<this.retryAfter)return;
    const task = this.performSync().finally(() => {this.syncTask = null; this.status.syncing = false; this.notify();});
    this.syncTask = task;
    return task;
  }
  private async performSync() {
    await this.read();
    if (this.preview || this.envelope.user?.userId === 'preview' || !this.envelope.user || this.envelope.locked) return;
    if (!this.token) {this.status.needsLogin = true; this.notify(); return;}
    if (this.envelope.incoming || this.envelope.restoreRequest) return;
    this.status.syncing = true; this.status.error = ''; this.notify();
    try {
      for (let batch = 0; batch < 30; batch++) {
        const blocked = new Set(this.envelope.conflicts.map(conflict => conflict.operationId));
        const operations = this.envelope.outbox.filter(op => !blocked.has(op.operationId)).slice(0,MOBILE_SYNC_BATCH_SIZE);
        const result = await this.transport.request('sync','POST',{operations},this.token) as MobileSyncResponse;
        const snapshot = validateSnapshot(result);
        if (!Array.isArray(result.accepted) || !Array.isArray(result.conflicts) || !result.idMap) throw Error('同步响应格式无效。');
        await this.exclusive(async () => {
          if (snapshot.user.userId !== this.envelope.user?.userId) throw Error('账号数据不匹配，已停止同步。');
          if (snapshot.generation !== this.envelope.generation && this.envelope.outbox.length) {
            await this.commit({...this.envelope,incoming: snapshot,conflicts: this.envelope.outbox.map(op => ({operationId: op.operationId,code: 'generation',message: '云端已恢复备份，请导出本机成果后重新载入。'}))});
            return;
          }
          if (snapshot.generation === this.envelope.generation && snapshot.revision < this.envelope.serverRevision) return;
          const accepted = new Set(result.accepted);
          // Keep the original wire command immutable: a lost-response retry
          // must hash identically. Canonical IDs apply only to the projection.
          const pending = this.envelope.outbox.filter(op => !accepted.has(op.operationId));
          const idMap = {...this.envelope.idMap,...result.idMap};
          const errors = new Map(this.envelope.conflicts.filter(item => !accepted.has(item.operationId)).map(item => [item.operationId,item]));
          result.conflicts.forEach(item => errors.set(item.operationId,item));
          await this.commit({...this.envelope,user: snapshot.user,base: snapshot.state,state: project(snapshot.state,pending,idMap),serverRevision: snapshot.revision,generation: snapshot.generation,serverTime: snapshot.serverTime,deviceTime: this.now(),outbox: pending,conflicts: [...errors.values()],incoming: undefined,idMap});
          this.status.lastSync = this.now(); this.status.needsLogin = false;
          this.syncFailures=0;this.retryAfter=0;
        });
        if (this.envelope.incoming || !operations.length || !result.accepted.length || !this.envelope.outbox.some(op => !this.envelope.conflicts.some(c => c.operationId === op.operationId))) break;
      }
    } catch (error) {
      if (error instanceof RemoteError && error.status === 401) this.status.needsLogin = true;
      this.status.error = error instanceof Error ? error.message : '同步失败，记录已保存在本机。';
      this.syncFailures++;this.retryAfter=this.now()+Math.min(900000,15000*2**Math.min(this.syncFailures-1,6));
      this.notify();
    }
  }
  async resolveConflict(operationId: string, keepLocal: boolean) {
    await this.exclusive(async () => {
      const conflict = this.envelope.conflicts.find(c => c.operationId === operationId);
      const op = this.envelope.outbox.find(o => o.operationId === operationId);
      if (!conflict || !op || !this.envelope.base) return;
      if (conflict.code === 'generation' || this.envelope.incoming) throw Error('请先导出备份，再整体重新载入云端记录。');
      let outbox = this.envelope.outbox.filter(o => o.operationId !== operationId);
      if (keepLocal) {
        const now = this.envelope.serverTime + (this.now() - this.envelope.deviceTime);
        const canonical = rewrite(op,this.envelope.idMap ?? {});
        outbox = [...outbox,{...canonical,operationId: this.uuid(),deviceSequence: this.envelope.nextSequence,occurredAt: now,baseNote: this.envelope.base.notes[String(canonical.action.wordId)] ?? ''}];
      }
      await this.commit({...this.envelope,outbox,nextSequence: this.envelope.nextSequence + (keepLocal ? 1 : 0),state: project(this.envelope.base,outbox,this.envelope.idMap),conflicts: this.envelope.conflicts.filter(c => c.operationId !== operationId)});
    });
    await this.sync();
  }
  async reloadAfterRestore() {
    await this.exclusive(async () => {
      const next = this.envelope.incoming;
      if (!next) return;
      await this.commit({...this.envelope,base: next.state,state: next.state,serverRevision: next.revision,generation: next.generation,serverTime: next.serverTime,deviceTime: this.now(),outbox: [],conflicts: [],incoming: undefined,idMap:{}},true);
    });
  }
  previewBackup(text: string): BackupPreview {
    if (new TextEncoder().encode(text).byteLength > 4000000) throw Error('备份不能超过 4 MB。');
    let raw: any; try {raw = JSON.parse(text);} catch {throw Error('备份 JSON 无法读取。');}
    if (raw.app !== 'wordweave' || raw.schema !== 1) throw Error('这不是词间支持的备份文件。');
    const parsed = stateSchema.safeParse(raw.state);
    if (!parsed.success) throw Error('备份内容无效：' + parsed.error.issues[0].message);
    return {state: parsed.data,exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,eventCount: parsed.data.events.length,customCount: parsed.data.custom.length,readingCount: Object.keys(parsed.data.reading?.completed ?? {}).length};
  }
  exportBackup() {
    if (!this.envelope.state) throw Error('尚未下载学习记录。');
    const text = JSON.stringify({app: 'wordweave',schema: 1,exportedAt: new Date(this.now()).toISOString(),state: this.envelope.state},null,2);
    return {text,fileName: '词间-学习备份-' + chinaDay(this.now()) + '.json',websiteCompatible: new TextEncoder().encode(text).byteLength <= 4000000 && new TextEncoder().encode(JSON.stringify(this.envelope.state)).byteLength <= MOBILE_STATE_MAX_BYTES,pending: this.envelope.outbox.length};
  }
  async restore(preview: BackupPreview) {
    if(new TextEncoder().encode(JSON.stringify(preview.state)).byteLength>MOBILE_STATE_MAX_BYTES)throw Error('备份中的学习记录超过可同步容量，请保留完整本机备份。');
    if (!this.envelope.restoreRequest) await this.sync(true);
    if (!this.token || this.status.needsLogin) throw Error('请联网登录后恢复账号备份。');
    if (this.envelope.outbox.length) throw Error('请先同步或处理本机待同步记录，再恢复备份。');
    if (this.envelope.restoreRequest && JSON.stringify(this.envelope.restoreRequest.backup)!==JSON.stringify(preview.state)) throw Error('另一份备份的恢复尚未确认，请先完成上次恢复。');
    if (!this.envelope.restoreRequest) await this.exclusive(async()=>{
      const request: MobileRestoreRequest={operationId:this.uuid(),revision:this.envelope.serverRevision,generation:this.envelope.generation,backup:preview.state};
      await this.commit({...this.envelope,restoreRequest:request},true);
    });
    let response: MobileSnapshot;
    try {
      response = validateSnapshot(await this.transport.request('restore','POST',this.envelope.restoreRequest,this.token));
    } catch(error) {
      if(error instanceof RemoteError&&error.status===401){this.status.needsLogin=true;this.notify();}
      // A definitive rejection is different from a lost acknowledgement. Only
      // errors documented as not applied may release the durable restore lock.
      if(error instanceof RemoteError&&['revision_conflict','concurrent_write','invalid_backup','state_limit'].includes(error.code??'')&&[400,409].includes(error.status)){
        await this.exclusive(async()=>{await this.commit({...this.envelope,restoreRequest:undefined});});
        await this.sync();
      }
      throw error;
    }
    await this.exclusive(async () => {
      if (this.envelope.outbox.length) throw Error('恢复期间出现了新的本机操作，请重新载入云端。');
      await this.commit({...this.envelope,base: response.state,state: response.state,serverRevision: response.revision,generation: response.generation,serverTime: response.serverTime,deviceTime: this.now(),outbox: [],conflicts: [],incoming: undefined,idMap:{},restoreRequest:undefined});
    });
  }
  async resumeRestore(){
    const request=this.envelope.restoreRequest;
    if(!request)return;
    await this.restore({state:request.backup,exportedAt:null,eventCount:request.backup.events.length,customCount:request.backup.custom.length,readingCount:Object.keys(request.backup.reading?.completed??{}).length});
  }
  exportRecovery(){
    if(!this.recovery)throw Error('尚无恢复前安全副本。');
    const old=JSON.parse(this.recovery) as Envelope;
    if(!old.state)throw Error('安全副本中没有学习档案。');
    return {text:JSON.stringify({app:'wordweave',schema:1,exportedAt:new Date(this.now()).toISOString(),state:old.state},null,2),fileName:'词间-恢复前安全副本-'+chinaDay(this.now())+'.json'};
  }
  previewWords(text: string) {
    if (new TextEncoder().encode(text).byteLength > 2000000) throw Error('词表不能超过 2 MB。');
    const raw = JSON.parse(text);
    const rows=Array.isArray(raw)?raw:raw?.words;
    if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw Error('词表需为数组或包含 words 数组，每次导入 1–500 个义项。');
    const words = rows.map((row:unknown,index:number)=>{
      if(!row||typeof row!=='object'||Array.isArray(row))throw Error(`第 ${index+1} 行：词条格式不正确。`);
      const w=row as Record<string,unknown>;
      const parsed=wordSchema.safeParse({...w,id:w.id??'custom-'+this.uuid(),scene:w.scene??'custom',sourceUrl:w.sourceUrl??'',phonetic:w.phonetic??'',mnemonic:w.mnemonic??''});
      if(!parsed.success)throw Error(`第 ${index+1} 行：${parsed.error.issues[0].path.join('.')} ${parsed.error.issues[0].message}`);
      return parsed.data;
    }) as Word[];
    if (new Set(words.map(w => w.id)).size !== words.length) throw Error('词表中存在重复义项编号。');
    const existing = new Set(allWords(this.envelope.state ?? initialState()).map(w => `${w.word.toLowerCase()}|${w.pos}|${w.meaning}`));
    let duplicates=0;
    for(const w of words){const key=`${w.word.toLowerCase()}|${w.pos}|${w.meaning}`;if(existing.has(key))duplicates++;else existing.add(key);}
    return {words,duplicates};
  }
  async logout() {
    if(this.envelope.restoreRequest)throw Error('请先完成备份恢复，再退出登录。');
    await this.sync();
    if (this.envelope.outbox.length) throw Error('仍有待同步记录，请先同步或导出备份。');
    // Explicit local logout can lock private data even without a connection.
    // An unreachable remote session expires after its configured lifetime.
    if (this.token) {try{await this.transport.request('auth','POST',{action:'logout'},this.token);}catch{}}
    await this.exclusive(async () => {
      await this.commit({...this.envelope,locked: true});
      await this.transport.writeToken(null); this.token = null;
      this.status.needsLogin = true; this.notify();
    });
  }
}

export const repository = new LearningRepository();
