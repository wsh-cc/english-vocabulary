import type { ZodType } from 'zod';
import {
  createdFriendInviteSchema, friendActionSchema, friendDetailSchema,
  friendInvitesSchema, friendSearchSchema, friendsOverviewSchema,
  type FriendAction, type FriendDetail, type FriendsOverview,
} from './friends-protocol';

export class WebFriendsError extends Error {
  constructor(message: string, readonly status = 0, readonly code = '') { super(message); }
}
export type FriendsSnapshot = {
  overview: FriendsOverview | null; loading: boolean; mutating: boolean;
  error: string; unauthorized: boolean; updatedAt: number;
};
const emptySnapshot = (): FriendsSnapshot => ({ overview: null, loading: false, mutating: false, error: '', unauthorized: false, updatedAt: 0 });

/** One in-memory service per mounted account. No friend data is persisted locally. */
export class WebFriendsService {
  snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private controllers = new Set<AbortController>();
  private pendingLoad: Promise<void> | null = null;
  private generation = 0;
  private disposed = false;

  constructor(readonly username: string, private transport: typeof fetch = (input, init) => fetch(input, init)) {}
  subscribe = (listener: () => void) => {
    if (!this.disposed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(update: Partial<FriendsSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach(listener => listener());
  }
  dispose() {
    this.disposed = true; this.generation++;
    this.controllers.forEach(controller => controller.abort());
    this.controllers.clear(); this.listeners.clear(); this.snapshot = emptySnapshot();
  }
  private assertActive() {
    if (this.disposed) throw new WebFriendsError('账号状态已变化，请重新打开好友。', 0, 'stale_request');
    if (this.snapshot.unauthorized) throw new WebFriendsError('登录已过期，请重新登录。', 401, 'unauthorized');
  }
  private failure(error: unknown) {
    const failure = error instanceof Error ? error : Error('暂时无法连接，请稍后重试。');
    if (this.disposed) return failure;
    if (error instanceof WebFriendsError && error.status === 401) {
      this.generation++;
      this.controllers.forEach(controller => controller.abort());
      this.publish({ overview: null, updatedAt: 0, unauthorized: true, error: failure.message });
    } else if (!(error instanceof WebFriendsError && error.code === 'stale_request')) {
      this.publish({ error: failure.message });
    }
    return failure;
  }
  private async request<T>(path: string, schema: ZodType<T>, body?: unknown): Promise<T> {
    this.assertActive();
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.transport('/api/friends' + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      this.assertActive();
      // A 401 must invalidate the session even when its body is not valid JSON.
      if (response.status === 401) throw new WebFriendsError('登录已过期，请重新登录。', 401, 'unauthorized');
      const payload: unknown = await response.json().catch(() => null);
      this.assertActive();
      if (!response.ok) {
        const problem = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        throw new WebFriendsError(typeof problem.error === 'string' ? problem.error : '操作未完成，请稍后重试。', response.status, typeof problem.code === 'string' ? problem.code : '');
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw new WebFriendsError('收到的好友资料不完整，请刷新后重试。', 0, 'invalid_response');
      return parsed.data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.assertActive();
        throw new WebFriendsError('连接超时，操作可能已完成。请重试确认。', 0, 'timeout');
      }
      if (error instanceof TypeError) throw new WebFriendsError('暂时无法连接，请检查网络后重试。', 0, 'network');
      throw error;
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  private ensureCurrent(generation: number) {
    this.assertActive();
    if (generation !== this.generation) throw new WebFriendsError('好友状态已更新，请重新查看。', 0, 'stale_request');
  }
  load(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pendingLoad) return this.pendingLoad;
    if (this.snapshot.mutating || !force && this.snapshot.overview && Date.now() - this.snapshot.updatedAt < 30_000) return Promise.resolve();
    const generation = this.generation;
    this.publish({ loading: true, error: '' });
    this.pendingLoad = (async () => {
      try {
        const overview = await this.request('?view=list', friendsOverviewSchema);
        this.ensureCurrent(generation);
        // A refresh may reflect a remote removal or revoked sharing permission.
        this.generation++;
        this.publish({ overview, updatedAt: Date.now(), error: '' });
      } catch (error) {
        if (generation === this.generation || error instanceof WebFriendsError && error.status === 401) this.failure(error);
      } finally { this.pendingLoad = null; this.publish({ loading: false }); }
    })();
    return this.pendingLoad;
  }
  private async read<T>(path: string, schema: ZodType<T>) {
    const generation = this.generation;
    try {
      this.assertActive();
      if (this.snapshot.mutating) throw new WebFriendsError('好友关系正在更新，请稍后重试。');
      const value = await this.request(path, schema);
      this.ensureCurrent(generation);
      return value;
    } catch (error) { throw this.failure(error); }
  }
  search(username: string) { return this.read('?view=search&username=' + encodeURIComponent(username.trim()), friendSearchSchema); }
  detail(userId: string): Promise<FriendDetail> { return this.read('?view=detail&userId=' + encodeURIComponent(userId), friendDetailSchema); }
  invites() { return this.read('?view=invites', friendInvitesSchema); }
  async mutate(action: FriendAction): Promise<unknown> {
    this.assertActive();
    if (this.snapshot.mutating) throw new WebFriendsError('正在处理，请稍后重试。');
    const valid = friendActionSchema.parse(action);
    this.generation++; this.publish({ mutating: true, error: '' });
    try {
      if (valid.type === 'invite') return await this.request('', createdFriendInviteSchema, valid);
      if (valid.type === 'revoke-invite') return await this.request('', friendInvitesSchema, valid);
      const overview = await this.request('', friendsOverviewSchema, valid);
      this.generation++;
      this.publish({ overview, updatedAt: Date.now(), error: '' });
      return overview;
    } catch (error) { throw this.failure(error); }
    finally { this.generation++; this.publish({ mutating: false }); }
  }
}
