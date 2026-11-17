/* CDP 探测：Node 24 原生 WebSocket，测千丝结构帧率 / 实例数 / 控制台错误 */
const http = require('http');
const getJSON = p => new Promise((res, rej) => http.get('http://127.0.0.1:9222' + p, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (typeof WebSocket === 'undefined') {
  console.error('当前 Node 无原生 WebSocket，请用 Node 22+');
  process.exit(2);
}

(async () => {
  try {
    const tabs = await getJSON('/json');
    const tab = tabs.find(t => t.type === 'page');
    console.error('[cdp] target:', tab.url);

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let mid = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method) events.push(msg);
    };
    const send = (method, params) => new Promise(res => {
      const id = ++mid; pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    const origLen = events.length;

    console.error('[cdp] 导航到千丝场景…');
    await send('Page.navigate', {
      url: 'file:///D:/codex/runs/12555/workspace/cable-strander/index.html#big,len=0.5'
    });
    await sleep(5000);

    const probe = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        stats: window.__renderStats,
        fps: document.getElementById('fpsBadge').textContent
      })`,
      returnByValue: true
    });
    const info = JSON.parse(probe.result.result.value);

    await sleep(2500);
    const fps2 = (await send('Runtime.evaluate', {
      expression: 'document.getElementById("fpsBadge").textContent', returnByValue: true
    })).result.result.value;
    await sleep(2500);
    const fps3 = (await send('Runtime.evaluate', {
      expression: 'document.getElementById("fpsBadge").textContent', returnByValue: true
    })).result.result.value;

    const errors = [];
    for (const ev of events.slice(origLen)) {
      if (ev.method === 'Runtime.exceptionThrown') {
        errors.push('EXCEPTION: ' + (ev.params.exceptionDetails.exception &&
          ev.params.exceptionDetails.exception.description || ev.params.exceptionDetails.text));
      }
      if (ev.method === 'Log.entryAdded' && ev.params.entry.level === 'error') {
        errors.push('LOG: ' + ev.params.entry.text);
      }
    }

    console.log('渲染统计:', JSON.stringify(info.stats));
    console.log('FPS 采样1:', info.fps, '| 采样2:', fps2, '| 采样3:', fps3);
    console.log('错误:', errors.length ? errors.join('\n') : '无（0 条控制台异常/错误）');
    ws.close();
    process.exit(errors.length ? 1 : 0);
  } catch (e) {
    console.error('PROBE FAIL:', e && e.stack || e);
    process.exit(2);
  }
})();
