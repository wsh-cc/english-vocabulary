import { describe, expect, it } from 'vitest';
import { applyAction, initialState, seedWords } from '@/lib/learning';
import { MOBILE_CONTENT_VERSION, MOBILE_PROTOCOL_VERSION, type MobileOperation, type MobileSnapshot } from '@/lib/mobile-protocol';
import { LearningRepository, RemoteError, type Remote } from '../src/data';
import type { StatePersistence, StateWrite, StoredState } from '../src/native';

const baselineTime = Date.parse('2026-10-15T01:00:00Z');

class Disk implements StatePersistence {
  stored: StoredState = { stateJson: null, revision: 0, recoveryJson: null };
  writes = 0;
  async readState() { return structuredClone(this.stored); }
  async writeState(input: StateWrite) {
    if (this.stored.revision !== input.expectedRevision) throw Error('disk revision conflict');
    this.writes++;
    this.stored = { stateJson: input.stateJson, revision: this.stored.revision + 1, recoveryJson: input.keepRecovery ? this.stored.stateJson : this.stored.recoveryJson };
    return { revision: this.stored.revision };
  }
}

class Cloud implements Remote {
  token: string | null = null;
  status = 200;
  paths: string[] = [];
  syncBatches: MobileOperation[][] = [];
  gate: (() => Promise<void>) | null = null;
  current: MobileSnapshot = { state: initialState(), revision: 0, generation: 1, user: { userId: 'realtime-owner', name: '测试学习者' }, serverTime: baselineTime, contentVersion: MOBILE_CONTENT_VERSION, protocolVersion: MOBILE_PROTOCOL_VERSION };
  async readToken() { return this.token; }
  async writeToken(token: string | null) { this.token = token; }
  async request(path: string, _method: string, body?: unknown) {
    this.paths.push(path);
    if (this.status !== 200) throw new RemoteError('connection failed', this.status);
    if (path === 'auth') return { token: 'c'.repeat(64), user: this.current.user, expiresAt: baselineTime + 86400000 };
    if (path === 'bootstrap') return structuredClone(this.current);
    if (path === 'version') { const version: Partial<MobileSnapshot> = { ...this.current }; delete version.state; return structuredClone(version); }
    const operations = structuredClone((body as { operations: MobileOperation[] }).operations);
    this.syncBatches.push(operations);
    if (this.gate) { const gate = this.gate; this.gate = null; await gate(); }
    for (const operation of operations) {
      this.current.state = applyAction(this.current.state, { ...operation.action, operationId: operation.operationId }, operation.occurredAt);
      this.current.revision++;
    }
    return { ...structuredClone(this.current), accepted: operations.map(operation => operation.operationId), conflicts: [], idMap: {} };
  }
}

async function fixture() {
  const disk = new Disk(), cloud = new Cloud();
  let sequence = 0;
  const repo = new LearningRepository(disk, cloud, () => baselineTime, () => `realtime-${++sequence}`);
  await repo.login('owner', 'synthetic-only-password');
  return { repo, cloud, disk };
}

describe('automatic account updates', () => {
  it('uploads work committed while an initially empty synchronization is in flight', async () => {
    const { repo, cloud } = await fixture();
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    cloud.gate = () => { entered(); return new Promise<void>(resolve => { release = resolve; }); };
    const inFlight = repo.sync(true);
    await waiting;
    await repo.dispatch({ type: 'note', wordId: seedWords[0].id, note: '空请求期间新增的联想' });
    release(); await inFlight;
    expect(repo.snapshot.pending).toBe(0);
    expect(cloud.current.state.notes[seedWords[0].id]).toBe('空请求期间新增的联想');
  });
});
