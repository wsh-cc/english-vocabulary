import type { State, Word } from './learning';
import { seedWords } from './learning';
export type ReadingProgress = {
  encounters: Record<string, { count: number; last: number }>;
  completed: Record<string, number>;
};
export type Passage = {
  id: string;
  title: string;
  text: string;
  wordIds: string[];
  level: 'CET4' | 'CET6';
  createdAt: number;
};
export const emptyReading = (): ReadingProgress => ({ encounters: {}, completed: {} });

export function readingSummary(state: State) {
  const words = seedWords.filter(word => word.tags.includes(state.settings.level));
  const encounters = state.reading?.encounters ?? {};
  return {
    total: words.length,
    covered: words.filter(word => encounters[word.id]?.count).length,
    reread: words.filter(word => (encounters[word.id]?.count ?? 0) > 1).length,
    passages: Object.keys(state.reading?.completed ?? {}).length,
  };
}

export function completeReading(state: State, passage: Passage, now: number) {
  state.reading ??= emptyReading();
  if (state.reading.completed[passage.id]) return;
  for (const id of new Set(passage.wordIds)) {
    const previous = state.reading.encounters[id];
    state.reading.encounters[id] = { count: (previous?.count ?? 0) + 1, last: now };
  }
  state.reading.completed[passage.id] = now;
}

export type PassagePart = { type: 'text'; text: string } | { type: 'word'; id: string };
export function passageParts(text: string): PassagePart[] {
  return text.split(/(\[\[[a-zA-Z0-9_-]+\]\])/g).filter(Boolean).map(part =>
    part.startsWith('[[') ? { type: 'word', id: part.slice(2, -2) } : { type: 'text', text: part });
}

export function validatePassage(input: unknown, targets: Word[]): { title: string; text: string } {
  if (!input || typeof input !== 'object') throw Error('段落格式不完整。');
  const { title, text } = input as Record<string, unknown>;
  if (typeof title !== 'string' || !title.trim() || title.length > 100 || typeof text !== 'string' || text.length > 10000) throw Error('段落格式不完整。');
  const targetIds = new Set(targets.map(word => word.id));
  const parts = passageParts(text);
  const used = new Set(parts.filter(part => part.type === 'word').map(part => part.id));
  if (used.size !== targetIds.size || [...used].some(id => !targetIds.has(id)) || [...targetIds].some(id => !used.has(id))) throw Error('段落没有完整覆盖本组目标词。');
  const prose = parts.filter(part => part.type === 'text').map(part => part.text).join('');
  if (/[\[\]{}]/.test(prose) || (prose.match(/[\u3400-\u9fff]/g)?.length ?? 0) < targets.length * 5 || (prose.match(/[。！？]/g)?.length ?? 0) < 4) throw Error('段落缺少完整的句子和上下文。');
  return { title: title.trim(), text: text.trim() };
}
