import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { allWords, applyAction, initialState, type State, type Word } from '@/lib/learning';
import { readingPassages } from '@/lib/curriculum';
import { actionSchema, stateSchema } from '@/lib/validation';
import { digest } from '@/lib/auth-crypto';
import { MOBILE_CONTENT_VERSION, MOBILE_STATE_MAX_BYTES, type MobileConflict, type MobileOperation } from '@/lib/mobile-protocol';
import { MobileHttpError } from '@/lib/mobile-auth';
import type { Passage } from '@/lib/reading';

export type PersistedAction = z.infer<typeof actionSchema> | { type: 'reading-complete'; operationId: string; passage: Passage };
type Action = Record<string, unknown> & { type: string; operationId: string };
type Snapshot = { state: State; revision: number; generation: number; baseline: State; baselineAt: number };
type Receipt = { request_hash: string; status: string; conflict_payload: string | null; id_map_payload: string; generation: number };
type StoredOperation = { operation_id: string; action_payload: string; occurred_at: number; device_id: string; device_sequence: number };
type ApplyResult = { state: State; revision: number; generation: number; accepted: boolean; conflict?: MobileConflict; idMap: Record<string, string>; changed: boolean; baseRevision: number };
const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).refine(v => !['__proto__', 'constructor', 'prototype'].includes(v));
export const mobileOperationSchema = z.object({ operationId: safeId, deviceId: safeId, deviceSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), occurredAt: z.number().int().min(0).max(8640000000000000), generation: z.number().int().min(1), action: z.record(z.unknown()), baseNote: z.string().max(1000).optional() }).strict();
const readingActionSchema = z.object({ type: z.literal('reading-complete'), passageId: z.string().uuid(), contentVersion: z.literal(MOBILE_CONTENT_VERSION) }).strict();
const practiceTypes = new Set(['introduce', 'familiar', 'result']);
function database() { if (!env.DB) throw Error('学习记录暂时无法连接，请稍后重试。'); return env.DB; }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function readMobileState(userId: string): Promise<Snapshot> {
  const db = database();
  const read = () => db.prepare('SELECT l.payload, l.revision, m.generation, m.baseline_payload, m.baseline_at FROM learner_state l JOIN mobile_sync_meta m ON m.user_id = l.user_id WHERE l.user_id = ?').bind(userId)
    .first<{ payload: string; revision: number; generation: number; baseline_payload: string; baseline_at: number }>();
  let row = await read();
  if (!row) {
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO learner_state (user_id, payload, revision, updated_at) VALUES (?, ?, 0, ?)').bind(userId, JSON.stringify(initialState()), Date.now()),
      db.prepare('INSERT OR IGNORE INTO mobile_sync_meta (user_id, generation, baseline_payload, baseline_at) SELECT user_id, 1, payload, updated_at FROM learner_state WHERE user_id = ?').bind(userId),
    ]);
    row = await read();
  }
  if (!row) throw Error('学习记录读取失败。');
  return { state: JSON.parse(row.payload), revision: row.revision, generation: row.generation, baseline: JSON.parse(row.baseline_payload), baselineAt: row.baseline_at };
}
function toAction(operation: MobileOperation): Action {
  if (operation.action.type === 'reading-complete') {
    const parsed = readingActionSchema.safeParse(operation.action);
    if (!parsed.success) throw new MobileHttpError(400, '阅读内容版本或段落编号无效。', 'content_version');
    const passage = readingPassages.find(p => p.id === parsed.data.passageId);
    if (!passage) throw new MobileHttpError(400, '未找到这篇阅读材料。', 'unknown_passage');
    return { type: 'reading-complete', operationId: operation.operationId, passage };
  }
  const parsed = actionSchema.safeParse({ ...operation.action, operationId: operation.operationId });
  if (!parsed.success || parsed.data.type === 'restore') throw new MobileHttpError(400, '学习操作格式不正确，完整恢复请使用恢复入口。', 'invalid_action');
  return parsed.data;
}
function checkState(state: State) {
  const parsed = stateSchema.safeParse(state);
  if (!parsed.success) throw new MobileHttpError(409, '记录超过可同步范围或含无效内容，请导出本机备份后处理。', 'state_limit');
  const payload = JSON.stringify(state);
  if (new TextEncoder().encode(payload).byteLength > MOBILE_STATE_MAX_BYTES) throw new MobileHttpError(409, '学习记录超过 1.9 MB 同步容量，请先导出备份；已有内容不会被删减。', 'state_limit');
  const ids = new Set<string>();
  if (state.events.some(event => { const duplicate = ids.has(event.id); ids.add(event.id); return duplicate; })) throw new MobileHttpError(409, '记录含重复的练习编号，请检查备份；已有内容不会被覆盖。', 'duplicate_event');
  return payload;
}
function wordKey(word: Word) { return `${word.word.toLowerCase()}|${word.pos}|${word.meaning}`; }
function mapImport(state: State, action: Action) {
  const mapping: Record<string, string> = {};
  if (action.type !== 'import') return mapping;
  const byId = new Map(allWords(state).map(w => [w.id, w]));
  const byKey = new Map(allWords(state).map(w => [wordKey(w), w]));
  for (const word of action.words as Word[]) {
    const collision = byId.get(word.id);
    if (collision && wordKey(collision) !== wordKey(word)) throw new MobileHttpError(409, '导入的义项编号已用于另一词义，请重新生成编号。', 'word_id_conflict');
    const existing = byKey.get(wordKey(word));
    if (existing) mapping[word.id] = existing.id;
    else { byId.set(word.id, word); byKey.set(wordKey(word), word); }
  }
  return mapping;
}
async function rebuildPractice(userId: string, current: Snapshot, next: State, operation: MobileOperation, action: Action) {
  const rows = await database().prepare("SELECT operation_id, action_payload, occurred_at, device_id, device_sequence FROM mobile_operations WHERE user_id = ? AND generation = ? AND status = 'accepted' AND json_extract(action_payload, '$.type') IN ('introduce', 'familiar', 'result')")
    .bind(userId, current.generation).all<StoredOperation>();
  const events = [...rows.results, { operation_id: operation.operationId, action_payload: JSON.stringify(action), occurred_at: operation.occurredAt, device_id: operation.deviceId, device_sequence: operation.deviceSequence }];
  events.sort((a, b) => a.occurred_at - b.occurred_at || (a.device_id === b.device_id ? a.device_sequence - b.device_sequence : a.device_id.localeCompare(b.device_id)) || a.operation_id.localeCompare(b.operation_id));
  const replay = copy(current.baseline);
  replay.custom = copy(next.custom);
  replay.operations = [];
  const migratedIds = new Set([...current.baseline.operations, ...current.baseline.events.map(event => event.id)]);
  for (const event of events) if (!migratedIds.has(event.operation_id)) applyAction(replay, JSON.parse(event.action_payload), event.occurred_at);
  next.progress = replay.progress;
  next.familiar = replay.familiar;
  next.learned = replay.learned;
  next.events = replay.events;
}
const conflict = (operation: MobileOperation, code: string, message: string, extra: Partial<MobileConflict> = {}): MobileConflict => ({ operationId: operation.operationId, code, message, ...extra });

