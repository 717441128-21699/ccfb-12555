/*
 * strander-core.js
 * 电缆同心绞（束合/紧压）结构计算核心 —— 纯逻辑，无 DOM 依赖。
 * 浏览器中挂到 window.Strander；Node 下通过 module.exports 引用，供单元测试复用。
 *
 * 几何约定（同心绞标准模型）：
 *   中心 1 根，第 i 层 (i=1..n) 标准根数 6i，总根数 N = 1 + 3n(n+1)
 *   第 i 层单丝中心所在圆半径 R_i = i·d，层外径 D_i = (2i+1)·d
 *   节距 P_i = m_i·D_i（m 为节距比）
 *   螺旋角 α：tan α = πD/P = π/m
 *   绞入率 λ = secα − 1 = sqrt(1 + (π/m)^2) − 1
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.Strander = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TAU = Math.PI * 2;

  function standardCount(i) { return 6 * i; }
  function totalWires(n) { return 1 + 3 * n * (n + 1); }
  function layerRadius(i, d) { return i * d; }
  function layerOuterDiameter(i, d) { return (2 * i + 1) * d; }
  function helixAngle(ratio) { return Math.atan(Math.PI / ratio); }
  // 绞入率（小数），节距比 m
  function layFactor(ratio) {
    return Math.sqrt(1 + Math.pow(Math.PI / ratio, 2)) - 1;
  }
  // 第 i 层按同层相邻单丝相切推算的最大可容纳根数
  function layerCapacity(i) {
    var beta = 2 * Math.asin(1 / (2 * i)); // 相邻丝圆心夹角下限
    return Math.floor(TAU / beta + 1e-9);
  }
  function defaultRatio(i) { return Math.max(12, 22 - 2 * i); }

  // 由导体截面与单丝直径估算所需层数
  function suggestLayers(area, d) {
    var nNeed = (4 * area) / (Math.PI * d * d);
    var n = 0;
    while (totalWires(n) < nNeed && n < 60) n++;
    return { layers: n, wiresNeeded: nNeed, wiresProvided: totalWires(n) };
  }

  /**
   * @param {object} inp
   *   area         标称导体截面 mm²
   *   wireD        单丝直径 mm
   *   layers       层数（不含中心）
   *   counts       可选，自定义每层根数数组（缺省 6i）
   *   ratios       可选，自定义每层节距比数组
   *   firstDir     第一层绞向 'Z'|'S'，缺省 'Z'，其余层自动反向
   *   directions   可选，显式指定每层绞向（与 firstDir 二选一）
   *   compacted    是否紧压绞
   *   compactFactor 紧压目标填充系数，缺省 0.90
   */
  function designStructure(inp) {
    var area = +inp.area, d = +inp.wireD, n = Math.max(0, Math.floor(+inp.layers || 0));
    if (!(area > 0) || !(d > 0)) throw new Error('导体截面和单丝直径必须为正数');
    if (n > 60) throw new Error('层数过多（上限 60）');

    var compacted = !!inp.compacted;
    var K = inp.compactFactor != null ? +inp.compactFactor : 0.90;
    if (compacted && !(K > 0 && K < 1)) throw new Error('紧压系数须在 0~1 之间');

    var warnings = [];
    var layers = [];
    var totalLen = 1; // 中心丝按 1 倍电缆长度计
    var totalCount = 1;
    var firstDir = inp.firstDir === 'S' ? 'S' : 'Z';

    for (var i = 1; i <= n; i++) {
      var count = (inp.counts && inp.counts[i - 1] != null) ? Math.floor(+inp.counts[i - 1]) : standardCount(i);
      var ratio = (inp.ratios && inp.ratios[i - 1] != null) ? +inp.ratios[i - 1] : defaultRatio(i);
      var dir;
      if (inp.directions && inp.directions[i - 1]) dir = inp.directions[i - 1] === 'S' ? 'S' : 'Z';
      else dir = (i % 2 === 1) ? firstDir : (firstDir === 'Z' ? 'S' : 'Z');

      if (!(count > 0)) throw new Error('第 ' + i + ' 层根数必须为正整数');
      if (!(ratio > 0)) throw new Error('第 ' + i + ' 层节距比必须为正数');

      var R = layerRadius(i, d);
      var D = layerOuterDiameter(i, d);
      var pitch = ratio * D;
      var alpha = helixAngle(ratio);
      var lambda = layFactor(ratio);

      // 同层容量校核：相邻丝圆心角 β = 2asin(d/2R)
      var beta = 2 * Math.asin(Math.min(1, d / (2 * R)));
      var cap = Math.floor(TAU / beta + 1e-9);
      var usedAngle = count * beta;
      var status = 'ok', statusText = '正常', detail = '';
      if (usedAngle > TAU + 1e-9) {
        status = 'tight';
        var overlapRad = usedAngle - TAU;
        var overlapMm = R * overlapRad;
        statusText = '挤不下';
        detail = '该层最多容纳 ' + cap + ' 根，现排 ' + count + ' 根，相邻丝周向重叠约 ' + overlapMm.toFixed(2) + ' mm';
        warnings.push('第 ' + i + ' 层挤不下：' + detail);
      } else if (count < standardCount(i)) {
        status = 'loose';
        var gapDeg = (TAU - usedAngle) * 180 / Math.PI;
        statusText = '排不满';
        detail = '标准应排 ' + standardCount(i) + ' 根，现排 ' + count + ' 根，尚有空位 ' +
          Math.max(0, cap - count) + ' 个，周向空隙合计约 ' + gapDeg.toFixed(1) + '°';
        warnings.push('第 ' + i + ' 层排不满：' + detail);
      } else if (count > cap) { // 根数达到/超过标准但几何上仍超限
        status = 'tight';
        statusText = '挤不下';
        detail = '该层最多容纳 ' + cap + ' 根，现排 ' + count + ' 根';
        warnings.push('第 ' + i + ' 层挤不下：' + detail);
      }

      totalLen += count * (1 + lambda);
      totalCount += count;
      var cumFactor = totalLen / totalCount - 1;

      layers.push({
        index: i,
        count: count,
        direction: dir,
        dirSign: dir === 'Z' ? 1 : -1,
        ratio: ratio,
        radius: R,
        meanDiameter: 2 * R,
        outerDiameter: D,
        pitch: pitch,
        helixAngleDeg: alpha * 180 / Math.PI,
        layFactorPct: lambda * 100,
        cumLayFactorPct: cumFactor * 100,
        capacity: cap,
        status: status,
        statusText: statusText,
        detail: detail
      });
    }

    // 相邻层绞向相反校核
    for (var j = 1; j < layers.length; j++) {
      if (layers[j].direction === layers[j - 1].direction) {
        warnings.push('第 ' + j + '、' + (j + 1) + ' 层绞向相同（' + layers[j].direction +
          '），同心绞相邻层必须反向');
      }
    }

    var envRadius = (n + 0.5) * d; // 绞合外轮廓半径（未紧压）
    var metalArea = totalCount * Math.PI * d * d / 4;
    var fillFactor = metalArea / (Math.PI * envRadius * envRadius);
    var areaDev = (metalArea - area) / area * 100;
    if (Math.abs(areaDev) > 3) {
      warnings.push('金属总截面 ' + metalArea.toFixed(1) + ' mm² 与标称 ' + area.toFixed(1) +
        ' mm² 偏差 ' + areaDev.toFixed(1) + '%，超过 ±3%，建议调整单丝直径或层数');
    }

    var out = {
      input: { area: area, wireD: d, layers: n, compacted: compacted, compactFactor: K, firstDir: firstDir },
      totalWires: totalCount,
      layers: layers,
      envelopeRadius: envRadius,
      envelopeDiameter: 2 * envRadius,
      metalArea: metalArea,
      nominalArea: area,
      areaDeviationPct: areaDev,
      fillFactorPct: fillFactor * 100,
      overallLayFactorPct: n === 0 ? 0 : (totalLen / totalCount - 1) * 100,
      warnings: warnings,
      compact: null
    };

    if (compacted) {
      // 紧压后金属面积不变，轮廓面积 = 金属面积 / K，整体等比缩小
      var compactRadius = Math.sqrt(metalArea / (Math.PI * K));
      var scale = compactRadius / envRadius;
      var compactLayers = layers.map(function (L) {
        return {
          index: L.index,
          count: L.count,
          rIn: scale * (L.index - 0.5) * d,
          rOut: scale * (L.index + 0.5) * d,
          sectorAngle: TAU / L.count
        };
      });
      out.compact = {
        factor: K,
        scale: scale,
        radius: compactRadius,
        diameter: 2 * compactRadius,
        centerRadius: scale * d / 2,
        layers: compactLayers
      };
      out.effectiveFillPct = K * 100;
    } else {
      out.effectiveFillPct = fillFactor * 100;
    }
    return out;
  }

  // 螺旋线上高度 y 处的圆心角（rad）。phase 为层初始相位，sign 由绞向决定
  function helixAngleAt(y, pitch, sign, phase) {
    return phase + sign * TAU * y / pitch;
  }

  // 第 i 层相对内层的嵌套相位（外层丝落入内层两根丝之间的沟槽）
  function nestPhase(i) {
    if (i <= 1) return 0;
    return Math.PI / standardCount(i - 1);
  }

  return {
    TAU: TAU,
    standardCount: standardCount,
    totalWires: totalWires,
    layerRadius: layerRadius,
    layerOuterDiameter: layerOuterDiameter,
    helixAngle: helixAngle,
    layFactor: layFactor,
    layerCapacity: layerCapacity,
    defaultRatio: defaultRatio,
    suggestLayers: suggestLayers,
    designStructure: designStructure,
    helixAngleAt: helixAngleAt,
    nestPhase: nestPhase
  };
});
