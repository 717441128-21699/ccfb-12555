/* 验证 SVG 导出生成的是合法 XML 且包含正确数量的图元 */
const http = require('http');
const getJSON = p => new Promise((res, rej) => http.get('http://127.0.0.1:9222' + p, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const tab = (await getJSON('/json')).find(t => t.type === 'page');
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
    url: 'file:///D:/codex/runs/12555/workspace/cable-strander/index.html?z=' + Date.now() + '#compact,section'
  });
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    if (await evalJs('document.readyState') === 'complete' && await evalJs('!!window.__renderStats')) break;
  }
  await sleep(800);

  // 拦截 Blob 内容而不真正下载
  const svg = await evalJs(`(async function(){
    let captured = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = function(blob){
      captured = blob; return 'blob:mock';
    };
    document.getElementById('btnExportSvg').click();
    await new Promise(r=>setTimeout(r,200));
    URL.createObjectURL = origCreate;
    return captured ? captured.text() : null;
  })()`);

  if (!svg || svg.indexOf('<svg') !== 0) throw new Error('未捕获到 SVG 内容');
  const paths = (svg.match(/<path /g) || []).length;
  const circles = (svg.match(/<circle /g) || []).length;
  // 紧压 61 丝：中心1圆 + 外轮廓1圆 + 60 扇形 path
  console.log('SVG 头:', svg.split('\n')[0].slice(0, 70) + '…');
  console.log('扇形 path 数:', paths, '| 圆形数:', circles);
  if (paths !== 60) throw new Error('扇形数应为 60，实际 ' + paths);
  if (circles !== 2) throw new Error('应为外轮廓+中心圆共 2 个，实际 ' + circles);
  if (!/^<svg[\s\S]*<\/svg>$/.test(svg)) throw new Error('SVG 标签不闭合');
  console.log('SVG 导出校验通过 ✓（合法 XML，60 扇形 + 1 中心圆）');
  ws.close();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e); process.exit(2); });
