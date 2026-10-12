/* global __FIXTURE__, saveRegression */
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- The CLI evaluates this callback template.
async (page) => {
  const fixture = __FIXTURE__;
  /* __SAVE_MODULE__ */
  const {applyAction,createSaveDelta}=saveRegression;
  const passages = fixture.passages.filter(passage => passage.level === fixture.state.settings.level);
  const check = (condition, message) => { if (!condition) throw Error('Client-flow assertion: ' + message); };
  check(passages.length >= 3, 'fixture needs three passages in the selected level');
  const coursePassages = state => fixture.passages.filter(passage => passage.level === state.settings.level);
  const completedCount = state => coursePassages(state).filter(passage => state.reading?.completed[passage.id]).length;
  const nextReading = (state, afterId) => {
    const course = coursePassages(state);
    if (!course.length) return null;
    const start = afterId ? course.findIndex(passage => passage.id === afterId) + 1 : 0;
    const ordered = [...course.slice(start), ...course.slice(0, start)];
    return ordered.find(passage => !state.reading?.completed[passage.id]) ?? ordered[0];
  };
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
      if(current.getHold&&!current.getHeld){current.getHeld=true;await current.getHold.release.promise;}
      if(current.failRecovery&&current.resultPayloads.length===1){current.failRecovery=false;return respond({error:'合成同步故障'},503);}
      if (!current.signedIn) return respond({ error: 'Synthetic signed-out state.' }, 401);
      const etag = tag(current.revision);
      return respond({ ...snapshot(), user: { name: '回归合成账号' } }, request.headers()['if-none-match'] === etag ? 304 : 200, etag);
    }
    if (url.pathname === '/api/state' && method === 'POST' && body.type === 'result') {
      current.resultPayloads.push(body);
      const base=current.revision;
      const isNew=!current.state.operations.includes(body.operationId);
      const canDelta=request.headers()['x-wordweave-delta-base']===tag(base)&&isNew;
      if(isNew){applyAction(current.state,body);current.revision++;}
      if(current.kind==='review-retry'&&current.resultPayloads.length===1)return respond({error:'合成复习保存故障'},503);
      const delta=canDelta?createSaveDelta(current.state,body,base):null;
      if(delta&&['review-fallback','review-recovery'].includes(current.kind))delta.eventCount++;
      const saved=delta??snapshot(), savedTag=tag(current.revision);
      if(current.hold){current.hold.started.resolve();await current.hold.release.promise;}
      current.lastSaveKind=delta?'delta':'full';
      return respond(saved,200,savedTag);
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
      if (current.kind === 'reading-legacy-next-retry' && current.nextCount === 1) return respond({ error: '合成下一段加载故障' }, 503);
      return respond({ passage: nextReading(current.state, body.afterId), completedCount: completedCount(current.state) });
    }
    if (url.pathname === '/api/passages' && method === 'POST' && body.action === 'complete') {
      current.completeCount++;
      current.completePayloads.push(structuredClone(body));
      if (current.kind === 'reading-retry' && current.completeCount === 1) return respond({ error: '合成阅读保存故障' }, 503);
      const passage = coursePassages(current.state).find(item => item.id === body.id);
      check(!!passage, 'completion must reference a fixture passage');
      if (!current.state.operations.includes(body.operationId)) {
        applyAction(current.state, { type: 'reading-complete', operationId: body.operationId, passage });
        current.revision++;
      }
      // Freeze both the authoritative snapshot and its selected passage before
      // holding the response, so a later writer cannot update the old payload.
      const saved = {
        ...snapshot(),
        ...(body.advance && !current.kind.startsWith('reading-legacy') ? {
          passage: structuredClone(nextReading(current.state, body.id)),
          completedCount: completedCount(current.state),
        } : {}),
      };
      if (current.kind === 'reading-response-lost' && current.completeCount === 1) return route.abort('failed');
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
      kind, state: initialState(kind.startsWith('review')), revision: 1, signedIn: true,
      requests: [], resultPayloads: [], completePayloads: [], completeCount: 0, nextCount: 0,
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
  const nextReady = async (expected = passages[1]) => {
    await waitUntil(async () => await page.locator('.reading-paper h2').textContent() === expected.title && await page.locator('.reading-status').count() === 0, 'next paragraph renders and working status clears');
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

    const openReview=async()=>{
      await page.locator('.sidebar-review').click();
      await page.getByRole('textbox',{name:'你的答案'}).fill('保留这份合成答案');
      await page.getByRole('button',{name:'提交并核对答案',exact:true}).click();
    };
    const answer=()=>page.getByRole('button',{name:'核对后，独立答对',exact:true}).click();
    const advanced=()=>waitUntil(async()=>(await page.locator('.review-heading > span').textContent()).includes('2 / 2'),'confirmed save advances to question 2');
    for(const kind of ['review-delta','review-fallback','review-recovery']){
      const test=await start(kind);test.failRecovery=kind==='review-recovery';
      await openReview();await answer();
      if(kind==='review-recovery'){
        await page.getByText('合成同步故障',{exact:false}).waitFor();
        check((await page.locator('.review-heading > span').textContent()).includes('1 / 2'),'failed recovery retains question');
        check(await page.getByRole('textbox',{name:'你的答案'}).inputValue()==='保留这份合成答案','failed recovery retains answer');
        await answer();
        check(test.resultPayloads[0].operationId===test.resultPayloads[1].operationId,'recovery retry reuses operation ID');
      }
      await advanced();
      check(test.state.events.length===1,'delta/fallback records exactly once');
      check(test.lastSaveKind===(kind==='review-recovery'?'full':'delta'),'expected response contract is used');
      const expectedGets=kind==='review-delta'?1:2;
      check(test.requests.filter(r=>r.path==='/api/state'&&r.method==='GET').length===expectedGets,'only an incompatible delta triggers recovery GET');
      const conditional=await focus();check(conditional.etag==='"wordweave-regression-2"','save advances the conditional validator');
      await noErrors();results.push({case:kind,pass:true,events:1});
    }
    for(const kind of ['review-revision-race','review-expired-session']){
      const test=await start(kind,true);await openReview();
      // Start refresh before saving; saves deliberately suppress new refreshes.
      test.getHold={release:deferred()};
      await page.evaluate(()=>dispatchEvent(new Event('focus')));
      await waitUntil(()=>test.getHeld,'refresh is in flight before save');
      await answer();await waitUntil(()=>test.resultPayloads.length===1&&test.revision===2,'result saved with held response');
      if(kind==='review-expired-session'){test.signedIn=false;}else{test.state.notes[ids[1]]='另一台设备更新';test.revision=3;}
      test.getHold.release.resolve();
      if(kind==='review-expired-session'){
        await page.getByRole('button',{name:'登录词间',exact:true}).waitFor();
        const done=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state'&&r.request().method()==='POST');
        test.hold.release.resolve();await (await done).finished();await frames();
        const summary=await page.evaluate(()=>window.__clientFlowTools.read_learning_summary.execute());
        check(summary.learned===0,'late delta cannot repopulate expired account');
        check(await page.getByRole('button',{name:'登录词间',exact:true}).isVisible(),'expired session stays signed out');
      }else{
        await waitUntil(async()=>(await page.evaluate(()=>window.__clientFlowTools.read_learning_summary.execute())).learned===1,'newer GET applied before delta');
        test.hold.release.resolve();await advanced();
        const conditional=await focus();check(conditional.etag==='"wordweave-regression-3"','late delta cannot downgrade newer validator');
        check(test.state.events.length===1,'late delta does not duplicate event');
      }
      await noErrors();results.push({case:kind,pass:true});
    }

    const retry = await start('reading-retry');
    await openReading();
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await page.getByText('合成阅读保存故障', { exact: false }).waitFor();
    check(retry.completeCount === 1 && retry.nextCount === 0, 'failed completion does not request next');
    check(Object.keys(retry.state.reading.completed).length === 0, 'failed completion does not mark read');
    check(await page.locator('.reading-paper h2').textContent() === passages[0].title, 'failure preserves current paragraph');
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await nextReady();
    check(retry.completeCount === 2 && retry.nextCount === 0, 'successful retry continues from the combined response without a next request');
    check(retry.completePayloads.every(payload => payload.advance === true), 'read-and-continue requests the combined contract');
    check(retry.completePayloads[0].operationId === retry.completePayloads[1].operationId, 'reading retry reuses its operation ID');
    check(retry.revision === 2 && Object.keys(retry.state.reading.completed).length === 1, 'successful retry records one reading completion');
    await noErrors();
    results.push({ case: 'reading-complete-retry', pass: true, attempts: 2, next: 0 });

    const saveOnly = await start('reading-save-only');
    await openReading();
    await page.getByRole('button', { name: '读完，保存进度', exact: true }).click();
    await page.getByRole('button', { name: '阅读进度已保存', exact: true }).waitFor();
    check(saveOnly.completeCount === 1 && saveOnly.nextCount === 0, 'save-only does not navigate');
    check(saveOnly.completePayloads[0].advance !== true, 'save-only does not request a next passage');
    check(await page.locator('.reading-paper h2').textContent() === passages[0].title, 'save-only keeps the current paragraph');
    await page.getByRole('button', { name: '继续下一段', exact: true }).click();
    await nextReady();
    check(saveOnly.completeCount === 1 && saveOnly.nextCount === 1, 'continuing an already read paragraph only requests next');
    check(Object.keys(saveOnly.state.reading.completed).length === 1, 'displaying the next paragraph does not mark it read');
    await noErrors();
    results.push({ case: 'reading-save-only-then-next', pass: true, complete: 1, next: 1 });

    const saveOnlyRace = await start('reading-save-only-race', true);
    await openReading();
    await page.getByRole('button', { name: '读完，保存进度', exact: true }).click();
    await waitUntil(() => saveOnlyRace.completeCount === 1 && saveOnlyRace.revision === 2, 'save-only completion is committed but its response is held');
    saveOnlyRace.state.notes[ids[0]] = '只保存乱序后续联想';
    saveOnlyRace.revision = 3;
    await focus();
    await page.getByRole('button', { name: '阅读进度已保存', exact: true }).waitFor();
    saveOnlyRace.hold.release.resolve();
    await waitUntil(async () => {
      const count = await page.locator('.reading-progress > div').nth(1).locator('strong').textContent();
      return count.replace(/\s/g, '') === `1/${passages.length}篇` && await page.locator('.reading-status').count() === 0;
    }, 'save-only old response updates the completed count without navigation');
    check(await page.locator('.reading-paper h2').textContent() === passages[0].title, 'save-only revision race keeps the first paragraph');
    check(saveOnlyRace.completeCount === 1 && saveOnlyRace.nextCount === 0, 'save-only revision race does not request next');
    const afterSaveOnlyRace = await focus();
    check(afterSaveOnlyRace.etag === '"wordweave-regression-3"', 'save-only old response preserves the newest validator');
    await noErrors();
    results.push({ case: 'reading-save-only-revision-race', pass: true, complete: 1, next: 0, completed: 1, latestEtag: 'revision-3' });

    const toolbarLayouts = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await start('reading-toolbar-layout-' + width, true);
      await openReading();
      const paperTop = await page.evaluate(() => document.querySelector('.reading-paper').getBoundingClientRect().top + scrollY);
      await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
      await waitUntil(() => layout.completeCount === 1, 'reading response is held while the toolbar status renders');
      await page.locator('.reading-status').waitFor();
      await page.locator('.reading-status').scrollIntoViewIfNeeded();
      await frames();
      const geometry = await page.evaluate(() => {
        const paper = document.querySelector('.reading-paper').getBoundingClientRect();
        const status = document.querySelector('.reading-status').getBoundingClientRect();
        return {
          paperTop: paper.top + scrollY,
          status: { left: status.left, right: status.right, top: status.top, bottom: status.bottom },
          viewport: { width: innerWidth, height: innerHeight },
          scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        };
      });
      const topChange = Math.abs(geometry.paperTop - paperTop);
      check(topChange <= 0.5, 'toolbar status preserves the paper document position at width ' + width);
      check(geometry.status.left >= -0.5 && geometry.status.right <= geometry.viewport.width + 0.5
        && geometry.status.top >= -0.5 && geometry.status.bottom <= geometry.viewport.height + 0.5,
      'toolbar status stays within the viewport at width ' + width);
      check(geometry.scrollWidth <= geometry.viewport.width + 0.5, 'reading status causes no horizontal page overflow at width ' + width);
      layout.hold.release.resolve();
      await nextReady();
      check(layout.completeCount === 1 && layout.nextCount === 0, 'layout check advances through the combined response at width ' + width);
      await noErrors();
      toolbarLayouts.push({ width, paperTopChange: topChange, horizontalOverflow: false });
    }
    await page.setViewportSize({ width: fixture.width ?? 1440, height: 900 });
    results.push({ case: 'reading-toolbar-layout', pass: true, widths: toolbarLayouts });

    const legacy = await start('reading-legacy-fallback');
    await openReading();
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await nextReady();
    check(legacy.completeCount === 1 && legacy.nextCount === 1, 'missing combined passage falls back to one next request');
    check(legacy.completePayloads[0].advance === true, 'new client requests advance from the synthetic old server');
    await noErrors();
    results.push({ case: 'reading-legacy-passage-fallback', pass: true, complete: 1, next: 1 });

    const nextRetry = await start('reading-legacy-next-retry');
    await openReading();
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await page.getByText('合成下一段加载故障', { exact: false }).waitFor();
    check(nextRetry.completeCount === 1 && nextRetry.nextCount === 1, 'legacy next fails after the reading save succeeds');
    check(nextRetry.revision === 2 && !!nextRetry.state.reading.completed[passages[0].id], 'next failure retains committed reading progress');
    check(await page.locator('.reading-paper h2').textContent() === passages[0].title, 'next failure retains the current paragraph');
    await page.getByRole('button', { name: '继续下一段', exact: true }).click();
    await nextReady();
    check(nextRetry.completeCount === 1 && nextRetry.nextCount === 2, 'next retry does not repeat completion');
    check(nextRetry.revision === 2, 'next retry does not add a state revision');
    await noErrors();
    results.push({ case: 'reading-legacy-next-retry', pass: true, complete: 1, next: 2 });

    const lost = await start('reading-response-lost');
    await openReading();
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await page.locator('.error-banner[role="alert"]').waitFor();
    check(lost.completeCount === 1 && lost.nextCount === 0, 'lost completion response does not advance the client');
    check(lost.revision === 2 && !!lost.state.reading.completed[passages[0].id], 'the server committed before its response was lost');
    check(await page.locator('.reading-paper h2').textContent() === passages[0].title, 'lost response preserves the current paragraph');
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await nextReady();
    check(lost.completeCount === 2 && lost.nextCount === 0, 'retry receives the committed combined result without a next request');
    check(lost.completePayloads[0].operationId === lost.completePayloads[1].operationId, 'lost-response retry reuses the operation ID');
    check(lost.revision === 2 && lost.state.operations.length === 1, 'lost-response retry does not create a second operation or revision');
    check(Object.keys(lost.state.reading.completed).length === 1 && lost.state.reading.encounters[passages[0].wordIds[0]].count === 1, 'lost-response retry counts the paragraph and encounter once');
    await noErrors();
    results.push({ case: 'reading-committed-response-lost', pass: true, attempts: 2, revision: 2, next: 0 });

    const race = await start('reading-revision-race', true);
    await openReading();
    await page.getByRole('button', { name: '读完，继续下一段', exact: true }).click();
    await waitUntil(() => race.completeCount === 1 && race.revision === 2, 'completion is saved but response remains held');
    race.state.notes[ids[0]] = '另一台合成设备后续更新';
    applyAction(race.state, { type: 'reading-complete', operationId: crypto.randomUUID(), passage: passages[1] });
    race.revision = 3;
    await focus();
    // The changed button proves the newer GET state reached the real UI first.
    await page.getByRole('button', { name: '继续下一段', exact: true }).waitFor();
    race.hold.release.resolve();
    await nextReady(passages[2]);
    check(race.nextCount === 1, 'old-revision completion fetches a fresh next passage instead of displaying its stale selection');
    check(Object.keys(race.state.reading.completed).length === 2, 'fresh selection preserves both devices reading progress');
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
    scenario?.getHold?.release.resolve();
  }
}
