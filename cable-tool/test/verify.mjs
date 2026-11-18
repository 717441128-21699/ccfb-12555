// 校验绞入率解析式与数值积分(模拟手算/实测)的偏差 < 0.1%
// 运行: node test/verify.mjs
import { computeStranding, layFactorExact, layFactorNumeric, layFactorApprox, layerMaxFit, totalCapacity } from '../js/stranding.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg); if (!cond) fail++; };

// 1) 多组工况:解析式 vs 数值积分
const cases = [
  { area: 240, wireDia: 2.85, layers: 3, layRatioOuter: 12 },
  { area: 400, wireDia: 2.85, layers: 4, layRatioOuter: 10 },
  { area: 630, wireDia: 3.0,  layers: 5, layRatioOuter: 14 },
  { area: 95,  wireDia: 2.52, layers: 2, layRatioOuter: 16 },
  { area: 800, wireDia: 3.2,  layers: 6, layRatioOuter: 12 },
];
for (const c of cases) {
  const r = computeStranding({ ...c, material: 'copper' });
  const diff = r.check.diffPct;
  ok(diff < 0.1, `A=${c.area} K=${c.layers}: 绞入率 解析=${r.check.exact.toFixed(6)} 数值=${r.check.numeric.toFixed(6)} 偏差=${diff.toExponential(2)}% (<0.1%)`);
}

// 2) 手算近似式对照(仅作展示,允许 >0.1%)
{
  const r = computeStranding({ area: 240, wireDia: 2.85, layers: 3, layRatioOuter: 12 });
  console.log(`INFO  手算近似 λ≈1+(π/m)²/2 = ${r.check.approx.toFixed(6)},与精确式差 ${r.check.approxDiffPct.toFixed(4)}%`);
}

// 3) 结构规则
ok(layerMaxFit(1) === 6, `第1层几何容量 = ${layerMaxFit(1)} (应=6)`);
ok(totalCapacity(3) === 37, `3层总容量 = ${totalCapacity(3)} (应=37)`);
ok(totalCapacity(4) === 61, `4层总容量 = ${totalCapacity(4)} (应=61)`);

// 4) 相邻层绞向相反
{
  const r = computeStranding({ area: 240, wireDia: 2.85, layers: 3 });
  let alt = true;
  for (let i = 1; i < r.layers.length; i++) if (r.layers[i].dir === r.layers[i - 1].dir) alt = false;
  ok(alt, '相邻层绞向相反');
}

// 5) 排不下检测:强行少层数
{
  const r = computeStranding({ area: 500, wireDia: 2.0, layers: 2 });
  ok(r.errors.length > 0, `500mm²/2层 → 报错: ${r.errors[0] || '(无)'}`);
}

// 6) 排不满检测:最外层缺根
{
  const r = computeStranding({ area: 150, wireDia: 2.5, layers: 3 }); // N≈31, 外层 18 排不满
  const outer = r.layers[r.layers.length - 1];
  ok(outer.n < outer.capacity, `最外层 ${outer.n}/${outer.capacity} 根 → 标记排不满`);
}

// 7) 紧压模式填充系数提升
{
  const a = computeStranding({ area: 240, wireDia: 2.85, layers: 3, mode: 'round' });
  const b = computeStranding({ area: 240, wireDia: 2.85, layers: 3, mode: 'compact', compaction: 0.9 });
  ok(b.fillFactor > a.fillFactor, `填充系数 圆线=${a.fillFactor.toFixed(3)} < 紧压=${b.fillFactor.toFixed(3)}`);
}

process.exit(fail ? 1 : 0);
