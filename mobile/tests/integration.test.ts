import { describe, expect, it } from 'vitest';
import { applyAction, initialState, seedWords, type State } from '@/lib/learning';
import { MOBILE_CONTENT_VERSION, MOBILE_PROTOCOL_VERSION, type MobileOperation, type MobileRestoreRequest, type MobileSnapshot } from '@/lib/mobile-protocol';
import { LearningRepository, RemoteError, type Remote } from '../src/data';
import type { StatePersistence, StateWrite, StoredState } from '../src/native';

const now = Date.parse('2026-10-14T01:00:00Z');
const responseError = (status: number, code: string) => Object.assign(new RemoteError(code, status), { code });

class AtomicDisk implements StatePersistence {
  saved: StoredState = { stateJson: null, revision: 0, recoveryJson: null };
  failNextWrite = false;
  async readState() { return structuredClone(this.saved); }
  async writeState(input: StateWrite) {
    if (this.failNextWrite) { this.failNextWrite = false; throw Error('disk-full'); }
    if (this.saved.revision !== input.expectedRevision) throw Error('revision-mismatch');
    this.saved = {
      stateJson: input.stateJson, revision: this.saved.revision + 1,
      recoveryJson: input.keepRecovery ? this.saved.stateJson : this.saved.recoveryJson,
    };
    return { revision: this.saved.revision };
  }
}

/** Isolated API contract fixture: restore receipts are durable and request hashes
 * immutable; no real account, browser storage or network is used. */
class RestoreCloud implements Remote {
  token: string | null = null;
  current: MobileSnapshot = {
    state: initialState(), user: { userId: 'integration-owner', name: '测试学习者' },
    revision: 0, generation: 1, serverTime: now,
    contentVersion: MOBILE_CONTENT_VERSION, protocolVersion: MOBILE_PROTOCOL_VERSION,
  };
  requests: MobileRestoreRequest[] = [];
  receipts = new Map<string, string>();
  appliedRestores = 0;
  failRestore: { status: number; code: string } | null = null;
  loseNextRestoreAcknowledgement = false;
  afterRestore: (() => void) | null = null;
  async readToken() { return this.token; }
  async writeToken(token: string | null) { this.token = token; }
  async request(path: string, _method: string, body?: unknown) {
    if (path === 'auth') return { token: 'b'.repeat(64), user: this.current.user, expiresAt: now + 86400000 };
    if (path === 'bootstrap') return structuredClone(this.current);
    if (path === 'restore') {
      const request = structuredClone(body) as MobileRestoreRequest;
      this.requests.push(request);
      if (this.failRestore) throw responseError(this.failRestore.status, this.failRestore.code);
      const wire = JSON.stringify(request);
      const receipt = this.receipts.get(request.operationId);
      if (receipt && receipt !== wire) throw responseError(409, 'operation_mismatch');
      if (!receipt) {
        if (request.revision !== this.current.revision || request.generation !== this.current.generation) throw responseError(409, 'revision_conflict');
        this.receipts.set(request.operationId, wire);
        this.current = { ...this.current, state: structuredClone(request.backup), revision: this.current.revision + 1, generation: this.current.generation + 1 };
        this.appliedRestores++;
        this.afterRestore?.();
      }
      if (this.loseNextRestoreAcknowledgement) {
        this.loseNextRestoreAcknowledgement = false;
        throw responseError(503, 'service_unavailable');
      }
      return structuredClone(this.current);
    }
    const operations = (body as { operations: MobileOperation[] }).operations;
    for (const operation of operations) {
      this.current.state = applyAction(this.current.state, { ...operation.action, operationId: operation.operationId }, operation.occurredAt);
      this.current.revision++;
    }
    return { ...structuredClone(this.current), accepted: operations.map(operation => operation.operationId), conflicts: [], idMap: {} };
  }
}

async function fixture() {
  const disk = new AtomicDisk(), cloud = new RestoreCloud();
  cloud.current.state.notes[seedWords[0].id] = '恢复前的联想';
  let sequence = 0;
  const repo = new LearningRepository(disk, cloud, () => now, () => `integration-${++sequence}`);
  await repo.login('test-owner', 'not-a-real-password');
  const backup: State = initialState();
  backup.notes[seedWords[0].id] = '备份里的联想';
  const preview = repo.previewBackup(JSON.stringify({ app: 'wordweave', schema: 1, state: backup }));
  return { repo, disk, cloud, preview };
}

