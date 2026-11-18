// app.js — 界面装配:输入 → 计算 → 表格/汇总 → 三维与截面视图
import { computeStranding, MATERIALS, DIR_NAME } from './stranding.js';
import { createView3D } from './view3d.js';
import { createView2D } from './view2d.js';

const $ = (id) => document.getElementById(id);
const fmt = (x, n = 2) => Number(x).toFixed(n);

const view3d = createView3D($('view3d'));
const view2d = createView2D($('sectionCanvas'));

let result = null;
let layRatioOverrides = [];   // 逐层节距比手工修改
let lastStructureKey = '';    // 结构参数变化时清空逐层修改

function readInputs() {
  return {
    area: parseFloat($('area').value),
    wireDia: parseFloat($('wireDia').value),
    layers: parseInt($('layers').value, 10),
    material: $('material').value,
    mode: $('mode').value,
    compaction: parseFloat($('compaction').value),
    outerDir: parseInt($('outerDir').value, 10),
    ratioBasis: $('ratioBasis').value,
    layRatioOuter: parseFloat($('layRatioOuter').value),
    layRatioStep: parseFloat($('layRatioStep').value),
  };
}

function valid(p) {
  return p.area > 0 && p.wireDia > 0 && p.layers >= 1 &&
    p.layRatioOuter > 0 && isFinite(p.compaction);
}

function recalc() {
  const p = readInputs();
  if (!valid(p)) return;
  $('compRow').classList.toggle('hidden', p.mode !== 'compact');

  // 结构参数(影响根数分布)变化时,丢弃逐层节距比修改
  const key = [p.area, p.wireDia, p.layers, p.mode, p.compaction].join('|');
  if (key !== lastStructureKey) { layRatioOverrides = []; lastStructureKey = key; }
  if (layRatioOverrides.length) p.layRatios = layRatioOverrides;

  result = computeStranding(p);
  renderSummary();
  renderMessages();
  renderTable();
  renderCheck();
  rebuild3D();
  redraw2D();
}

// ---------- 汇总 ----------
function renderSummary() {
  const r = result;
  const mat = MATERIALS[r.input.material].name;
  $('summary').innerHTML = [
    [`${r.totalWires}`, `总根数(理论 ${fmt(r.nExact, 1)})`],
    [`${fmt(r.areaActual, 1)} mm²`, '实际金属截面'],
    [`Ø${fmt(r.dOut)} mm`, '绞线外径'],
    [`${fmt(r.fillFactor * 100, 1)} %`, '截面填充系数'],
    [`${fmt((r.lambdaAvg - 1) * 100, 2)} %`, '平均绞入率(加权)'],
    [`${fmt(r.weightPerKm, 0)} kg/km`, `单位重量(${mat})`],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');
}

// ---------- 提示信息 ----------
function renderMessages() {
  const r = result;
  const items = [
    ...r.errors.map(t => `<li class="error">✕ ${t}</li>`),
    ...r.warnings.map(t => `<li class="warn">⚠ ${t}</li>`),
  ];
  $('msgCard').classList.toggle('hidden', items.length === 0);
  $('msgs').innerHTML = items.join('');
}

// ---------- 分层表 ----------
function renderTable() {
  const tb = $('layerTable').querySelector('tbody');
  tb.innerHTML = '';
  result.layers.forEach((L, i) => {
    const tr = document.createElement('tr');
    const worst = L.status.find(s => s.level === 'error') || L.status.find(s => s.level === 'warn') || L.status[0];
    tr.innerHTML =
      `<td class="c">${L.index}</td>` +
      `<td>${L.n} / ${L.capacity}</td>` +
      `<td>${fmt(L.dPitch)}</td>` +
      `<td><input type="number" step="any" min="1" value="${fmt(L.m, 1)}" data-i="${i}"></td>` +
      `<td>${fmt(L.lay, 1)}</td>` +
      `<td class="c">${DIR_NAME[String(L.dir)]}</td>` +
      `<td>${fmt((L.lambda - 1) * 100, 2)}%</td>` +
      `<td class="c"><span class="tag ${worst.level}">${worst.level === 'ok' ? '正常' : worst.level === 'warn' ? '排不满' : '挤不下'}</span></td>`;
    tr.title = L.status.map(s => s.text).join(';');
    tb.appendChild(tr);
  });
  tb.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!(v > 0)) return;
      const arr = result.layers.map(L => L.m);
      arr[+inp.dataset.i] = v;
      layRatioOverrides = arr;
      recalc();
    });
  });
}

