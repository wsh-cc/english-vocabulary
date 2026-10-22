import { describe, expect, it, vi } from 'vitest';
import { FriendsService } from '../src/friends';
import { RemoteError, type Remote } from '../src/data';
import type { FriendDetail, FriendsOverview } from '@/lib/friends-protocol';

const baseTime = 1792500000000;
const user = (id = 'friend-one') => ({ userId: id, username: id, nickname: `Name ${id}`, signature: 'Shared with friends', avatar: 'sprout' as const });
const overview = (ids = ['friend-one']): FriendsOverview => ({ friends: ids.map(id => ({ user: user(id), since: baseTime })), incoming: [], outgoing: [], profile: { nickname: 'Owner', signature: '', avatar: 'initial', shareLearning: false }, published: true, serverTime: baseTime });
const detail = (id = 'friend-one'): FriendDetail => ({ user: user(id), since: baseTime, stats: { passages: 2, encountered: 8, practices: 3, level: 'CET4', updatedAt: baseTime } });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Cloud implements Remote {
  token: string | null = 'owner-token';
  calls: { path: string; method: string; body: unknown; token?: string }[] = [];
  handler: (path: string, method: string, body: unknown) => Promise<unknown> = async path => path.includes('view=detail') ? detail(new URLSearchParams(path.split('?')[1]).get('userId')!) : overview();
  async readToken() { return this.token; }
  async writeToken(token: string | null) { this.token = token; }
  async request(path: string, method: string, body?: unknown, token?: string) {
    this.calls.push({ path, method, body, token });
    return this.handler(path, method, body);
  }
}
function fixture() {
  const cloud = new Cloud();
  let time = baseTime;
  return { cloud, service: new FriendsService('owner', cloud, () => time), advance: (ms: number) => { time += ms; } };
}

