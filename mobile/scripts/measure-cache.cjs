async page => {
  const original = page.url();
  await page.goto('http://127.0.0.1:5188');
  // Synthetic in-memory data only; never reads or changes a user's learning record.
  const result = await page.evaluate(async () => {
    const {initialState, seedWords, allWords, MODES} = await import('/@fs/D:/CODE/english-vocabulary/lib/learning.ts');
    const {StudyCache} = await import('/src/study-cache.ts');
    const state = initialState(), cache = new StudyCache();
    state.events = Array.from({length:10000},(_,i)=>({id:`perf-${i}`,wordId:seedWords[i%seedWords.length].id,mode:MODES[i%3],outcome:i%3?'correct':'wrong',delayed:i%2===0,at:i,answer:'',nextDue:i+1000}));
    const words = allWords(state), ids = new Set(words.filter(word=>word.tags.includes('CET6')).map(word=>word.id));
    const events = state.events.filter(event=>ids.has(event.wordId));
    const queries = ['a','book','time','work','care','n.','s','day','life',''];
    const previousSearch = i => words.filter(word=>word.tags.includes('CET6')&&`${word.word} ${word.meaning} ${word.pos}`.toLowerCase().includes(queries[i%queries.length]));
    const cachedSearch = i => cache.search(state,queries[i%queries.length],'CET6','all');
    const previousStats = () => {
      const delayed=events.filter(event=>event.delayed);
      const hinted=events.filter(event=>event.outcome==='hinted').length;
      const rates=MODES.map(mode=>{const tested=delayed.filter(event=>event.mode===mode);return {mode,total:tested.length,correct:tested.filter(event=>event.outcome==='correct').length};});
      const wrong=Object.entries(events.filter(event=>event.outcome==='wrong').reduce((counts,event)=>{counts[event.wordId]=(counts[event.wordId]??0)+1;return counts;},{})).sort((a,b)=>b[1]-a[1]).slice(0,6);
      return {events,delayed,hinted,rates,wrong};
    };
    const cachedStats = () => cache.stats(state);
    const sameSearch = queries.every((_,i)=>JSON.stringify(previousSearch(i))===JSON.stringify(cachedSearch(i)));
    const sameStats = JSON.stringify(previousStats())===JSON.stringify(cachedStats());
    let checksum=0;
    const measure = (fn, size, count) => {
      for(let i=0;i<20;i++) checksum+=size(fn(i));
      const values=[];
      for(let round=0;round<5;round++) {
        const start=performance.now();
        for(let i=0;i<count;i++) checksum+=size(fn(i));
        values.push((performance.now()-start)/count);
      }
      values.sort((a,b)=>a-b);
      return +values[2].toFixed(4);
    };
    const measurements = {
      search:{previousMs:measure(previousSearch,value=>value.length,300),cachedMs:measure(cachedSearch,value=>value.length,300)},
      statistics:{previousMs:measure(previousStats,value=>value.events.length+value.delayed.length,300),cachedMs:measure(cachedStats,value=>value.events.length+value.delayed.length,300)},
    };
    const bounds={queries:cache.searches.size,wordReferences:cache.searches.retainedWeight};
    cache.clear();
    return {pass:sameSearch&&sameStats&&checksum>0,environment:'Desktop Chromium, synthetic 10,000 events; warmed selector CPU time, median of five batches. Not end-to-end UI latency or device FPS.',measurements,bounds};
  });
  await page.goto(original);
  return JSON.stringify(result);
}