// ---------- 绞入率校验 ----------
function renderCheck() {
  const c = result.check;
  if (!c) { $('checkCard').innerHTML = ''; return; }
  $('checkCard').innerHTML =
    `<h2>绞入率校核(最外层)</h2>` +
    `精确式 λ=√(1+(πD/h)²) = <b>${fmt(c.exact, 6)}</b><br>` +
    `螺旋线数值积分 = <b>${fmt(c.numeric, 6)}</b>,偏差 <b>${c.diffPct.toExponential(2)}%</b>(要求 ≤0.1%)<br>` +
    `手算近似 1+(π/m)²/2 = ${fmt(c.approx, 6)}(与精确式差 ${fmt(c.approxDiffPct, 4)}%,仅供参考)`;
}

// ---------- 三维 ----------
let rebuildTimer = 0;
function rebuild3D() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    if (!result || !result.layers.some(l => l.n > 0)) return;
    const lenScale = $('lenScale').value / 100;
    $('lenVal').textContent = (lenScale).toFixed(1) + ' 节距';
    view3d.build(result, lenScale, $('quality').value);
    applyClip();
  }, 120);
}
function applyClip() {
  const on = $('clipOn').checked;
  const z = ($('clipZ').value / 1000) * view3d.length;
  view3d.setClip(on, z);
}

// ---------- 截面 ----------
function redraw2D() {
  if (!result) return;
  const outer = result.layers.filter(l => l.n > 0).pop();
  const L = outer ? outer.lay * ($('lenScale').value / 100) : 100;
  const z = ($('secZ').value / 1000) * L;
  $('secZVal').textContent = `z = ${z.toFixed(0)} mm`;
  view2d.draw(result, z);
}

// ---------- 复制结果 ----------
function copyResult() {
  if (!result) return;
  const r = result;
  const lines = [
    `导体 ${r.input.area} mm² / 单丝 Ø${r.input.wireDia} mm / ${r.input.layers} 层 / ${MATERIALS[r.input.material].name}` +
    (r.input.mode === 'compact' ? ` / 紧压 κ=${r.input.kappa}` : ' / 圆线同心绞'),
    `总根数 ${r.totalWires},实际截面 ${fmt(r.areaActual, 1)} mm²,外径 Ø${fmt(r.dOut)} mm,` +
    `填充系数 ${fmt(r.fillFactor * 100, 1)}%,平均绞入率 ${fmt((r.lambdaAvg - 1) * 100, 2)}%,重量 ${fmt(r.weightPerKm, 0)} kg/km`,
    '层\t根数\t节圆Ø\t节距比\t节距\t绞向\t绞入率',
    ...r.layers.map(L =>
      `${L.index}\t${L.n}\t${fmt(L.dPitch)}\t${fmt(L.m, 1)}\t${fmt(L.lay, 1)}\t${DIR_NAME[String(L.dir)]}\t${fmt((L.lambda - 1) * 100, 2)}%`),
  ];
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    $('copy').textContent = '已复制 ✓';
    setTimeout(() => ($('copy').textContent = '复制结果'), 1200);
  });
}

// ---------- 事件 ----------
['area', 'wireDia', 'layers', 'material', 'mode', 'compaction', 'outerDir',
 'ratioBasis', 'layRatioOuter', 'layRatioStep'].forEach(id => {
  $(id).addEventListener('input', recalc);
  $(id).addEventListener('change', recalc); // select 在部分浏览器只触发 change
});
$('run').addEventListener('click', recalc);
$('copy').addEventListener('click', copyResult);
$('lenScale').addEventListener('input', () => { rebuild3D(); redraw2D(); });
$('quality').addEventListener('change', rebuild3D);
$('clipOn').addEventListener('change', applyClip);
$('clipZ').addEventListener('input', applyClip);
$('secZ').addEventListener('input', redraw2D);

// 标签页
$('tab3d').addEventListener('click', () => {
  $('tab3d').classList.add('on'); $('tab2d').classList.remove('on');
  $('view3d').classList.remove('hidden'); $('view2d').classList.add('hidden');
  view3d.resize();
});
$('tab2d').addEventListener('click', () => {
  $('tab2d').classList.add('on'); $('tab3d').classList.remove('on');
  $('view2d').classList.remove('hidden'); $('view3d').classList.add('hidden');
  redraw2D();
});

// 帧率显示
setInterval(() => { $('fps').textContent = `${view3d.getFps()} fps · 拖拽旋转 / 滚轮缩放`; }, 500);

// URL 参数预置(便于分享配置): ?area=400&wireDia=2.25&layers=4&mode=compact&tab=2d
const q = new URLSearchParams(location.search);
for (const [k, v] of q) {
  const el = $(k);
  if (!el) continue;
  if (el.type === 'checkbox') el.checked = v !== '0' && v !== 'false';
  else if ('value' in el) el.value = v;
}
if (q.get('tab') === '2d') $('tab2d').click();

recalc();
