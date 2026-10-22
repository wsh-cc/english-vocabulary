import { RemoteError, remote, type Remote } from './data';
import { createdFriendInviteSchema, friendActionSchema, friendDetailSchema, friendInvitesSchema, friendSearchSchema, friendsOverviewSchema, type FriendAction, type FriendDetail, type FriendsOverview } from '@/lib/friends-protocol';

export type FriendsSnapshot = {overview:FriendsOverview|null; loading:boolean; mutating:boolean; error:string; unauthorized:boolean; updatedAt:number};
const FRESH_MS = 30000, DETAIL_LIMIT = 12;
const emptySnapshot = (): FriendsSnapshot => ({ overview: null, loading: false, mutating: false, error: '', unauthorized: false, updatedAt: 0 });
export class FriendsService {
  snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private details = new Map<string, { value: FriendDetail; at: number }>();
  private pendingLoad: Promise<void> | null = null;
  private generation = 0;
  private sessionGeneration = 0;
  private boundToken: string | undefined;
  private credentialChanged = false;
  private disposed = false;
  constructor(readonly userId: string, private transport: Remote = remote, private now: () => number = Date.now) {}
  subscribe = (listener: () => void) => {
    if (!this.disposed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(update: Partial<FriendsSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach(listener => listener());
  }
  private invalidateDetails() { this.generation++; this.details.clear(); }
  dispose() {
    this.disposed = true; this.sessionGeneration++; this.invalidateDetails(); this.listeners.clear(); this.snapshot = emptySnapshot();
  }
  private async credential() {
    if (this.disposed) throw Error('账号状态已变化，请重新打开好友。');
    const token = await this.transport.readToken();
    if (this.disposed) throw Error('账号状态已变化，请重新打开好友。');
    if (this.credentialChanged) throw new RemoteError('账号状态已变化，请重新打开好友。', 401, 'credential_changed');
    if (!token) throw new RemoteError('请重新登录后使用好友功能。', 401, 'unauthorized');
    // An instance belongs to its first credential, including cache hits. A
    // later credential may represent another account, so it needs a new service.
    if (this.boundToken !== undefined && this.boundToken !== token) {
      this.credentialChanged = true;
      throw new RemoteError('账号状态已变化，请重新打开好友。', 401, 'credential_changed');
    }
    this.boundToken = token;
    return token;
  }
  private async request(path: string, method = 'GET', body?: unknown) {
    const token = await this.credential(), session = this.sessionGeneration;
    const result = await this.transport.request(path, method, body, token);
    await this.credential();
    if (session !== this.sessionGeneration) throw new RemoteError('登录状态已失效，请重新登录。', 401, 'unauthorized');
    return result;
  }
  private failure(error: unknown) {
    const message = error instanceof Error ? error.message : '暂时无法连接，请稍后重试。';
    if (error instanceof RemoteError && error.status === 401) {
      this.sessionGeneration++; this.invalidateDetails();
      this.publish({ overview: null, updatedAt: 0, unauthorized: true, error: message });
    } else this.publish({ error: message });
    return error instanceof Error ? error : Error(message);
  }
  private applyOverview(overview: FriendsOverview) {
    // A fresh list may reflect removal or changed sharing on another device.
    // Discard cached and in-flight details even when the friend ids are equal.
    this.invalidateDetails();
    this.publish({ overview, updatedAt: this.now(), unauthorized: false, error: '' });
  }
  load(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pendingLoad) return this.pendingLoad;
    const generation = this.generation;
    let loading = false;
    this.pendingLoad = (async () => {
      try {
        await this.credential();
        if (generation !== this.generation || this.snapshot.mutating) return;
        if (!force && this.snapshot.overview && this.now() - this.snapshot.updatedAt < FRESH_MS) return;
        loading = true; this.publish({ loading: true, error: '' });
        const overview = friendsOverviewSchema.parse(await this.request('friends?view=list'));
        if (generation === this.generation) this.applyOverview(overview);
      } catch (error) {
        // Authentication failure invalidates every in-flight request, even if
        // this overview was already superseded by a mutation.
        if (generation === this.generation || error instanceof RemoteError && error.status === 401) this.failure(error);
      } finally {
        this.pendingLoad = null;
        if (loading) this.publish({ loading: false });
      }
    })();
    return this.pendingLoad;
  }
  async search(username: string) {
    try { return friendSearchSchema.parse(await this.request('friends?view=search&username=' + encodeURIComponent(username.trim()))); }
    catch (error) { throw this.failure(error); }
  }
  async detail(userId: string, force = false) {
    let generation = this.generation;
    try {
      await this.credential();
      if (this.snapshot.mutating) throw Error('好友关系正在更新，请稍后重试。');
      generation = this.generation;
      const cached = this.details.get(userId);
      if (!force && cached && this.now() - cached.at < FRESH_MS) return cached.value;
      const value = friendDetailSchema.parse(await this.request('friends?view=detail&userId=' + encodeURIComponent(userId)));
      if (this.disposed || generation !== this.generation) throw Error('好友状态已更新，请重新打开详情。');
      this.details.delete(userId); this.details.set(userId, { value, at: this.now() });
      while (this.details.size > DETAIL_LIMIT) this.details.delete(this.details.keys().next().value!);
      return value;
    } catch (error) {
      // A stale response must not evict a newer valid detail for the same user.
      if (generation === this.generation) this.details.delete(userId);
      throw this.failure(error);
    }
  }
  async invites() {
    try { return friendInvitesSchema.parse(await this.request('friends?view=invites')); }
    catch (error) { throw this.failure(error); }
  }
  async mutate(action: FriendAction): Promise<unknown> {
    if (this.snapshot.mutating) throw Error('正在处理，请稍后重试。');
    const valid = friendActionSchema.parse(action), session = this.sessionGeneration;
    this.invalidateDetails(); this.publish({ mutating: true, error: '' });
    try {
      const result = await this.request('friends', 'POST', valid);
      if (session !== this.sessionGeneration) throw new RemoteError('登录状态已失效，请重新登录。', 401, 'unauthorized');
      // Also supersede any reads that started while the mutation was pending.
      this.invalidateDetails();
      if (valid.type === 'invite') return createdFriendInviteSchema.parse(result);
      if (valid.type === 'revoke-invite') return friendInvitesSchema.parse(result);
      const overview = friendsOverviewSchema.parse(result);
      this.applyOverview(overview);
      return overview;
    } catch (error) { throw this.failure(error); }
    finally { this.publish({ mutating: false }); }
  }
}
