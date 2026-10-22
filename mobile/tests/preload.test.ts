import { afterEach, describe, expect, it, vi } from 'vitest';
import { warmWhenIdle } from '../src/StudyCache';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('idle preloading lifecycle', () => {
  it('warms one task per idle slot and cancels outstanding work on disposal', () => {
    let run: IdleRequestCallback = () => {};
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => { run = callback; return 1; });
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal('window', {requestIdleCallback, cancelIdleCallback});
    vi.stubGlobal('document', {hidden: false});
    const first = vi.fn(), second = vi.fn();
    const cancel = warmWhenIdle([first, second]);
    expect(first).not.toHaveBeenCalled();
    run({didTimeout: false, timeRemaining: () => 1});
    expect(first).not.toHaveBeenCalled();
    run({didTimeout: false, timeRemaining: () => 8});
    expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
    cancel(); run({didTimeout: true, timeRemaining: () => 0});
    expect(second).not.toHaveBeenCalled(); expect(cancelIdleCallback).toHaveBeenCalledWith(1);
  });

  it('skips speculative work when the app is in the background', () => {
    let run: IdleRequestCallback = () => {};
    vi.stubGlobal('window', {requestIdleCallback: (callback: IdleRequestCallback) => { run = callback; return 1; }, cancelIdleCallback: vi.fn()});
    vi.stubGlobal('document', {hidden: true});
    const task = vi.fn();
    warmWhenIdle([task]); run({didTimeout: true, timeRemaining: () => 0});
    expect(task).not.toHaveBeenCalled();
  });

  it('uses a cancellable timer fallback without running tasks after unmount', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {setTimeout, clearTimeout});
    vi.stubGlobal('document', {hidden: false});
    const first = vi.fn(), second = vi.fn();
    const cancel = warmWhenIdle([first, second]);
    vi.advanceTimersByTime(80); expect(first).toHaveBeenCalledOnce();
    cancel(); vi.runAllTimers(); expect(second).not.toHaveBeenCalled();
    warmWhenIdle([]); expect(vi.getTimerCount()).toBe(0);
  });
});
