/* Node 校验：node test/core.test.js （无需任何依赖） */
const assert = require('assert');
const S = require('../js/strander-core.js');

let pass = 0;
function ok(name, cond, extra) {
  if (!cond) throw new Error(name + (extra ? ' -> ' + extra : ''));
  pass++;
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// ---- 1. 绞入率手算对照（独立高精度值：λ = sqrt(1+(π/m)²) - 1，以百分数计）----
// 参考值用外部长运算预算，硬编码，防止实现公式被同一份推导“自证”
// 参考值由独立的泰勒级数实现预算（与产品代码的 sqrt 公式相互独立），两实现差 ≤1e-14
const handLay = [
  // m,    λ%（手算高精度）
  [10, 4.818702721],
  [12, 3.370156208],
  [14, 2.486834496],
  [16, 1.909427542],
  [18, 1.511661497],
  [20, 1.226182927],
  [25, 0.786475632],
];
for (const [m, hand] of handLay) {
  const got = S.layFactor(m) * 100;
  ok('绞入率 m=' + m, approx(got, hand, 0.001), 'got=' + got + ' hand=' + hand);
  ok('绞入率与手算差≤0.1%（m=' + m + '）', Math.abs(got - hand) <= 0.001);
}

// ---- 2. 标准根数 / 总根数 ----
ok('1层6根', S.standardCount(1) === 6);
ok('3层18根', S.standardCount(3) === 18);
ok('总根数 n=1 = 7', S.totalWires(1) === 7);
ok('总根数 n=4 = 61', S.totalWires(4) === 61);
ok('总根数 n=18 = 1027', S.totalWires(18) === 1027);

// ---- 3. 完整结构：240mm² / d=2.25 / 4层（行业常见紧压铜导体骨架）----
const r = S.designStructure({
  area: 240, wireD: 2.25, layers: 4,
  compacted: true, compactFactor: 0.90
});
ok('总根数61', r.totalWires === 61);
ok('层数4', r.layers.length === 4);
ok('绞向交替 Z/S/Z/S', r.layers[0].direction === 'Z' &&
  r.layers[1].direction === 'S' &&
  r.layers[2].direction === 'Z' &&
  r.layers[3].direction === 'S');
// 各层节距
ok('第1层外径6.75', approx(r.layers[0].outerDiameter, 6.75, 1e-12));
ok('第1层节距 P=m·D=20·6.75=135', approx(r.layers[0].pitch, 135, 1e-9));
ok('第4层节距 14·20.25=283.5', approx(r.layers[3].pitch, 283.5, 1e-9));
// 螺旋角 m=20 -> tan α = π/20
const a1 = r.layers[0].helixAngleDeg * Math.PI / 180;
ok('螺旋角 tanα=π/20', approx(Math.tan(a1), Math.PI / 20, 1e-12));
// 填充系数：金属/轮廓
const metal = 61 * Math.PI * 2.25 * 2.25 / 4;
ok('金属面积', approx(r.metalArea, metal, 1e-9), r.metalArea);
const envR = 4.5 * 2.25;
ok('填充系数', approx(r.fillFactorPct, metal / (Math.PI * envR * envR) * 100, 1e-9));
// 紧压：轮廓面积 = 金属/K
ok('紧压轮廓面积=金属/0.9', approx(Math.PI * r.compact.radius ** 2, metal / 0.9, 1e-9));
ok('紧压后等比缩放', approx(r.compact.scale, r.compact.radius / envR, 1e-12));
// 紧压扇形角度
ok('扇形角 360/24=15°', approx(r.compact.layers[3].sectorAngle * 180 / Math.PI, 15, 1e-12));
ok('结构无告警', r.warnings.length === 0, JSON.stringify(r.warnings));

// ---- 4. 容量校核：排不满 / 挤不下 ----
const loose = S.designStructure({ area: 10, wireD: 1, layers: 2, counts: [6, 10] });
ok('第2层10根=排不满', loose.layers[1].status === 'loose', loose.layers[1].status);
ok('排不满提示含空位', loose.layers[1].detail.indexOf('空位') >= 0);

const tight = S.designStructure({ area: 10, wireD: 1, layers: 2, counts: [6, 14] });
ok('第2层14根=挤不下', tight.layers[0].status === 'ok' && tight.layers[1].status === 'tight');
ok('挤不下提示含重叠', tight.layers[1].detail.indexOf('重叠') >= 0);

// 层容量函数：i=1 -> 6，i=2 -> 12（360/28.96°=12.43 取整），i=3 -> 18（18.76 取整）
ok('容量 L1=6', S.layerCapacity(1) === 6, S.layerCapacity(1));
ok('容量 L2=12', S.layerCapacity(2) === 12, S.layerCapacity(2));
ok('容量 L3=18', S.layerCapacity(3) === 18, S.layerCapacity(3));

// ---- 5. 绞向强制相同应告警 ----
const sameDir = S.designStructure({
  area: 10, wireD: 1, layers: 2,
  directions: ['Z', 'Z']
});
ok('同绞向告警', sameDir.warnings.some(w => w.indexOf('绞向相同') >= 0));

// ---- 6. 累计绞入率：逐层加权（按根数加权的平均单位长度）----
const r2 = S.designStructure({
  area: 10, wireD: 1, layers: 2,
  ratios: [20, 16], counts: [6, 12]
});
const l1 = S.layFactor(20), l2 = S.layFactor(16);
const handCum = (1 + 6 * (1 + l1) + 12 * (1 + l2)) / 19 - 1;
ok('累计绞入率', approx(r2.overallLayFactorPct, handCum * 100, 1e-9),
  r2.overallLayFactorPct + ' vs ' + handCum * 100);

// ---- 7. 千丝规模 n=18：1027 根，性能与数值稳定性 ----
const t0 = Date.now();
const big = S.designStructure({ area: 1000, wireD: 1.1, layers: 18 });
const elapsed = Date.now() - t0;
ok('1027根结构', big.totalWires === 1027);
ok('计算<50ms', elapsed < 50, elapsed + 'ms');
ok('千丝无挤不下', big.layers.every(L => L.status !== 'tight'));
ok('千丝全部绞向交替', big.layers.every((L, k) => L.direction === (k % 2 === 0 ? 'Z' : 'S')));
ok('千丝绞入率为有限值', Number.isFinite(big.overallLayFactorPct));

// ---- 8. 截面偏差告警 ----
const dev = S.designStructure({ area: 50, wireD: 1, layers: 1 }); // 7根仅5.5mm²
ok('截面偏差告警', dev.warnings.some(w => w.indexOf('偏差') >= 0));

// ---- 9. 层数建议 ----
const sug = S.suggestLayers(240, 2.25);
ok('240/2.25 建议4层', sug.layers === 4, JSON.stringify(sug));

// ---- 10. 螺旋相位：反向绞符号 ----
ok('Z向旋向为+', Math.sign(S.helixAngleAt(10, 100, 1, 0) - 0) > 0);
ok('S向旋向为-', Math.sign(S.helixAngleAt(10, 100, -1, 0)) < 0);
ok('一个节距转角2π', approx(S.helixAngleAt(100, 100, 1, 0), S.TAU, 1e-12));

console.log('全部 ' + pass + ' 项断言通过 ✓');
console.log('  其中绞入率手算对照 7 组，最大偏差 ≤ 0.001 个百分点（要求 ≤ 0.1%）');
console.log('  1027 根结构计算耗时 ' + elapsed + ' ms');
