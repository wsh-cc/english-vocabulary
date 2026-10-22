import { describe, expect, it } from 'vitest';
import { allWords, availableModes, chinaDay, DAY, dueItems, initialState, MODES, seedWords, type Result, type Track, type Word } from '@/lib/learning';
import { passageParts, readingSummary } from '@/lib/reading';
import { BoundedCache, StudyCache } from '../src/study-cache';

const track = (due: number): Track => ({due, streak: 0, attempts: 0, correct: 0, hinted: 0, wrong: 0, last: 0, interval: 0});
const word = seedWords.find(word => word.tags.includes('CET6'))!;

describe('bounded derived-data cache', () => {
  it('evicts least recently used entries by count and weight and skips oversized values', () => {
    const cache = new BoundedCache<string, string>(2, 5);
    cache.set('a', 'A', 2); cache.set('b', 'B', 2);
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C', 2);
    expect(cache.get('b')).toBeUndefined();
    cache.set('d', 'D', 4);
    expect(cache.size).toBe(1); expect(cache.retainedWeight).toBe(4);
    cache.set('huge', 'X', 6);
    expect(cache.get('d')).toBe('D'); expect(cache.size).toBe(1);
    cache.set('d', 'small', 1);
    expect(cache.retainedWeight).toBe(1);
    cache.clear(); expect(cache.size).toBe(0); expect(cache.retainedWeight).toBe(0);
    expect(() => new BoundedCache(0, 5)).toThrow(RangeError);
    expect(() => cache.set('invalid', '', -1)).toThrow(RangeError);
  });

  it('shares search results across callers, matches existing filters, and refreshes familiarity', () => {
    const state = initialState(), cache = new StudyCache();
    for (const query of ['', word.word.slice(0, 3), word.meaning.slice(0, 1), word.pos]) {
      for (const level of ['all', 'CET4', 'CET6']) {
        const expected = allWords(state).filter(word => (level === 'all' || word.tags.includes(level)) && `${word.word} ${word.meaning} ${word.pos}`.toLowerCase().includes(query.toLowerCase()));
        const result = cache.search(state, query, level, 'all');
        expect(result).toEqual(expected);
        expect(cache.search(state, ` ${query.toUpperCase()} `, level, 'all')).toBe(result);
      }
    }
    const original = cache.search(state, word.word, 'all', 'familiar');
    const changed = {...state, familiar: {[word.id]: 'familiar'}};
    expect(cache.search(changed, word.word, 'all', 'familiar')).toContain(word);
    expect(original).not.toContain(word);
    expect(cache.search(changed, word.word, 'all', 'learning')).not.toContain(word);
    expect(cache.index(changed)).toBe(cache.index(state));
  });

  it('bounds search references and passage text under sustained unique input', () => {
    const cache = new StudyCache(), state = initialState();
    for (let i = 0; i < 1000; i++) {
      cache.search(state, i % 4 ? `query-${i}` : '', i % 2 ? 'CET4' : 'all', 'all');
      cache.parts(`passage-${i} ${'x'.repeat(6000)} [[${word.id}]]`);
      expect(cache.searches.size).toBeLessThanOrEqual(24);
      expect(cache.searches.retainedWeight).toBeLessThanOrEqual(12_000);
      expect(cache.passages.size).toBeLessThanOrEqual(12);
      expect(cache.passages.retainedWeight).toBeLessThanOrEqual(64_000);
    }
    const size = cache.searches.size;
    cache.search(state, 'x'.repeat(129), 'all', 'all');
    expect(cache.searches.size).toBe(size);
    const text = `A [[${word.id}]] word.`;
    const parts = cache.parts(text);
    expect(parts).toEqual(passageParts(text)); expect(cache.parts(text)).toBe(parts);
  });

  it('rebuilds imported/restored catalogs without reinterpreting an old draft', () => {
    const state = initialState(), cache = new StudyCache();
    const oldIndex = cache.index(state), oldResult = cache.search(state, '', 'all', 'all');
    const custom: Word = {...word, id: 'custom-a', word: 'original', meaning: 'original sense'};
    const imported = {...state, custom: [custom]};
    expect(cache.index(imported)).not.toBe(oldIndex);
    expect(cache.search(imported, '', 'all', 'all')).not.toBe(oldResult);
    expect(cache.resolve(imported, {...custom, id: 'old-device-id'})).toBe(custom);
    const restored = {...state, custom: [{...custom, meaning: 'different sense'}]};
    expect(cache.resolve(restored, custom)).toBeUndefined();
    expect(cache.resolve(restored, {...word, id: 'old-device-id'})).toBe(word);
    expect(cache.search(restored, 'different sense', 'all', 'all')).toEqual(restored.custom);
  });

  it('preserves statistics with mixed levels, outcomes, missing words and delayed tests', () => {
    const state = initialState(), cache = new StudyCache();
    state.events = Array.from({length: 5000}, (_, i): Result => ({id: `e${i}`, wordId: i % 11 ? seedWords[i % seedWords.length].id : 'removed', mode: MODES[i % 3], outcome: i % 7 ? 'correct' : i % 2 ? 'hinted' : 'wrong', delayed: i % 2 === 0, at: i, answer: '', nextDue: i + DAY}));
    for (const level of ['CET4', 'CET6'] as const) {
      const selected = {...state, settings: {...state.settings, level}};
      const ids = new Set(allWords(selected).filter(word => word.tags.includes(level)).map(word => word.id));
      const events = state.events.filter(event => ids.has(event.wordId));
      const delayed = events.filter(event => event.delayed);
      const counts = new Map<string, number>();
      events.filter(event => event.outcome === 'wrong').forEach(event => counts.set(event.wordId, (counts.get(event.wordId) ?? 0) + 1));
      const expected = {events, delayed, hinted: events.filter(event => event.outcome === 'hinted').length,
        rates: MODES.map(mode => ({mode, total: delayed.filter(e => e.mode === mode).length, correct: delayed.filter(e => e.mode === mode && e.outcome === 'correct').length})),
        wrong: [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0,6)};
      expect(cache.stats(selected)).toEqual(expected);
      expect(cache.stats({...selected, notes: {[word.id]: 'new note'}})).toBe(cache.stats(selected));
    }
    const previous = cache.stats(state);
    const changed = {...state, events: [...state.events, {id: 'new', wordId: word.id, mode: 'meaning', outcome: 'correct', delayed: true, at: 6000, answer: '', nextDue: DAY} as Result]};
    expect(cache.stats(changed).events.length).toBe(previous.events.length + 1);
  });

  it('matches due order at exact boundaries, clock reversal, and schedule changes', () => {
    const state = initialState(), cache = new StudyCache();
    for (let i = 0; i < 40; i++) {
      const word = seedWords[i];
      state.progress[word.id] = Object.fromEntries(availableModes(word).map(mode => [mode, track(i % 5 * 100)]));
    }
    for (const now of [-1, 0, 99, 100, 400, 401, 100, -1]) expect(cache.due(state, now)).toEqual(dueItems(state, now));
    expect(cache.due(state, 401)).toBe(cache.due(state, 402));
    const changed = {...state, progress: {...state.progress, [word.id]: {meaning: track(800)}}};
    expect(cache.due(changed, 800)).toEqual(dueItems(changed, 800));
  });

  it('rolls Beijing calendar counts at midnight and refreshes reading coverage by level/data', () => {
    const state = initialState(), cache = new StudyCache();
    const midnight = Date.parse('2026-10-18T16:00:00Z');
    state.progress[word.id] = {meaning: track(midnight), recall: track(midnight + DAY)};
    expect(cache.sevenDays(state, midnight - 1).map(day => day.count).slice(0,3)).toEqual([0,1,1]);
    expect(cache.sevenDays(state, midnight).map(day => day.count).slice(0,3)).toEqual([1,1,0]);
    expect(cache.sevenDays(state, midnight)).toBe(cache.sevenDays(state, midnight + 1));
    expect(cache.sevenDays(state, midnight)[0].day).toBe(chinaDay(midnight));
    for (const level of ['CET4', 'CET6'] as const) {
      const selected = {...state, settings: {...state.settings, level}};
      expect(cache.summary(selected)).toEqual(readingSummary(selected));
      const changed = {...selected, reading: {completed: {test: midnight}, encounters: {[word.id]: {count: 2, last: midnight}}}};
      expect(cache.summary(changed)).toEqual(readingSummary(changed));
      expect(cache.summary(changed)).toBe(cache.summary(changed));
    }
  });

  it('drops all retained values when the account UI is disposed', () => {
    const state = initialState(), cache = new StudyCache();
    const index = cache.index(state), stats = cache.stats(state), summary = cache.summary(state), days = cache.sevenDays(state, 0);
    cache.search(state, '', 'all', 'all'); cache.parts('test');
    cache.clear();
    expect(cache.searches.size).toBe(0); expect(cache.passages.size).toBe(0);
    expect(cache.index(state)).not.toBe(index); expect(cache.stats(state)).not.toBe(stats);
    expect(cache.summary(state)).not.toBe(summary); expect(cache.sevenDays(state, 0)).not.toBe(days);
  });
});
