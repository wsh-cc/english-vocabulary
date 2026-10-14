import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState, seedWords } from '@/lib/learning';
import { LibraryView, ReadingView, ReviewView, StatisticsView, TodayView, WordSheet, type StudyProps } from '../src/Study';

function props(): StudyProps {
  return { state: initialState(), dispatch: vi.fn(async () => true), busy: false, onSpeak: vi.fn(), onPractice: vi.fn() };
}
afterEach(() => vi.useRealTimers());

describe('mobile learning views', () => {
  it('renders local reading with resolved word markers and a complete offline directory entry point', () => {
    const p = props();
    const html = renderToStaticMarkup(createElement(ReadingView, { ...p, onWord: vi.fn() }));
    expect(html).toContain('打开阅读目录');
    expect(html).toContain('读完，继续下一段');
    expect(html).toContain('ww-word-link');
    expect(html).not.toContain('[[');
    expect(p.dispatch).not.toHaveBeenCalled();
  });

  it('keeps the assessment skippable and describes familiarity without claiming tested mastery', () => {
    const html = renderToStaticMarkup(createElement(TodayView, { ...props(), onRead: vi.fn(), onLibrary: vi.fn(), onStats: vi.fn() }));
    expect(html).toContain('跳过初测');
    expect(html).toContain('初测不计为测试通过');
    expect(html).toContain('当前没有到期练习');
  });

  it('offers only two practice directions for basic entries and all three for complete entries', () => {
    const p = props();
    const basic = seedWords.find(word => !word.test)!;
    const complete = seedWords.find(word => word.test && word.testTranslation)!;
    const basicHtml = renderToStaticMarkup(createElement(WordSheet, { ...p, word: basic, onClose: vi.fn() }));
    expect(basicHtml).toContain('英文认义');
    expect(basicHtml).toContain('中文回忆英文');
    expect(basicHtml).not.toContain('英文语境理解');
    const completeHtml = renderToStaticMarkup(createElement(WordSheet, { ...p, word: complete, onClose: vi.fn() }));
    expect(completeHtml).toContain('英文语境理解');
  });

  it('respects the Beijing-day new-word quota while keeping browsing available', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T06:00:00Z'));
    const p = props();
    p.state.settings.daily = 1;
    p.state.learned[seedWords[0].id] = Date.parse('2026-10-12T16:30:00Z');
    const html = renderToStaticMarkup(createElement(LibraryView, { ...p, onWord: vi.fn() }));
    expect(html).toContain('今日新词额度完成');
    expect(html).toContain('今日可学 0 个新词');
    expect(html).toMatch(/<button class="ww-button ww-secondary"><svg[^]*?快速浏览<\/button>/);
    expect(p.dispatch).not.toHaveBeenCalled();
  });

  it('browses merged word directions without rendering an answer field or dispatching a result', () => {
    const p = props();
    const word = seedWords[0];
    const html = renderToStaticMarkup(createElement(ReviewView, { ...p, items: [{ word, mode: 'meaning' }, { word, mode: 'recall' }], browse: true, onDone: vi.fn() }));
    expect(html).toContain('1 / 1');
    expect(html).toContain('仅浏览');
    expect(html).not.toContain('ww-review-answer');
    expect(p.dispatch).not.toHaveBeenCalled();
  });

  it('calculates rates from delayed tests and excludes immediate answers from the denominator', () => {
    const p = props();
    const word = seedWords.find(word => word.tags.includes('CET6'))!;
    p.state.events = [
      { id: 'immediate', wordId: word.id, mode: 'meaning', outcome: 'correct', at: 1000, delayed: false, answer: 'test', nextDue: 2000 },
      { id: 'delayed-wrong', wordId: word.id, mode: 'meaning', outcome: 'wrong', at: 2000, delayed: true, answer: 'test', nextDue: 3000 },
      { id: 'delayed-correct', wordId: word.id, mode: 'meaning', outcome: 'correct', at: 3000, delayed: true, answer: 'test', nextDue: 4000 },
    ];
    const html = renderToStaticMarkup(createElement(StatisticsView, { state: p.state }));
    expect(html).toContain('50%');
    expect(html).toContain('1 / 2 次延后测试独立答对');
    expect(html).toContain('阅读覆盖只表示接触');
  });

  it('survives canonical ID remapping and offers an unscored skip for removed material', () => {
    const p = props();
    const canonical = seedWords[0];
    const remappedHtml = renderToStaticMarkup(createElement(ReviewView, { ...p, items: [{ word: { ...canonical, id: 'custom-remapped' }, mode: 'meaning' }], onDone: vi.fn() }));
    expect(remappedHtml).toContain('ww-review-answer');
    expect(remappedHtml).not.toContain('这个练习的材料已更新');
    const removedHtml = renderToStaticMarkup(createElement(ReviewView, { ...p, items: [{ word: { ...canonical, id: 'removed-custom', word: 'absent-custom-word', meaning: 'removed-custom-sense' }, mode: 'meaning' }], onDone: vi.fn() }));
    expect(removedHtml).toContain('这个练习的材料已更新');
    expect(removedHtml).toContain('跳过，不记分');
    expect(p.dispatch).not.toHaveBeenCalled();
  });

  it('resolves a sheet open before canonical ID mapping to current notes and tracks', () => {
    const p = props();
    const canonical = seedWords[0];
    p.state.notes[canonical.id] = '新的规范编号下的联想';
    const html = renderToStaticMarkup(createElement(WordSheet, { ...p, word: { ...canonical, id: 'stale-device-id' }, onClose: vi.fn() }));
    expect(html).toContain('新的规范编号下的联想');
    expect(html).toContain('开始回想练习');
    expect(html).not.toContain('这个义项已从当前档案移除');
  });

  it('does not reinterpret an existing draft when a restored custom ID belongs to a different sense', () => {
    const p = props();
    const oldWord = { ...seedWords[0], id: 'custom-restored', word: 'originalword', meaning: '旧义项' };
    p.state.custom.push({ ...oldWord, word: 'replacementword', meaning: '恢复后的另一个义项' });
    const review = renderToStaticMarkup(createElement(ReviewView, { ...p, items: [{ word: oldWord, mode: 'meaning' }], onDone: vi.fn() }));
    expect(review).toContain('这个练习的材料已更新');
    expect(review).not.toContain('ww-review-answer');
    const sheet = renderToStaticMarkup(createElement(WordSheet, { ...p, word: oldWord, onClose: vi.fn() }));
    expect(sheet).toContain('这个义项已从当前档案移除');
    expect(sheet).toContain('保留的联想草稿');
    expect(p.dispatch).not.toHaveBeenCalled();
  });
});
