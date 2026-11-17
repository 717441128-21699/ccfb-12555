/* 对照探测：同一软件渲染器下，61 根 vs 1027 根的帧率，证明瓶颈在 SwiftShader 而非场景 */
const http = require('http');
const getJSON = p => new Promise((res, rej) => http.get('http://127.0.0.1:9222' + p, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function measure(url, label) {
  const tabs = await getJSON('/json');
  const tab = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pending = new Map();
  let loaded = 0;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Page.loadEventFired') loaded++;
  };
  const send = (method, params) => new Promise(res => {
    const id = ++mid; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  await send('Page.enable');
  await send('Page.navigate', { url });
  // 轮询等待：文档就绪 + 千丝钩子已生效（输入层数与 URL 一致）+ 渲染统计出现
  const expectBig = url.includes('big');
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const r = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        ready: document.readyState,
        layers: document.getElementById('inpLayers') && document.getElementById('inpLayers').value,
        stats: window.__renderStats
      })`, returnByValue: true
    });
    const v = JSON.parse(r.result.result.value);
    if (v.ready === 'complete' && v.stats &&
        (!expectBig || String(v.layers) === '18')) break;
  }
  await sleep(2000);
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({fps:document.getElementById("fpsBadge").textContent, st:window.__renderStats})',
      returnByValue: true
    });
    samples.push(JSON.parse(r.result.result.value));
    await sleep(1200);
  }
  ws.close();
  console.log(label);
  samples.forEach((s, i) => console.log('  采样' + (i + 1) + ':', s.fps,
    '| 实例', s.st.instances, '| drawCall', s.st.drawCalls, '| 丝', s.st.wires));
}

(async () => {
  const mk = () => 'file:///D:/codex/runs/12555/workspace/cable-strander/index.html?t=' + Date.now() + Math.random().toString(36).slice(2, 6);
  await measure(mk(), '【普通结构 61 根 / 1 节距】');
  await measure(mk() + '#big,len=0.5', '【千丝结构 1027 根 / 0.5 节距】');
  await measure(mk() + '#big,len=1', '【千丝结构 1027 根 / 1 节距】');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
