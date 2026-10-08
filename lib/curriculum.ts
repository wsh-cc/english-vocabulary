import content from '@/content/readings.json';
import type { State } from './learning';
import type { Passage } from './reading';

export const readingPassages: Passage[] = content.passages.map(p => ({...p, level: p.level === 'CET4' ? 'CET4' : 'CET6'}));
export const coursePassages = (state: State) => readingPassages.filter(p => p.level === state.settings.level);
export function nextReading(state: State, afterId?: string): Passage | null {
  const passages = coursePassages(state);
  if (!passages.length) return null;
  const start = afterId ? passages.findIndex(p => p.id === afterId) + 1 : 0;
  const ordered = [...passages.slice(start), ...passages.slice(0, start)];
  return ordered.find(p => !state.reading?.completed[p.id]) ?? ordered[0];
}
