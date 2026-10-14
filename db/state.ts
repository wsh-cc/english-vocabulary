import { env } from 'cloudflare:workers';
import { initialState, type State } from '@/lib/learning';
import { createSaveDelta, type SaveDelta } from '@/lib/save-delta';
import { stateEtag } from '@/lib/state-etag';
import { applyMobileOperation, readMobileState, restoreMobileState, type PersistedAction } from './mobile-sync';

function database() { if (!env.DB) throw Error('学习记录暂时无法连接，请稍后重试。'); return env.DB; }
export async function readRevision(userId: string) {
  const row = await database().prepare('SELECT revision FROM learner_state WHERE user_id = ?').bind(userId).first<{ revision: number }>();
  return row?.revision ?? 0;
}
export async function readState(userId: string) {
  const row = await database().prepare('SELECT payload, revision FROM learner_state WHERE user_id = ?').bind(userId).first<{ payload: string; revision: number }>();
  return { state: row ? JSON.parse(row.payload) as State : initialState(), revision: row?.revision ?? 0, exists: !!row };
}
export async function updateState(userId: string, action: PersistedAction, deltaBase?: string | null): Promise<{ state: State; revision: number; exists?: boolean; delta?: SaveDelta }> {
  if (action.type === 'restore') {
    const restored = await restoreMobileState(userId, action.operationId, action.backup as State, action.revision);
    return { state: restored.state, revision: restored.revision };
  }
  const current = await readMobileState(userId);
  const saved = await applyMobileOperation(userId, { operationId: action.operationId, deviceId: 'web', deviceSequence: current.revision + 1, occurredAt: Date.now(), generation: current.generation, action }, 'web', action);
  if (!saved.accepted) throw Error(saved.conflict?.message ?? '记录未保存，请重试。');
  const delta = saved.changed && deltaBase === stateEtag(userId, saved.baseRevision)
    ? createSaveDelta(saved.state, action, saved.baseRevision) : null;
  return { state: saved.state, revision: saved.revision, ...(delta ? { delta } : {}) };
}
