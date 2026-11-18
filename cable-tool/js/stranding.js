/**
 * stranding.js — 电缆同心绞线结构计算核心
 * 纯计算模块,不依赖 DOM / three.js,可在浏览器和 Node(测试)中通用。
 *
 * 坐标约定:电缆轴向为 z,层 i(1..K)节圆半径 r_i = i·d·κ
 *   d  — 单丝直径 (mm)
 *   κ  — 紧压系数(圆线绞合 κ=1;紧压绞 0.88~0.93)
 *
 * 绞入率定义:λ = 单丝实际长度 / 电缆长度
 *   精确式  λ = sqrt(1 + (π·D节/h)²)   D节=节圆直径, h=节距
 *   手算近似 λ ≈ 1 + (π·D节/h)²/2     (泰勒展开,工厂手算常用)
 */

export const MATERIALS = {
  copper:   { name: '铜',   rho: 8.89  },
  aluminum: { name: '铝',   rho: 2.703 },
  alloy:    { name: '铝合金', rho: 2.8  },
};

export const DIR_NAME = { 1: '右向(Z)', '-1': '左向(S)' };

/** 第 i 层(1 起)正规排列根数 = 6i */
export function layerCapacity(i) { return 6 * i; }

/** K 层正规同心绞总容量 1+6+12+…+6K */
export function totalCapacity(K) { return 1 + 3 * K * (K + 1); }

/**
 * 第 i 层几何上最多能挤下的根数(单丝外切,圆心都在节圆上)
 * n_max = π / arcsin(d / (2r)) = π / arcsin(1/(2i))
 */
export function layerMaxFit(i) {
  return Math.floor(Math.PI / Math.asin(1 / (2 * i)) + 1e-9);
}

/** 绞入率精确式 */
export function layFactorExact(dPitch, h) {
  const t = Math.PI * dPitch / h;
  return Math.sqrt(1 + t * t);
}

/** 绞入率手算近似式(泰勒一阶) */
export function layFactorApprox(dPitch, h) {
  const t = Math.PI * dPitch / h;
  return 1 + t * t / 2;
}

/**
 * 螺旋线数值弧长积分(用于校验解析式)
 * 螺旋线 p(θ) = (r·cosθ, r·sinθ, (h/2π)·θ),一个节距 θ∈[0, 2π]
 */
