import type { State, Result } from './learning';

type SaveAction = { type: string; operationId: string; wordId?: string };
type Patch =
  | { type: 'note'; wordId: string; note: string }
  | { type: 'result'; wordId: string; progress: State['progress'][string]; learned: number; event: Result };

export type SaveDelta = {
  kind: 'save-delta-v1';
  baseRevision: number;
  revision: number;
  operationId: string;
  eventCount: number;
  patch: Patch;
};

// Only these two bounded actions have a delta contract. Imports, restores and
// all other actions continue to return the authoritative full snapshot.
export function createSaveDelta(state: State, action: SaveAction, baseRevision: number): SaveDelta | null {
  const wordId = action.wordId;
  if (!wordId || state.operations.at(-1) !== action.operationId) return null;
  let patch: Patch;
  if (action.type === 'note') {
    patch = { type: 'note', wordId, note: state.notes[wordId] };
  } else if (action.type === 'result') {
    const event = state.events.at(-1);
    if (!event || event.id !== action.operationId || event.wordId !== wordId) return null;
    // introduce() may initialize every available mode, so send the whole
    // affected word's tracks, not just the mode answered.
    patch = { type: 'result', wordId, progress: state.progress[wordId], learned: state.learned[wordId], event };
  } else return null;
  return {
    kind: 'save-delta-v1', baseRevision, revision: baseRevision + 1,
    operationId: action.operationId,
    eventCount: state.events.length - (patch.type === 'result' ? 1 : 0),
    patch,
  };
}

// Merge only onto the exact acknowledged base. Preserve references for
// untouched records and leave all timestamps/scheduling to the server.
export function mergeSaveDelta(state: State, revision: number, delta: SaveDelta): State | null {
  if (delta.kind !== 'save-delta-v1' || delta.baseRevision !== revision ||
      delta.revision !== revision + 1 || delta.eventCount !== state.events.length ||
      state.operations.includes(delta.operationId)) return null;
  const patch = delta.patch;
  const operations = [...state.operations, delta.operationId].slice(-1000);
  if (patch.type === 'note') {
    return { ...state, notes: { ...state.notes, [patch.wordId]: patch.note }, operations };
  }
  if (patch.type !== 'result' || patch.event.id !== delta.operationId || patch.event.wordId !== patch.wordId) return null;
  return {
    ...state,
    progress: { ...state.progress, [patch.wordId]: patch.progress },
    learned: { ...state.learned, [patch.wordId]: patch.learned },
    events: [...state.events, patch.event],
    operations,
  };
}