/** Receipts and state are committed in one D1 batch. Every statement is guarded
 * by the same CAS revision; a loser writes neither receipt nor learning state. */
export async function applyMobileOperation(userId: string, operation: MobileOperation, source: 'mobile' | 'web' = 'mobile', webAction?: PersistedAction, canonicalIdMap: Record<string, string> = {}): Promise<ApplyResult> {
  const db = database();
  const requestHash = await digest(stable(source === 'web' ? { source, action: webAction } : operation));
  for (let attempt = 0; attempt < (source === 'mobile' ? 2 : 6); attempt++) {
    const current = await readMobileState(userId);
    const existing = await db.prepare('SELECT request_hash, status, conflict_payload, id_map_payload, generation FROM mobile_operations WHERE user_id = ? AND operation_id = ?').bind(userId, operation.operationId).first<Receipt>();
    if (existing) {
      const latest = await readMobileState(userId);
      if (existing.request_hash !== requestHash) return { ...latest, accepted: false, conflict: conflict(operation, 'operation_mismatch', '同一操作编号携带了不同内容，请保留本机记录并处理冲突。'), idMap: {}, changed: false, baseRevision: latest.revision };
      return { ...latest, accepted: existing.status === 'accepted', ...(existing.conflict_payload ? { conflict: JSON.parse(existing.conflict_payload) } : {}), idMap: JSON.parse(existing.id_map_payload), changed: false, baseRevision: latest.revision };
    }
    const generation = source === 'web' ? current.generation : operation.generation;
    let issue: MobileConflict | undefined;
    let action: Action = { type: 'invalid', operationId: operation.operationId };
    let next = copy(current.state);
    let idMap: Record<string, string> = {};
    const effectiveIds = { ...canonicalIdMap };
    if (generation !== current.generation) issue = conflict(operation, 'generation_changed', '云端已恢复了另一份备份，请导出未同步记录后重新载入。');
    if (!issue && source === 'mobile') {
      if (operation.occurredAt > Date.now() + 5 * 60000 || operation.occurredAt < current.baselineAt - 5 * 60000) issue = conflict(operation, 'clock_invalid', '设备时间与账号基线不符，请校准时间并保留待处理操作。');
      const sequence = await db.prepare("SELECT device_sequence, occurred_at, id_map_payload FROM mobile_operations WHERE user_id = ? AND generation = ? AND device_id = ? AND status = 'accepted' ORDER BY received_at, device_sequence")
        .bind(userId, generation, operation.deviceId).all<{ device_sequence: number; occurred_at: number; id_map_payload: string }>();
      // The wire envelope remains immutable after a send. Resolve aliases from
      // durable import receipts, including earlier batches and lost responses.
      for (const row of sequence.results) Object.assign(effectiveIds, JSON.parse(row.id_map_payload));
      if (sequence.results.some(row => row.device_sequence === operation.deviceSequence)) issue = conflict(operation, 'sequence_reused', '该设备顺序编号已经使用，请保留记录并重新载入。');
      if (sequence.results.some(row => (row.device_sequence < operation.deviceSequence && row.occurred_at > operation.occurredAt + 5 * 60000) || (row.device_sequence > operation.deviceSequence && row.occurred_at < operation.occurredAt - 5 * 60000))) issue = conflict(operation, 'clock_invalid', '检测到设备时间回退，请校准时间并处理待同步记录。');
    }
    try {
      if (!issue) {
        action = webAction ? webAction as unknown as Action : toAction(operation);
        if (typeof action.wordId === 'string') action = { ...action, wordId: effectiveIds[action.wordId] ?? action.wordId };
        if (Array.isArray(action.ids)) action = { ...action, ids: action.ids.map(id => effectiveIds[String(id)] ?? id) };
        if (action.type === 'restore') throw new MobileHttpError(409, '完整恢复需要单独提交。', 'invalid_action');
        if (practiceTypes.has(action.type)) {
          const affected = action.type === 'introduce' ? action.ids as string[] : [action.wordId as string];
          if (affected.some(id => Object.values(current.baseline.progress[id] ?? {}).some(track => track && track.last > operation.occurredAt))) {
            throw new MobileHttpError(409, '这条练习早于已迁移记录，无法安全重排，请校准时间并保留本机记录。', 'predates_baseline');
          }
        }
        if (action.type === 'note' && source === 'mobile') {
          const wordId = action.wordId as string, remote = current.state.notes[wordId] ?? '', local = action.note as string;
          if (operation.baseNote === undefined || (remote !== operation.baseNote && remote !== local)) issue = conflict(operation, 'note_conflict', '这条联想已在另一设备编辑，请选择要保留的内容。', { wordId, local, remote });
        }
        if (!issue) {
          idMap = mapImport(next, action);
          // Old v1 clients can retry the last 1000 migrated IDs. No new event is added.
          const migrated = current.baseline.operations.includes(operation.operationId) || current.baseline.events.some(event => event.id === operation.operationId);
          const migratedEvent = current.baseline.events.find(event => event.id === operation.operationId);
          if (migratedEvent && (action.type !== 'result' || action.wordId !== migratedEvent.wordId || action.mode !== migratedEvent.mode || action.outcome !== migratedEvent.outcome || action.answer !== migratedEvent.answer)) throw new MobileHttpError(409, '同一操作编号与迁移前的成绩内容不同。', 'operation_mismatch');
          if (!migrated) {
            next = applyAction(next, action, operation.occurredAt);
            if (action.type === 'reading-complete' && next.reading) {
              for (const id of (action.passage as Passage).wordIds) {
                const encounter = next.reading.encounters[id];
                if (encounter) encounter.last = Math.max(encounter.last, current.state.reading?.encounters[id]?.last ?? 0);
              }
            }
            if (practiceTypes.has(action.type)) await rebuildPractice(userId, current, next, operation, action);
          }
          checkState(next);
        }
      }
    } catch (error) {
      issue = conflict(operation, error instanceof MobileHttpError ? error.code : 'invalid_action', error instanceof Error ? error.message : '无法应用这条学习操作。');
    }
    const commitId = crypto.randomUUID(), now = Date.now();
    const statements = [db.prepare('INSERT OR IGNORE INTO mobile_operations (user_id, operation_id, generation, device_id, device_sequence, occurred_at, received_at, request_hash, action_payload, status, conflict_payload, id_map_payload, commit_id) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM learner_state l JOIN mobile_sync_meta m ON m.user_id = l.user_id WHERE l.user_id = ? AND l.revision = ? AND m.generation = ?')
      .bind(userId, operation.operationId, generation, operation.deviceId, operation.deviceSequence, operation.occurredAt, now, requestHash, JSON.stringify(action), issue ? 'conflict' : 'accepted', issue ? JSON.stringify(issue) : null, JSON.stringify(idMap), commitId, userId, current.revision, current.generation)];
    if (!issue) statements.push(db.prepare('UPDATE learner_state SET payload = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM mobile_operations WHERE user_id = ? AND operation_id = ? AND commit_id = ?)')
      .bind(JSON.stringify(next), now, userId, current.revision, userId, operation.operationId, commitId));
    const results = await db.batch(statements);
    if (!results[0].meta.changes) continue;
    return { state: issue ? current.state : next, revision: current.revision + (issue ? 0 : 1), generation: current.generation, accepted: !issue, ...(issue ? { conflict: issue } : {}), idMap, changed: !issue, baseRevision: current.revision };
  }
  throw new MobileHttpError(409, '另一台设备正在保存，请稍后重试。', 'concurrent_write');
}