describe('friends client state and bounded caches', () => {
  it('deduplicates simultaneous overview loads and refreshes only after TTL or force', async () => {
    const { cloud, service, advance } = fixture(), gate = deferred<FriendsOverview>();
    cloud.handler = () => gate.promise;
    const first = service.load(), second = service.load();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(cloud.calls).toHaveLength(1));
    expect(service.snapshot.loading).toBe(true);
    gate.resolve(overview()); await first;
    expect(service.snapshot.loading).toBe(false);
    cloud.handler = async () => overview();
    advance(29999); await service.load(); expect(cloud.calls).toHaveLength(1);
    advance(1); await service.load(); expect(cloud.calls).toHaveLength(2);
    await service.load(true); expect(cloud.calls).toHaveLength(3);
    expect(cloud.calls.every(call => call.token === 'owner-token')).toBe(true);
  });

  it('keeps last useful overview on transient failure and clears busy state for retry', async () => {
    const { cloud, service } = fixture(); await service.load();
    cloud.handler = async () => { throw new RemoteError('Unavailable', 503); };
    await service.load(true);
    expect(service.snapshot.overview).toEqual(overview());
    expect(service.snapshot).toMatchObject({ loading: false, unauthorized: false, error: 'Unavailable' });
    cloud.handler = async () => overview(['friend-two']); await service.load(true);
    expect(service.snapshot.overview?.friends[0].user.userId).toBe('friend-two');
    expect(service.snapshot.error).toBe('');
  });

  it('401 clears both overview and cached private details', async () => {
    const { cloud, service } = fixture(); await service.load(); await service.detail('friend-one');
    cloud.handler = async () => { throw new RemoteError('Session expired', 401, 'unauthorized'); };
    await service.load(true);
    expect(service.snapshot).toMatchObject({ overview: null, unauthorized: true, updatedAt: 0 });
    const before = cloud.calls.length;
    await expect(service.detail('friend-one')).rejects.toThrow('Session expired');
    expect(cloud.calls.length).toBe(before + 1);
  });

  it('403 from an authorized detail refresh evicts only that cached friend', async () => {
    const { cloud, service } = fixture(); await service.detail('friend-one'); await service.detail('friend-two');
    cloud.handler = async () => { throw new RemoteError('Friend removed', 403, 'forbidden'); };
    await expect(service.detail('friend-one', true)).rejects.toThrow('Friend removed');
    const before = cloud.calls.length;
    await expect(service.detail('friend-one')).rejects.toThrow('Friend removed');
    expect(cloud.calls.length).toBe(before + 1);
    expect(await service.detail('friend-two')).toEqual(detail('friend-two'));
    expect(service.snapshot.unauthorized).toBe(false);
  });

  it('a refreshed list that no longer includes a friend invalidates that private detail', async () => {
    const { cloud, service } = fixture(); await service.load(); await service.detail('friend-one');
    cloud.handler = async path => {
      if (path.includes('view=detail')) throw new RemoteError('Friend removed', 403);
      return overview([]);
    };
    await service.load(true);
    expect(service.snapshot.overview?.friends).toEqual([]);
    await expect(service.detail('friend-one')).rejects.toThrow('Friend removed');
  });

  it('a late detail cannot restore private cache after another request proves the session expired', async () => {
    const { cloud, service } = fixture(), gate = deferred<FriendDetail>();
    cloud.handler = async path => {
      if (path.includes('view=detail')) return gate.promise;
      throw new RemoteError('Session expired', 401, 'unauthorized');
    };
    const pending = service.detail('friend-one'), rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(cloud.calls).toHaveLength(1));
    await service.load(true); expect(service.snapshot.unauthorized).toBe(true);
    gate.resolve(detail()); await rejected;
    cloud.handler = async () => { throw new RemoteError('Session expired', 401); };
    await expect(service.detail('friend-one')).rejects.toThrow();
  });

  it('expires details at 30 seconds and retains at most twelve friend details', async () => {
    const { cloud, service, advance } = fixture();
    for (let index = 0; index < 13; index++) await service.detail(`friend-${index}`);
    const before = cloud.calls.length;
    await service.detail('friend-1'); expect(cloud.calls).toHaveLength(before);
    await service.detail('friend-0'); expect(cloud.calls).toHaveLength(before + 1);
    advance(30000); await service.detail('friend-0'); expect(cloud.calls).toHaveLength(before + 2);
  });

  it('disposal drops private data, detaches subscribers and ignores pending loads', async () => {
    const { cloud, service } = fixture(); await service.load(); await service.detail('friend-one');
    const gate = deferred<FriendsOverview>(), listener = vi.fn();
    cloud.handler = () => gate.promise; service.subscribe(listener);
    const pending = service.load(true); await vi.waitFor(() => expect(cloud.calls).toHaveLength(3));
    service.dispose(); const notifications = listener.mock.calls.length;
    gate.resolve(overview(['late-friend'])); await pending;
    expect(service.snapshot).toMatchObject({ overview: null, loading: false, mutating: false, updatedAt: 0 });
    expect(listener).toHaveBeenCalledTimes(notifications);
    await expect(service.detail('friend-one')).rejects.toThrow();
    const before = cloud.calls.length; await service.load(true); expect(cloud.calls).toHaveLength(before);
  });

  it('disposal rejects an in-flight detail instead of reviving its cache', async () => {
    const { cloud, service } = fixture(), gate = deferred<FriendDetail>();
    cloud.handler = () => gate.promise;
    const pending = service.detail('friend-one'), rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(cloud.calls).toHaveLength(1)); service.dispose();
    gate.resolve(detail()); await rejected;
    expect(service.snapshot.overview).toBeNull();
    await expect(service.detail('friend-one')).rejects.toThrow();
    expect(cloud.calls).toHaveLength(1);
  });

  it('does not return a cached private detail after the credential changes', async () => {
    const { cloud, service } = fixture(); await service.load(); await service.detail('friend-one');
    cloud.token = 'different-account-token';
    await expect(service.detail('friend-one')).rejects.toThrow();
    expect(service.snapshot.overview).toBeNull();
  });

  it('does not preserve the cached overview after logout even within its TTL', async () => {
    const { cloud, service } = fixture(); await service.load();
    cloud.token = null; await service.load();
    expect(service.snapshot.overview).toBeNull();
    expect(service.snapshot.unauthorized).toBe(true);
    expect(service.snapshot.loading).toBe(false);
  });

  it('discards an in-flight response when the token changes before delivery', async () => {
    const { cloud, service } = fixture(), gate = deferred<FriendsOverview>();
    cloud.handler = () => gate.promise;
    const loading = service.load(); await vi.waitFor(() => expect(cloud.calls).toHaveLength(1));
    cloud.token = 'different-account-token'; gate.resolve(overview()); await loading;
    expect(service.snapshot.overview).toBeNull();
    expect(service.snapshot.error).not.toBe('');
  });

  it('an overview request started before mutation cannot overwrite its result', async () => {
    const { cloud, service } = fixture(), gate = deferred<FriendsOverview>();
    cloud.handler = async (_path, method) => method === 'POST' ? overview([]) : gate.promise;
    const loading = service.load(); await vi.waitFor(() => expect(cloud.calls).toHaveLength(1));
    await service.mutate({ type: 'remove', userId: 'friend-one' });
    gate.resolve(overview()); await loading;
    expect(service.snapshot.overview?.friends).toEqual([]);
    expect(service.snapshot).toMatchObject({ loading: false, mutating: false });
  });

  it('an overview load started during mutation cannot resurrect a removed friend', async () => {
    const { cloud, service } = fixture(), readGate = deferred<FriendsOverview>(), writeGate = deferred<FriendsOverview>();
    cloud.handler = async (_path, method) => method === 'POST' ? writeGate.promise : readGate.promise;
    const mutation = service.mutate({ type: 'remove', userId: 'friend-one' });
    await vi.waitFor(() => expect(cloud.calls).toHaveLength(1));
    const loading = service.load(true);
    // The service may either wait for the mutation or issue a read with a
    // guard; neither strategy may publish the earlier server relation later.
    await Promise.resolve(); await Promise.resolve();
    writeGate.resolve(overview([])); await mutation;
    readGate.resolve(overview()); await loading;
    expect(service.snapshot.overview?.friends).toEqual([]);
  });

  it('an in-flight private detail cannot return or refill cache after relationship mutation', async () => {
    const { cloud, service } = fixture(), gate = deferred<FriendDetail>();
    cloud.handler = async (_path, method) => method === 'POST' ? overview([]) : gate.promise;
    const pending = service.detail('friend-one');
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(cloud.calls).toHaveLength(1));
    await service.mutate({ type: 'remove', userId: 'friend-one' });
    gate.resolve(detail()); await rejected;
    cloud.handler = async () => { throw new RemoteError('Friend removed', 403); };
    await expect(service.detail('friend-one')).rejects.toThrow('Friend removed');
  });

  it('serializes mutations, validates before sending and recovers from a failed mutation', async () => {
    const { cloud, service } = fixture(), gate = deferred<FriendsOverview>();
    cloud.handler = () => gate.promise;
    const pending = service.mutate({ type: 'remove', userId: 'friend-one' });
    await vi.waitFor(() => expect(cloud.calls).toHaveLength(1));
    await expect(service.mutate({ type: 'remove', userId: 'friend-two' })).rejects.toThrow();
    const rejected = expect(pending).rejects.toThrow('Unavailable'); gate.reject(new RemoteError('Unavailable', 503)); await rejected;
    expect(service.snapshot.mutating).toBe(false); expect(cloud.calls).toHaveLength(1);
    cloud.handler = async () => overview([]); await service.mutate({ type: 'remove', userId: 'friend-one' });
    expect(service.snapshot.overview?.friends).toEqual([]);
    await expect(service.mutate({ type: 'profile', profile: { nickname: 'x'.repeat(25), signature: '', avatar: 'initial', shareLearning: false } })).rejects.toThrow();
    expect(cloud.calls).toHaveLength(2);
  });

  it('rejects malformed server responses without replacing the last valid overview', async () => {
    const { cloud, service } = fixture(); await service.load();
    cloud.handler = async () => ({ friends: [] }); await service.load(true);
    expect(service.snapshot.overview).toEqual(overview());
    expect(service.snapshot.error).not.toBe(''); expect(service.snapshot.loading).toBe(false);
  });
});
