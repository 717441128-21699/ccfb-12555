/* 端到端校核：通过 CDP 模拟工艺员输入，验证排不满/挤不下/同绞向告警链路 */
const http = require('http');
const getJSON = p => new Promise((res, rej) => http.get('http://127.0.0.1:9222' + p, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scenario(name, setup) {
  const tabs = await getJSON('/json');
  const tab = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => {
    const id = ++mid; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evalJs = async expr => (await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true
  })).result.result.value;

  await send('Page.enable');
  await send('Page.navigate', {
    url: 'file:///D:/codex/runs/12555/workspace/cable-strander/index.html?z=' + Date.now() + Math.random()
  });
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    const ready = await evalJs('document.readyState');
    if (ready === 'complete' && await evalJs('!!window.__renderStats')) break;
  }
  await sleep(500);

  await evalJs(setup);
  await evalJs("document.getElementById('btnCalc').click()");
  await sleep(300);
  const result = await evalJs(`JSON.stringify({
    warnings: (function(){ var w=document.getElementById('warnings');
      return w.hidden ? [] : Array.from(w.querySelectorAll('li')).map(li=>li.textContent); })(),
    badges: Array.from(document.querySelectorAll('#layerInputTable .c-check .badge'))
      .map(b => b.className.replace('badge ','') + ':' + b.textContent),
    overallLay: document.querySelectorAll('#summary .kv b')[4].textContent
  })`);
  console.log('\n=== ' + name + ' ===');
  console.log(JSON.parse(result));
  ws.close();
}

(async () => {
  // 场景1：第2层只排10根 -> 排不满
  await scenario('排不满（L2=10 根，标准12）', `
    document.getElementById('inpLayers').value = 2;
    document.getElementById('inpLayers').dispatchEvent(new Event('input'));
    var rows = document.querySelectorAll('#layerInputTable tbody tr');
    rows[1].querySelector('.c-count').value = 10;
  `);

  // 场景2：第2层塞14根 -> 挤不下
  await scenario('挤不下（L2=14 根，容量12）', `
    document.getElementById('inpLayers').value = 2;
    document.getElementById('inpLayers').dispatchEvent(new Event('input'));
    var rows = document.querySelectorAll('#layerInputTable tbody tr');
    rows[1].querySelector('.c-count').value = 14;
  `);

  // 场景3：两层强制同绞向
  await scenario('同绞向（两层都 Z）', `
    document.getElementById('inpLayers').value = 2;
    document.getElementById('inpLayers').dispatchEvent(new Event('input'));
    var rows = document.querySelectorAll('#layerInputTable tbody tr');
    rows[1].querySelector('.c-dir').value = 'Z';
  `);

  // 场景4：截面严重不匹配
  await scenario('截面偏差（50mm² 只排 1 层 7 根）', `
    document.getElementById('inpArea').value = 50;
    document.getElementById('inpLayers').value = 1;
    document.getElementById('inpLayers').dispatchEvent(new Event('input'));
  `);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