export function layFactorNumeric(dPitch, h, steps = 200000) {
  const r = dPitch / 2;
  const dz = h / (2 * Math.PI);
  // 被积函数 sqrt(r² + dz²) 对 θ 为常数,辛普森积分即精确值;
  // 这里仍按通用数值积分实现,模拟"按螺旋线一点点量出来"的做法。
  const n = steps;
  const dTheta = 2 * Math.PI / n;
  let sum = 0;
  const f = (theta) => {
    const x = r * Math.cos(theta), y = r * Math.sin(theta);
    // 数值微分 ds/dθ
    const e = 1e-6;
    const dx = (r * Math.cos(theta + e) - x) / e;
    const dy = (r * Math.sin(theta + e) - y) / e;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  //  Simpson
  for (let i = 0; i < n; i++) {
    const t0 = i * dTheta, t1 = t0 + dTheta, tm = (t0 + t1) / 2;
    sum += (f(t0) + 4 * f(tm) + f(t1)) * dTheta / 6;
  }
  return sum / h; // 弧长 / 电缆长度
}

/**
 * 主计算入口。
 * @param {object} p
 *   area        导体标称截面 (mm²)
 *   wireDia     单丝直径 d (mm)
 *   layers      层数 K(不含中心丝)
 *   material    'copper' | 'aluminum' | 'alloy'
 *   mode        'round' 圆线同心绞 | 'compact' 紧压绞
 *   compaction  紧压系数 κ(仅 compact 有效,默认 0.90)
 *   outerDir    最外层绞向 1=右(Z) / -1=左(S),默认 -1
 *   ratioBasis  节距比基准 'pitch' 节圆直径 | 'outer' 层外径
 *   layRatioOuter 最外层节距比(默认 12)
 *   layRatioStep  每往内一层节距比增量(默认 2)
 *   layRatios   可选,数组按层覆盖 [第1层..第K层]
 */
export function computeStranding(p) {
  const {
    area, wireDia: d, layers: K,
    material = 'copper', mode = 'round',
    compaction = 0.90, outerDir = -1,
    ratioBasis = 'pitch',
    layRatioOuter = 12, layRatioStep = 2,
    layRatios = null,
  } = p;

  const kappa = mode === 'compact' ? compaction : 1.0;
  const warnings = [];
  const errors = [];

  // ---- 总根数 ----
  const wireArea = Math.PI / 4 * d * d;
  const nExact = area / wireArea;
  const N = Math.round(nExact);
  const areaActual = N * wireArea;
  if (Math.abs(nExact - N) > 0.5e-6) {
    warnings.push(`截面 ${area} mm² 不是单丝截面 ${wireArea.toFixed(4)} mm² 的整数倍,` +
      `按 ${N} 根取整,实际截面 ${areaActual.toFixed(2)} mm²(偏差 ${((areaActual / area - 1) * 100).toFixed(2)}%)`);
  }

  // ---- 分层排布 ----
  const capTotal = totalCapacity(K);
  const layers = [];
  let remaining = N - 1; // 中心丝
  if (remaining < 0) { errors.push('根数为 0,请检查截面与单丝直径'); remaining = 0; }

  for (let i = 1; i <= K; i++) {
    const cap = layerCapacity(i);
    const isOuter = i === K;
    let n;
    if (isOuter) {
      n = Math.min(remaining, cap);
    } else {
      n = Math.min(remaining, cap);
    }
    layers.push({ index: i, n, capacity: cap });
    remaining -= n;
  }
  if (remaining > 0) {
    errors.push(`第 ${K} 层排满后仍剩 ${remaining} 根排不下:` +
      `${K} 层正规同心绞最多容纳 ${capTotal} 根,需要 ${N} 根。请增加层数或改大单丝直径。`);
  }

  // ---- 逐层参数 ----
  const dirOf = (i) => ((K - i) % 2 === 0 ? outerDir : -outerDir); // 相邻层绞向相反
  let sumN = 1, sumNL = 1; // 中心丝 λ=1
  for (const L of layers) {
    const i = L.index;
    const r = i * d * kappa;
    L.radius = r;
    L.dPitch = 2 * r;
    L.dOuter = L.dPitch + d * kappa;
    L.dir = dirOf(i);
    L.maxFit = layerMaxFit(i);
    L.m = layRatios && layRatios[i - 1] != null
      ? layRatios[i - 1]
      : layRatioOuter + (K - i) * layRatioStep;
    const basisD = ratioBasis === 'outer' ? L.dOuter : L.dPitch;
    L.lay = L.m * basisD;                 // 节距 h
    L.lambda = layFactorExact(L.dPitch, L.lay);   // 绞入率(精确)
    L.lambdaApprox = layFactorApprox(L.dPitch, L.lay);
    // 状态判定
    L.status = [];
    if (L.n === 0) L.status.push({ level: 'warn', text: '该层无单丝' });
    if (L.n > L.maxFit) L.status.push({ level: 'error', text: `挤不下:几何最多 ${L.maxFit} 根` });
    else if (L.n > L.capacity) L.status.push({ level: 'error', text: `超出正规排列 ${L.capacity} 根` });
    if (L.n > 0 && L.n < L.capacity) {
      L.status.push({ level: 'warn', text: `排不满:正规应为 ${L.capacity} 根,实际 ${L.n} 根(缺 ${L.capacity - L.n} 根)` });
    }
    if (L.n > 0 && L.n <= L.maxFit && L.n > L.capacity) {
      // 理论上到不了这里(capacity<=maxFit),防御
    }
    if (L.status.length === 0) L.status.push({ level: 'ok', text: '正常' });
    sumN += L.n;
    sumNL += L.n * L.lambda;
  }

  // ---- 绞向检查(相邻层必须相反) ----
  for (let i = 1; i < layers.length; i++) {
    if (layers[i].n > 0 && layers[i - 1].n > 0 && layers[i].dir === layers[i - 1].dir) {
      errors.push(`第 ${layers[i - 1].index} 层与第 ${layers[i].index} 层绞向相同,违反相邻层反向规则`);
    }
  }

  // ---- 汇总 ----
  const dOut = (2 * K + 1) * d * kappa;
  const lambdaAvg = sumN > 0 ? sumNL / sumN : 1;
  const fillFactor = N * d * d / (dOut * dOut); // 金属面积 / 外接圆面积
  const rho = (MATERIALS[material] || MATERIALS.copper).rho;
  const weightPerKm = areaActual * lambdaAvg * rho; // kg/km

  // ---- 校验:解析式 vs 数值积分(取最外层,节距比最小、绞入率最大,误差最敏感) ----
  const outer = layers[layers.length - 1];
  const check = outer && outer.n > 0 ? {
    dPitch: outer.dPitch, lay: outer.lay,
    exact: outer.lambda,
    numeric: layFactorNumeric(outer.dPitch, outer.lay),
    approx: outer.lambdaApprox,
  } : null;
  if (check) {
    check.diffPct = Math.abs(check.numeric - check.exact) / check.exact * 100;
    check.approxDiffPct = Math.abs(check.approx - check.exact) / check.exact * 100;
  }

  return {
    input: { ...p, kappa },
    wireArea, nExact, N, areaActual,
    layers, errors, warnings,
    dOut, lambdaAvg, fillFactor, weightPerKm,
    totalWires: sumN,
    check,
  };
}