describe('durable restore integration', () => {
  it('cold-start resumes the same restore after an applied server response is lost', async () => {
    const { repo, disk, cloud, preview } = await fixture();
    cloud.loseNextRestoreAcknowledgement = true;
    await expect(repo.restore(preview)).rejects.toThrow('service_unavailable');
    expect(repo.snapshot.restorePending).toBe(true);
    expect(repo.snapshot.state!.notes[seedWords[0].id]).toBe('恢复前的联想');
    expect(repo.exportRecovery().text).toContain('恢复前的联想');
    await expect(repo.dispatch({ type: 'note', wordId: seedWords[0].id, note: 'new-work' })).rejects.toThrow('恢复');
    const reopened = new LearningRepository(disk, cloud, () => now);
    await reopened.read();
    expect(reopened.snapshot.restorePending).toBe(true);
    await reopened.resumeRestore();
    expect(cloud.requests).toHaveLength(2);
    expect(cloud.requests[1]).toEqual(cloud.requests[0]);
    expect(cloud.appliedRestores).toBe(1);
    expect(reopened.snapshot.restorePending).toBe(false);
    expect(reopened.snapshot.state!.notes[seedWords[0].id]).toBe('备份里的联想');
    expect(reopened.exportRecovery().text).toContain('恢复前的联想');
  });

  it('retries an acknowledged restore whose final local transaction fails without restoring twice', async () => {
    const { repo, cloud, disk, preview } = await fixture();
    cloud.afterRestore = () => { disk.failNextWrite = true; };
    await expect(repo.restore(preview)).rejects.toThrow('disk-full');
    expect(repo.snapshot.restorePending).toBe(true);
    expect(repo.snapshot.state!.notes[seedWords[0].id]).toBe('恢复前的联想');
    cloud.afterRestore = null;
    await repo.resumeRestore();
    expect(cloud.requests[1]).toEqual(cloud.requests[0]);
    expect(cloud.appliedRestores).toBe(1);
    expect(repo.snapshot.restorePending).toBe(false);
  });

  it.each([[409, 'revision_conflict'], [400, 'invalid_backup'], [409, 'state_limit']])('a definite HTTP %s %s refusal unlocks learning without replacing the current state', async (status, code) => {
    const { repo, cloud, preview } = await fixture();
    cloud.failRestore = { status, code };
    await expect(repo.restore(preview)).rejects.toThrow(code);
    expect(cloud.appliedRestores).toBe(0);
    expect(repo.snapshot.restorePending).toBe(false);
    expect(repo.snapshot.state!.notes[seedWords[0].id]).toBe('恢复前的联想');
    await repo.dispatch({ type: 'note', wordId: seedWords[0].id, note: '拒绝恢复后仍可学习' });
    expect(repo.snapshot.state!.notes[seedWords[0].id]).toBe('拒绝恢复后仍可学习');
  });

  it('restore 401 exposes re-login and retains the original durable request for same-account recovery', async () => {
    const { repo, cloud, preview } = await fixture();
    cloud.failRestore = { status: 401, code: 'unauthorized' };
    await expect(repo.restore(preview)).rejects.toThrow('unauthorized');
    expect(repo.snapshot.needsLogin).toBe(true);
    expect(repo.snapshot.restorePending).toBe(true);
    expect(repo.snapshot.state!.notes[seedWords[0].id]).toBe('恢复前的联想');
    cloud.failRestore = null;
    await repo.login('test-owner', 'not-a-real-password');
    expect(repo.snapshot.restorePending).toBe(true);
    await repo.resumeRestore();
    expect(cloud.requests[1]).toEqual(cloud.requests[0]);
    expect(cloud.appliedRestores).toBe(1);
    expect(repo.snapshot.needsLogin).toBe(false);
    expect(repo.snapshot.restorePending).toBe(false);
  });

  it('a failed first bootstrap leaves no local account or downloaded record', async () => {
    const disk = new AtomicDisk(), cloud = new RestoreCloud();
    const request = cloud.request.bind(cloud);
    cloud.request = async (path, method, body) => {
      if (path === 'bootstrap') throw responseError(503, 'service_unavailable');
      return request(path, method, body);
    };
    const repo = new LearningRepository(disk, cloud, () => now);
    await expect(repo.login('test-owner', 'not-a-real-password')).rejects.toThrow();
    expect(repo.snapshot.user).toBeNull();
    expect(repo.snapshot.state).toBeNull();
    expect(disk.saved.stateJson).toBeNull();
    expect(cloud.token).toBeNull();
  });

  it('preserves the note editor original baseline when a remote update arrives during its draft', async () => {
    const { repo, disk, cloud } = await fixture();
    const editorBaseNote = repo.snapshot.state!.notes[seedWords[0].id];
    cloud.current.state.notes[seedWords[0].id] = '另一设备的新联想';
    cloud.current.revision++;
    await repo.sync();
    await repo.dispatch({ type: 'note', wordId: seedWords[0].id, note: '编辑中的本机草稿', baseNote: editorBaseNote });
    const outbox = JSON.parse(disk.saved.stateJson!).outbox;
    expect(outbox[0].baseNote).toBe('恢复前的联想');
    expect(outbox[0].action).toEqual({ type: 'note', wordId: seedWords[0].id, note: '编辑中的本机草稿' });
  });

  it('keeps the original event time when a local write fails and the same UUID is retried later', async () => {
    const disk = new AtomicDisk(), cloud = new RestoreCloud();
    let deviceNow = now;
    const repo = new LearningRepository(disk, cloud, () => deviceNow);
    await repo.login('test-owner', 'not-a-real-password');
    const action = { type: 'result', wordId: seedWords[0].id, mode: 'meaning', outcome: 'correct', answer: 'first-attempt', operationId: 'fixed-local-retry' };
    disk.failNextWrite = true;
    await expect(repo.dispatch(action)).rejects.toThrow('disk-full');
    expect(repo.snapshot.state!.events).toHaveLength(0);
    deviceNow += 2 * 86400000;
    await repo.dispatch(action);
    expect(repo.snapshot.state!.events[0].at).toBe(now);
    expect(JSON.parse(disk.saved.stateJson!).outbox[0].occurredAt).toBe(now);
    expect(repo.snapshot.state!.events).toHaveLength(1);
  });

  it('accepts the website JSON array template and its optional field defaults', async () => {
    const { repo } = await fixture();
    const template = { ...seedWords[0] } as Partial<typeof seedWords[number]>;
    delete template.id; delete template.scene; delete template.sourceUrl; delete template.phonetic; delete template.mnemonic;
    const preview = repo.previewWords(JSON.stringify([template]));
    expect(preview.words).toHaveLength(1);
    expect(preview.words[0].id).toBeTruthy();
    expect(preview.words[0].scene).toBe('custom');
    expect(preview.words[0].sourceUrl).toBe('');
    expect(preview.words[0].phonetic).toBe('');
    expect(preview.words[0].mnemonic).toBe('');
    expect(preview.duplicates).toBe(1);
  });
});