export async function restoreMobileState(userId: string, operationId: string, backup: State, revision: number, generation?: number) {
  const db = database(), requestHash = await digest(stable({ type: 'restore', backup, revision, ...(generation === undefined ? {} : { generation }) }));
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await readMobileState(userId);
    const receipt = await db.prepare('SELECT request_hash FROM mobile_operations WHERE user_id = ? AND operation_id = ?').bind(userId, operationId).first<{ request_hash: string }>();
    if (receipt) {
      if (receipt.request_hash !== requestHash) throw new MobileHttpError(409, '同一恢复编号携带了不同内容。', 'operation_mismatch');
      return current;
    }
    if (current.revision !== revision || (generation !== undefined && current.generation !== generation)) throw new MobileHttpError(409, '另一台设备已更新记录，请重新载入后再恢复备份。', 'revision_conflict');
    const next = copy(backup);
    next.operations = [...next.operations, operationId].slice(-1000);
    const payload = checkState(next), commitId = crypto.randomUUID(), now = Date.now();
    const result = await db.batch([
      db.prepare("INSERT OR IGNORE INTO mobile_operations (user_id, operation_id, generation, device_id, device_sequence, occurred_at, received_at, request_hash, action_payload, status, id_map_payload, commit_id) SELECT ?, ?, ?, 'restore', 0, ?, ?, ?, '{\"type\":\"restore\"}', 'accepted', '{}', ? FROM learner_state l JOIN mobile_sync_meta m ON m.user_id = l.user_id WHERE l.user_id = ? AND l.revision = ? AND m.generation = ?")
        .bind(userId, operationId, current.generation, now, now, requestHash, commitId, userId, revision, current.generation),
      db.prepare('INSERT INTO mobile_recovery (user_id, payload, revision, generation, saved_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM mobile_operations WHERE user_id = ? AND operation_id = ? AND commit_id = ?) ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, revision = excluded.revision, generation = excluded.generation, saved_at = excluded.saved_at')
        .bind(userId, JSON.stringify(current.state), current.revision, current.generation, now, userId, operationId, commitId),
      db.prepare('UPDATE mobile_sync_meta SET generation = generation + 1, baseline_payload = ?, baseline_at = ? WHERE user_id = ? AND generation = ? AND EXISTS (SELECT 1 FROM mobile_operations WHERE user_id = ? AND operation_id = ? AND commit_id = ?)')
        .bind(payload, now, userId, current.generation, userId, operationId, commitId),
      db.prepare('UPDATE learner_state SET payload = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM mobile_operations WHERE user_id = ? AND operation_id = ? AND commit_id = ?)')
        .bind(payload, now, userId, revision, userId, operationId, commitId),
    ]);
    if (result[0].meta.changes) return { state: next, revision: revision + 1, generation: current.generation + 1 };
  }
  throw new MobileHttpError(409, '另一台设备正在保存，请稍后重试。', 'concurrent_write');
}
