import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readingPassages } from '@/lib/curriculum';
import { initialState, seedWords, type State } from '@/lib/learning';
import type { LearningSnapshot } from '../src/data';
import { PersonalDetail, PersonalPage, personalTotals } from '../src/PersonalPage';
import { defaultProfile } from '../src/profile';

function populatedState(): State {
  const state = initialState();
  const cet4 = readingPassages.find(passage => passage.level === 'CET4')!;
  const cet6 = readingPassages.find(passage => passage.level === 'CET6')!;
  const word4 = seedWords.find(word => word.tags.includes('CET4'))!;
  const word6 = seedWords.find(word => word.tags.includes('CET6') && word.id !== word4.id)!;
  const unseen = seedWords.find(word => word.id !== word4.id && word.id !== word6.id)!;
  state.reading = {
    completed: {[cet4.id]: 1000, [cet6.id]: 2000, 'removed-passage': 3000},
    encounters: {
      [word4.id]: {count: 5, last: 1000}, [word6.id]: {count: 1, last: 2000},
      [unseen.id]: {count: 0, last: 1000}, 'removed-word': {count: 10, last: 3000},
    },
  };
  state.events = [
    {id: 'practice-4', wordId: word4.id, mode: 'meaning', outcome: 'hinted', at: 1000, delayed: false, answer: 'test', nextDue: 2000},
    {id: 'practice-6', wordId: word6.id, mode: 'recall', outcome: 'wrong', at: 2000, delayed: true, answer: 'test', nextDue: 3000},
  ];
  return state;
}

function props(state = initialState()) {
  const snapshot: LearningSnapshot = {
    state, user: {userId: 'personal-page-test', name: '原账号名'}, profile: defaultProfile(),
    locked: false, revision: 1, pending: 0, conflicts: [], needsLogin: false,
    syncing: false, lastSync: 0, error: '', hasRecovery: false,
  };
  return {snapshot, busy: false, syncLabel: '已保存在本机', onSection: vi.fn(), onStats: vi.fn(), onRead: vi.fn(), onSave: vi.fn(async () => {})};
}

describe('personal homepage totals and content', () => {
  it('counts unique known reading and encountered words across both levels without inflating repeat encounters', () => {
    const state = populatedState();
    expect(personalTotals(state)).toEqual({passages: 2, encountered: 2, practices: 2});
    state.settings.level = 'CET4';
    expect(personalTotals(state)).toEqual({passages: 2, encountered: 2, practices: 2});
    state.settings.level = 'CET6';
    expect(personalTotals(state)).toEqual({passages: 2, encountered: 2, practices: 2});
  });

  it('tolerates pre-reading backups and does not count familiarity or progress as reading contact', () => {
    const state = initialState();
    delete state.reading;
    state.familiar[seedWords[0].id] = 'known';
    state.learned[seedWords[0].id] = 1000;
    expect(personalTotals(state)).toEqual({passages: 0, encountered: 0, practices: 0});
  });

  it('shows the account fallback, real zero totals and a reading action before any learning', () => {
    const input = props();
    const html = renderToStaticMarkup(createElement(PersonalPage, input));
    expect(html).toContain('原账号名');
    expect(html).toContain('还没有学习足迹，从一篇阅读开始吧。');
    expect(html).toContain('开始阅读');
    for (const metric of ['passages', 'encountered', 'practices']) expect(html).toContain(`data-profile-total="${metric}">0</dd>`);
    expect(html).toContain('学习偏好');
    expect(html).toContain('同步与账号');
    expect(html).toContain('数据与备份');
    expect(html).toContain('关于词间');
    expect(input.onRead).not.toHaveBeenCalled();
    expect(input.onSave).not.toHaveBeenCalled();
  });

  it('renders the saved identity and real accumulated totals without calling contact mastery', () => {
    const input = props(populatedState());
    input.snapshot.profile = {nickname: '林间读者', signature: '每天读一点。', avatar: 'sprout'};
    const html = renderToStaticMarkup(createElement(PersonalPage, input));
    expect(html).toContain('林间读者');
    expect(html).toContain('每天读一点。');
    expect(html).not.toContain('还没有学习足迹');
    for (const metric of ['passages', 'encountered', 'practices']) expect(html).toContain(`data-profile-total="${metric}">2</dd>`);
    expect(html).toContain('接触词数');
    expect(html).toContain('累计全部学习记录 · 阅读接触不代表已掌握');
    expect(html).not.toContain('已掌握词数');
    expect(input.onSection).not.toHaveBeenCalled();
  });

  it('renders user-supplied identity as text and keeps synchronization status visible', () => {
    const input = props();
    input.snapshot.profile = {nickname: '<script>alert(1)</script>', signature: '<img src=x onerror=alert(1)>', avatar: 'initial'};
    input.snapshot.pending = 3;
    input.syncLabel = '待同步 3 项';
    const html = renderToStaticMarkup(createElement(PersonalPage, input));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('3 项记录等待同步');
    expect(html).toContain('待同步 3 项');
  });

  it('provides a labeled return action for the secondary page and respects saving lock', () => {
    const onBack = vi.fn();
    const html = renderToStaticMarkup(createElement(PersonalDetail, {title: '数据与备份', subtitle: '保存学习的足迹。', onBack, busy: true, children: createElement('p', null, '备份操作')}));
    expect(html).toMatch(/<button[^>]+disabled=""[^>]+aria-label="返回个人主页"/);
    expect(html).toContain('备份操作');
    expect(onBack).not.toHaveBeenCalled();
  });
});
