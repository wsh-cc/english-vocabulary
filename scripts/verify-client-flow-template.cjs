/* global __FIXTURE__ */
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- The CLI evaluates this callback template.
async (page) => {
  const fixture = __FIXTURE__;
  const passages = fixture.passages.filter(passage => passage.level === fixture.state.settings.level);
  const check = (condition, message) => { if (!condition) throw Error('Client-flow assertion: ' + message); };
  check(passages.length >= 2, 'fixture needs two passages in the selected level');
  const ids = [...new Set(passages[0].wordIds)].slice(0, 2);
  check(ids.length === 2, 'fixture needs two known target word IDs');
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const waitUntil = async (predicate, message) => {
    const end = Date.now() + 7000;
    while (!(await predicate())) {
      if (Date.now() > end) throw Error('Client-flow timeout: ' + message);
      await page.waitForTimeout(25);
    }
  };
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const initialState = (withDue = false) => {
    const state = structuredClone(fixture.state);
    state.settings.onboarded = true;
    state.reading = { encounters: {}, completed: {} };
    state.progress = {};
    state.notes = {};
    state.familiar = {};
    state.learned = {};
    state.events = [];
    state.operations = [];
    if (withDue) for (const [index, id] of ids.entries()) state.progress[id] = {
      meaning: { due: index + 1, streak: 0, attempts: 0, correct: 0, hinted: 0, wrong: 0, last: 0, interval: 0 },
    };
    return state;
  };
  let scenario;
  const unexpected = [];
  const results = [];
  await page.setViewportSize({ width: fixture.width ?? 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.__clientFlowErrors = [];
    window.__clientFlowTools = {};
    addEventListener('error', event => window.__clientFlowErrors.push(event.message));
    addEventListener('unhandledrejection', event => window.__clientFlowErrors.push(String(event.reason)));
    // The app's own read-only learning-summary tool observes post-logout state.
    // This fixture exposes no write tool or real account/session information.
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool(tool, { signal }) {
        window.__clientFlowTools[tool.name] = tool;
        signal.addEventListener('abort', () => {
          if (window.__clientFlowTools[tool.name] === tool) delete window.__clientFlowTools[tool.name];
        });
      },
    } });
  });
  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/api/**', async route => {
    const current = scenario;
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = method === 'POST' ? request.postDataJSON() : null;
    current.requests.push({ path: url.pathname, method, action: body?.action ?? body?.type ?? '', etag: request.headers()['if-none-match'] ?? '' });
    const tag = revision => `"wordweave-regression-${revision}"`;
    const snapshot = () => ({ state: structuredClone(current.state), revision: current.revision });
    const respond = (data, status = 200, etag = null) => route.fulfill({
      status, contentType: 'application/json', headers: { 'cache-control': 'no-store', ...(etag ? { etag } : {}) },
      body: status === 304 ? '' : JSON.stringify(data),
    });
    if (url.pathname === '/api/auth' && method === 'POST' && body.action === 'logout') {
      current.signedIn = false;
      return respond({ ok: true });
    }
    if (url.pathname === '/api/state' && method === 'GET') {
      if (!current.signedIn) return respond({ error: 'Synthetic signed-out state.' }, 401);
      const etag = tag(current.revision);
      return respond({ ...snapshot(), user: { name: '回归合成账号' } }, request.headers()['if-none-match'] === etag ? 304 : 200, etag);
    }
    if (url.pathname === '/api/state' && method === 'POST' && body.type === 'result') {
      current.resultPayloads.push(body);
      if (!current.state.operations.includes(body.operationId)) {
        const now = Date.now();
        current.state.operations.push(body.operationId);
        current.state.events.push({ id: body.operationId, wordId: body.wordId, mode: body.mode, outcome: body.outcome, answer: body.answer, at: now, nextDue: now + 86400000, delayed: false });
        current.state.learned[body.wordId] = now;
        current.state.progress[body.wordId][body.mode] = { due: now + 86400000, streak: 1, attempts: 1, correct: 1, hinted: 0, wrong: 0, last: now, interval: 86400000 };
        current.revision++;
      }
      // The first result is recorded but its response fails: retry must reuse its ID.
      if (current.resultPayloads.length === 1) return respond({ error: '合成复习保存故障' }, 503);
      return respond(snapshot(), 200, tag(current.revision));
    }
    if (url.pathname === '/api/passages' && method === 'GET') {
      const selected = passages.find(passage => passage.id === url.searchParams.get('id'))
        ?? passages.find(passage => !current.state.reading.completed[passage.id]) ?? passages[0];
      return respond({
        passage: selected,
        history: passages.slice(0, 30).map(passage => ({ id: passage.id, title: passage.title, count: passage.wordIds.length, completed: !!current.state.reading.completed[passage.id] })),
        nextCursor: null, available: passages.length,
        completedCount: passages.filter(passage => current.state.reading.completed[passage.id]).length,
      });
    }
    if (url.pathname === '/api/passages' && method === 'POST' && body.action === 'next') {
      current.nextCount++;
      const index = passages.findIndex(passage => passage.id === body.afterId);
      return respond({ passage: passages[(index + 1) % passages.length] });
    }
    if (url.pathname === '/api/passages' && method === 'POST' && body.action === 'complete') {
      current.completeCount++;
      if (current.kind === 'reading-retry' && current.completeCount === 1) return respond({ error: '合成阅读保存故障' }, 503);
      const passage = passages.find(item => item.id === body.id);
      check(!!passage, 'completion must reference a fixture passage');
      if (!current.state.reading.completed[passage.id]) {
        const now = Date.now();
        current.state.reading.completed[passage.id] = now;
        for (const id of passage.wordIds) current.state.reading.encounters[id] = { count: 1, last: now };
        current.revision++;
      }
      const saved = snapshot();
      if (current.hold) {
        current.hold.started.resolve();
        await current.hold.release.promise;
      }
      return respond(saved, 200, tag(saved.revision));
    }
    // All unsupported API requests are fulfilled locally; never fall through.
    unexpected.push({ path: url.pathname, method, action: body?.action ?? body?.type ?? '' });
    return respond({ error: 'Unexpected synthetic API request.' }, 400);
  });
  const start = async (kind, hold = false) => {
    scenario = {
      kind, state: initialState(kind === 'review-retry'), revision: 1, signedIn: true,
      requests: [], resultPayloads: [], completeCount: 0, nextCount: 0,
      hold: hold ? { started: deferred(), release: deferred() } : null,
    };
    await page.reload();
    await page.getByRole('heading', { name: '今日学习', exact: true }).waitFor();
    return scenario;
  };
  const openReading = async () => {
    await page.getByRole('button', { name: '句子学习', exact: true }).click();
    await page.locator('.reading-paper h2').waitFor();
    check(await page.locator('.reading-paper h2').textContent() === passages[0].title, 'reading starts at first fixture passage');
  };
  const nextReady = async () => {
    await waitUntil(async () => await page.locator('.reading-paper h2').textContent() === passages[1].title && await page.locator('.reading-status').count() === 0, 'next paragraph renders and working status clears');
  };
  const focus = async () => {
    const count = scenario.requests.filter(item => item.path === '/api/state' && item.method === 'GET').length;
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await waitUntil(() => scenario.requests.filter(item => item.path === '/api/state' && item.method === 'GET').length > count, 'focus triggers one state request');
    await frames();
    return scenario.requests.filter(item => item.path === '/api/state' && item.method === 'GET').at(-1);
  };
  const noErrors = async () => check((await page.evaluate(() => window.__clientFlowErrors)).length === 0, 'no runtime error or unhandled rejection');

  try {
    const review = await start('review-retry');
    await page.locator('.sidebar-review').click();
    await page.getByRole('textbox', { name: '你的答案' }).fill('保留这份合成答案');
    await page.getByRole('button', { name: '提交并核对答案', exact: true }).click();
    await page.getByRole('button', { name: '核对后，独立答对', exact: true }).click();
    await page.getByText('合成复习保存故障', { exact: false }).waitFor();
    check((await page.locator('.review-heading > span').textContent()).includes('1 / 2'), 'failed result does not advance');
    check(await page.getByRole('textbox', { name: '你的答案' }).inputValue() === '保留这份合成答案', 'failed result preserves the answer');
    await page.getByRole('button', { name: '核对后，独立答对', exact: true }).click();
    await waitUntil(async () => (await page.locator('.review-heading > span').textContent()).includes('2 / 2'), 'result retry advances once');
    check(review.resultPayloads.length === 2, 'exactly two result attempts');
    check(review.resultPayloads[0].operationId === review.resultPayloads[1].operationId, 'retry reuses operationId');
    check(review.state.events.length === 1 && review.revision === 2, 'retry records the operation once');
    check(await page.getByRole('textbox', { name: '你的答案' }).inputValue() === '', 'next question starts with empty answer');
    await noErrors();
    results.push({ case: 'review-result-retry', pass: true, attempts: 2, events: 1, question: '2/2' });

    const retry = await start('reading-retry');
    await openReading();
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await page.getByText('合成阅读保存故障', { exact: false }).waitFor();
    check(retry.completeCount === 1 && retry.nextCount === 0, 'failed completion does not request next');
    check(Object.keys(retry.state.reading.completed).length === 0, 'failed completion does not mark read');
    check(await page.locator('.reading-paper h2').textContent() === passages[0].title, 'failure preserves current paragraph');
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await nextReady();
    check(retry.completeCount === 2 && retry.nextCount === 1, 'successful retry continues exactly once');
    await noErrors();
    results.push({ case: 'reading-complete-retry', pass: true, attempts: 2, next: 1 });

    const race = await start('reading-revision-race', true);
    await openReading();
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await waitUntil(() => race.completeCount === 1 && race.revision === 2, 'completion is saved but response remains held');
    race.state.notes[ids[0]] = '另一台合成设备后续更新';
    race.revision = 3;
    await focus();
    // The changed button proves the newer GET state reached the real UI first.
    await page.getByRole('button', { name: '继续下一段', exact: true }).waitFor();
    race.hold.release.resolve();
    await nextReady();
    check(race.nextCount === 1, 'successful old-revision completion still continues');
    const afterRace = await focus();
    check(afterRace.etag === '"wordweave-regression-3"', 'old save response does not downgrade revision-3 ETag');
    check(race.requests.filter(item => item.path === '/api/state' && item.method === 'GET').length === 3, 'reading save has no extra full-state GET');
    await noErrors();
    results.push({ case: 'reading-revision-race', pass: true, next: 1, latestEtag: 'revision-3' });

    const logout = await start('reading-logout-race', true);
    await openReading();
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await waitUntil(() => logout.completeCount === 1, 'reading response remains held before logout');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('button', { name: '登录词间', exact: true }).waitFor();
    const responseDone = page.waitForResponse(response => {
      const request = response.request();
      return new URL(response.url()).pathname === '/api/passages' && request.method() === 'POST' && request.postDataJSON().action === 'complete';
    });
    logout.hold.release.resolve();
    await (await responseDone).finished();
    await frames();
    check(logout.nextCount === 0, 'old reading completion cannot request next after logout');
    check(await page.locator('.account').count() === 0 && await page.locator('.reading-workspace').count() === 0, 'old completion cannot restore private UI');
    check(await page.getByRole('button', { name: '登录词间', exact: true }).isVisible(), 'the account remains signed out');
    const summary = await page.evaluate(() => window.__clientFlowTools.read_learning_summary.execute());
    check(summary.reading.covered === 0 && summary.reading.passages === 0 && summary.learned === 0, 'old completion does not repopulate cleared account state');
    check(logout.requests.filter(item => item.path === '/api/auth' && item.action === 'logout').length === 1, 'logout is fulfilled once by the local mock');
    await noErrors();
    results.push({ case: 'reading-logout-race', pass: true, next: 0, accountState: 'cleared' });
    check(unexpected.length === 0, 'no API request escapes the supported synthetic routes');
    return JSON.stringify({ pass: true, cases: results, api: 'fully mocked', learnerData: 'synthetic only' });
  } finally {
    scenario?.hold?.release.resolve();
  }
}
