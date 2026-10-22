import { seedWords, availableModes, chinaDay, DAY, MODES, type State, type Word } from '@/lib/learning';
import { passageParts, readingSummary } from '@/lib/reading';

// Both entry count and retained references/text are bounded. Values never own copies of words.
export class BoundedCache<K, V> {
  private entries = new Map<K, {value: V; weight: number}>();
  private weight = 0;
  constructor(readonly maxEntries: number, readonly maxWeight: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxWeight) || maxWeight < 0) throw new RangeError('Invalid cache limits');
  }
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: K, value: V, weight: number) {
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError('Invalid cache weight');
    const previous = this.entries.get(key);
    if (previous) { this.weight -= previous.weight; this.entries.delete(key); }
    if (weight > this.maxWeight) return;
    while (this.entries.size >= this.maxEntries || this.weight + weight > this.maxWeight) {
      const oldest = this.entries.keys().next().value as K;
      this.weight -= this.entries.get(oldest)!.weight; this.entries.delete(oldest);
    }
    this.entries.set(key, {value, weight}); this.weight += weight;
  }
  clear() { this.entries.clear(); this.weight = 0; }
  get size() { return this.entries.size; }
  get retainedWeight() { return this.weight; }
}

type Level = State['settings']['level'];
const senseKey = (word: Word) => JSON.stringify([word.word.toLowerCase(), word.pos, word.meaning]);
function makeIndex(custom: Word[]) {
  const words = [...seedWords, ...custom];
  const byId = new Map(words.map(word => [word.id, word]));
  const bySense = new Map<string, Word>();
  for (const word of words) if (!bySense.has(senseKey(word))) bySense.set(senseKey(word), word);
  return {words, byId, bySense, searchable: words.map(word => `${word.word} ${word.meaning} ${word.pos}`.toLowerCase()), byLevel: {
    CET4: words.filter(word => word.tags.includes('CET4')),
    CET6: words.filter(word => word.tags.includes('CET6')),
  }};
}
type Index = ReturnType<typeof makeIndex>;
type Scheduled = {word: Word; mode: typeof MODES[number]; due: number};
function aggregate(events: State['events'], index: Index, level: Level) {
  const selected: State['events'] = [], delayed: State['events'] = [];
  const rates = MODES.map(mode => ({mode, total: 0, correct: 0}));
  const counts: Record<string, number> = Object.create(null);
  let hinted = 0;
  for (const event of events) {
    if (!index.byId.get(event.wordId)?.tags.includes(level)) continue;
    selected.push(event);
    if (event.outcome === 'hinted') hinted++;
    if (event.outcome === 'wrong') counts[event.wordId] = (counts[event.wordId] ?? 0) + 1;
    if (event.delayed) { delayed.push(event); const rate = rates.find(rate => rate.mode === event.mode)!; rate.total++; if (event.outcome === 'correct') rate.correct++; }
  }
  return {events: selected, delayed, hinted, rates, wrong: Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,6)};
}

// Scoped to a signed-in UI session. Each selector keeps at most one input per CET level.
// Repository snapshots are immutable after publication; imported/restored data gets a new index.
export class StudyCache {
  private custom?: Word[];
  private catalog?: Index;
  private familiar?: State['familiar'];
  readonly searches = new BoundedCache<string, Word[]>(24, 12_000);
  readonly passages = new BoundedCache<string, ReturnType<typeof passageParts>>(12, 64_000);
  private summaries = new Map<Level, {reading: State['reading']; value: ReturnType<typeof readingSummary>}>();
  private statistics = new Map<Level, {events: State['events']; index: Index; value: ReturnType<typeof aggregate>}>();
  private schedules = new Map<Level, {progress: State['progress']; index: Index; items: Scheduled[]; cutoff: number; due: Scheduled[]; day?: string; days?: {day: string; count: number}[]}>();

  index(state: Pick<State, 'custom'>) {
    if (!this.catalog || this.custom !== state.custom) {
      this.custom = state.custom; this.catalog = makeIndex(state.custom);
      this.searches.clear(); this.statistics.clear(); this.schedules.clear();
    }
    return this.catalog;
  }
  resolve(state: State, requested: Word) {
    const index = this.index(state), byId = index.byId.get(requested.id);
    return byId && senseKey(byId) === senseKey(requested) ? byId : index.bySense.get(senseKey(requested));
  }
  search(state: State, query: string, level: string, status: string) {
    const index = this.index(state);
    if (this.familiar !== state.familiar) { this.familiar = state.familiar; this.searches.clear(); }
    query = query.trim().toLowerCase();
    const key = JSON.stringify([query, level, status]);
    const cached = this.searches.get(key);
    if (cached) return cached;
    const result = index.words.filter((word, i) => (level === 'all' || word.tags.includes(level)) &&
      (status === 'all' || (state.familiar[word.id] ?? 'learning') === status) && index.searchable[i].includes(query));
    if (query.length <= 128) this.searches.set(key, result, result.length);
    return result;
  }
  summary(state: State) {
    const level = state.settings.level, cached = this.summaries.get(level);
    if (cached && cached.reading === state.reading) return cached.value;
    const value = readingSummary(state);
    this.summaries.set(level, {reading: state.reading, value}); return value;
  }
  stats(state: State) {
    const index = this.index(state), level = state.settings.level, cached = this.statistics.get(level);
    if (cached && cached.events === state.events && cached.index === index) return cached.value;
    const value = aggregate(state.events, index, level);
    this.statistics.set(level, {events: state.events, index, value}); return value;
  }
  private schedule(state: State) {
    const index = this.index(state), level = state.settings.level;
    let cached = this.schedules.get(level);
    if (!cached || cached.progress !== state.progress || cached.index !== index) {
      const items = index.byLevel[level].flatMap(word => availableModes(word).flatMap(mode => {
        const track = state.progress[word.id]?.[mode];
        return track ? [{word, mode, due: track.due}] : [];
      })).sort((a,b) => a.due-b.due);
      cached = {progress: state.progress, index, items, cutoff: -1, due: []};
      this.schedules.set(level, cached);
    }
    return cached;
  }
  due(state: State, now: number) {
    const cached = this.schedule(state);
    let low = 0, high = cached.items.length;
    while (low < high) { const mid = (low + high) >>> 1; if (cached.items[mid].due <= now) low = mid + 1; else high = mid; }
    if (cached.cutoff !== low) { cached.cutoff = low; cached.due = cached.items.slice(0, low); }
    return cached.due;
  }
  sevenDays(state: State, now: number) {
    const cached = this.schedule(state), day = chinaDay(now);
    if (cached.day === day && cached.days) return cached.days;
    const start = Date.parse(`${day}T00:00:00+08:00`);
    const days = Array.from({length: 7}, (_, i) => ({day: chinaDay(start+i*DAY), count: 0}));
    for (const item of cached.items) { const offset = Math.floor((item.due-start)/DAY); if (offset >= 0 && offset < 7) days[offset].count++; }
    cached.day = day; cached.days = days; return days;
  }
  parts(text: string) {
    let value = this.passages.get(text);
    if (!value) { value = passageParts(text); this.passages.set(text, value, text.length); }
    return value;
  }
  clear() {
    this.custom = undefined; this.catalog = undefined; this.familiar = undefined;
    this.searches.clear(); this.passages.clear(); this.summaries.clear(); this.statistics.clear(); this.schedules.clear();
  }
}
