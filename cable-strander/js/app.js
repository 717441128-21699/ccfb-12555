/* app.js —— 界面交互、三维螺旋渲染、截面剖切 */
(function () {
  'use strict';
  var S = window.Strander;
  var TAU = S.TAU;
  var state = { result: null, displayLength: 1, clipFrac: 0.5, compactView: false };

  /* ============ 小工具 ============ */
  function $(id) { return document.getElementById(id); }
  function fmt(v, n) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toFixed(n == null ? 2 : n);
  }
  // 每层一个工业辨识色
  var LAYER_COLORS = [0x2e6fb5, 0xd98326, 0x3a9d54, 0xb5463c, 0x7d55a8,
    0x2597a3, 0xc7a02c, 0x8d5a3b, 0x5b7cc4, 0xa8447e];
  function layerColor(i) { return LAYER_COLORS[(i - 1) % LAYER_COLORS.length]; }

  /* ============ 层输入表 ============ */
  function rebuildLayerInputTable() {
    var n = Math.max(0, Math.min(30, parseInt($('inpLayers').value, 10) || 0));
    var tb = document.querySelector('#layerInputTable tbody');
    var old = {};
    tb.querySelectorAll('tr').forEach(function (tr) {
      old[tr.dataset.i] = { c: tr.querySelector('.c-count').value, m: tr.querySelector('.c-ratio').value };
    });
    tb.innerHTML = '';
    var firstDir = $('inpFirstDir').value;
    for (var i = 1; i <= n; i++) {
      var dir = (i % 2 === 1) ? firstDir : (firstDir === 'Z' ? 'S' : 'Z');
      var prev = old[String(i)] || {};
      var tr = document.createElement('tr');
      tr.dataset.i = i;
      tr.innerHTML =
        '<td>第 ' + i + ' 层</td>' +
        '<td><input type="number" class="c-count" min="1" step="1" value="' + (prev.c || S.standardCount(i)) + '"></td>' +
        '<td><input type="number" class="c-ratio" min="1" step="0.5" value="' + (prev.m || S.defaultRatio(i)) + '"></td>' +
        '<td><select class="c-dir"><option value="Z"' + (dir === 'Z' ? ' selected' : '') + '>Z</option>' +
        '<option value="S"' + (dir === 'S' ? ' selected' : '') + '>S</option></select></td>' +
        '<td class="c-check"><span class="badge ok">待算</span></td>';
      tb.appendChild(tr);
    }
  }

  function collectInput() {
    var rows = document.querySelectorAll('#layerInputTable tbody tr');
    var counts = [], ratios = [], directions = [];
    rows.forEach(function (tr) {
      counts.push(+tr.querySelector('.c-count').value);
      ratios.push(+tr.querySelector('.c-ratio').value);
      directions.push(tr.querySelector('.c-dir').value);
    });
    return {
      area: +$('inpArea').value,
      wireD: +$('inpD').value,
      layers: +$('inpLayers').value,
      counts: counts, ratios: ratios, directions: directions,
      firstDir: $('inpFirstDir').value,
      compacted: $('inpCompacted').checked,
      compactFactor: +$('inpCompactK').value
    };
  }

  /* ============ 计算与结果渲染 ============ */
  function runCalc() {
    var inp;
    try { inp = collectInput(); } catch (e) { alert('参数读取失败：' + e.message); return; }
    var r;
    try { r = S.designStructure(inp); }
    catch (e) { alert('输入有误：' + e.message); return; }
    state.result = r;

    // 行内校核徽标
    document.querySelectorAll('#layerInputTable tbody tr').forEach(function (tr, k) {
      var L = r.layers[k];
      var cell = tr.querySelector('.c-check');
      cell.innerHTML = '<span class="badge ' + L.status + '">' + L.statusText + '</span>';
      cell.title = L.detail || '相邻丝恰好相切，排列正常';
    });

    // 告警
    var wb = $('warnings');
    if (r.warnings.length) {
      wb.hidden = false;
      wb.innerHTML = '<h4>⚠ 工艺校核提示（' + r.warnings.length + ' 项）</h4><ul>' +
        r.warnings.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul>';
    } else wb.hidden = true;

    // 汇总卡片
    var fillLabel = r.input.compacted ? '紧压后有效填充系数' : '截面填充系数（金属/轮廓）';
    $('summary').innerHTML =
      kv(r.totalWires + ' 根', '单丝总数（1 + 3n(n+1)）') +
      kv(fmt(r.envelopeDiameter, 2) + ' mm', '绞合外径（未紧压）') +
      kv(fmt(r.metalArea, 2) + ' mm²', '金属总截面') +
      kv(fmt(r.areaDeviationPct, 2) + ' %', '相对标称截面偏差') +
      kv(fmt(r.overallLayFactorPct, 3) + ' %', '综合绞入率（按根数加权）') +
      kv(fmt(r.fillFactorPct, 2) + ' %', '几何填充系数') +
      kv(fmt(r.effectiveFillPct, 2) + ' %', fillLabel) +
      (r.compact ? kv(fmt(r.compact.diameter, 2) + ' mm', '紧压后外径（K=' + r.input.compactFactor + '）') : '') +
      detailRows(r);

    buildThree();
    drawSection();
  }

  function kv(b, s) { return '<div class="kv"><b>' + b + '</b><span>' + s + '</span></div>'; }

  function detailRows(r) {
    var rows = r.layers.map(function (L) {
      return '<tr><td>第 ' + L.index + ' 层</td><td>' + L.count + '</td>' +
        '<td>' + L.direction + '</td><td class="num">' + fmt(L.ratio, 1) + '</td>' +
        '<td class="num">' + fmt(L.pitch, 2) + '</td>' +
        '<td class="num">' + fmt(L.helixAngleDeg, 2) + '°</td>' +
        '<td class="num">' + fmt(L.layFactorPct, 3) + '%</td>' +
        '<td class="num">' + fmt(L.cumLayFactorPct, 3) + '%</td></tr>';
    }).join('');
    return '<div class="kv wide" style="background:none;padding:0"><div class="table-wrap detail-table">' +
      '<table><thead><tr><th>层</th><th>根数</th><th>绞向</th><th>节距比</th><th>节距 mm</th>' +
      '<th>螺旋角</th><th>层绞入率</th><th>累计绞入率</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></div>';
  }

  /* ============ 三维场景 ============ */
  var renderer, scene, camera, controls, strandGroup, envelopeMesh, clipPlane;
  var animId = null, autoRotate = true, lastT = performance.now(), frames = 0, fpsT = lastT;

  function initThree() {
    var host = $('threeHost');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f7fa);
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    var key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(60, 90, 70);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xdce8f5, 0.35);
    fill.position.set(-50, -30, -60);
    scene.add(fill);

    clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0); // 法向 -Y，常量随剖切位置更新
    strandGroup = new THREE.Group();
    scene.add(strandGroup);

    window.addEventListener('resize', resizeThree);
    resizeThree();
    animate();
  }

  function resizeThree() {
    var host = $('threeHost');
    var w = host.clientWidth || 800, h = host.clientHeight || 560;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function disposeGroup(g) {
    g.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
        else o.material.dispose();
      }
    });
    while (g.children.length) g.remove(g.children[0]);
  }

  // 扇形棱柱（紧压单丝）：xy 平面内扇环，z 向单位长，之后用实例矩阵摆放
  function sectorPrismGeometry(rIn, rOut, halfAngle) {
    var pts = [
      [rIn * Math.cos(-halfAngle), rIn * Math.sin(-halfAngle)],
      [rOut * Math.cos(-halfAngle), rOut * Math.sin(-halfAngle)],
      [rOut * Math.cos(halfAngle), rOut * Math.sin(halfAngle)],
      [rIn * Math.cos(halfAngle), rIn * Math.sin(halfAngle)]
    ];
    var v = [];
    for (var z = 0; z <= 1; z++) pts.forEach(function (p) { v.push(p[0], p[1], z - 0.5); });
    var idx = [
      0, 1, 2, 0, 2, 3,           // 底 z=0
      4, 6, 5, 4, 7, 6,           // 顶 z=1
      0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3,
      3, 7, 4, 3, 4, 0
    ];
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function buildThree() {
    var r = state.result;
    if (!r) return;
    disposeGroup(strandGroup);
    envelopeMesh = null;

    var d = r.input.wireD;
    var outerPitch = r.layers.length ? r.layers[r.layers.length - 1].pitch : 10 * d;
    var length = outerPitch * state.displayLength;
    var compact = r.compact;
    var clipping = $('chkClip').checked;
    // 自适应细节：丝数越多，每节距段数与截面边数越省，把实例/顶点预算压到 60 帧区间
    var adaptive = r.totalWires > 600 ? 1 : (r.totalWires > 200 ? 2 : 3);
    var segPerPitch = [0, 6, 8, 12][adaptive];
    var radialSides = [0, 6, 7, 9][adaptive];

    // 中心丝
    var centerR = compact ? compact.centerRadius : d / 2;
    var centerGeo = compact
      ? new THREE.CylinderGeometry(centerR, centerR, length, 24, 1, false)
      : new THREE.CylinderGeometry(centerR, centerR, length, radialSides + 3, 1, false);
    var centerMat = new THREE.MeshLambertMaterial({
      color: 0x8a97a3, flatShading: true,
      clippingPlanes: clipping ? [clipPlane] : []
    });
    strandGroup.add(new THREE.Mesh(centerGeo, centerMat));

    r.layers.forEach(function (L) {
      // 段数整除整根显示长度，使段间接缝只落在电缆两端；再按层错开，避免接缝排成环带
      var segCap = [0, 30, 36, 40][adaptive];
      var want = Math.max(4, Math.round(segPerPitch * length / L.pitch));
      var segs = Math.min(segCap, want);
      var segLen = length / segs * 1.02; // 搭接消缝隙（开放端无端盖，不会产生接缝环）
      var isCompact = !!compact;
      var geo, perWire = segs;

      if (isCompact) {
        var cl = compact.layers[L.index - 1];
        geo = sectorPrismGeometry(cl.rIn, cl.rOut, cl.sectorAngle / 2 * 0.985);
      } else {
        // 开放端圆柱：去掉段端面，相邻段搭接后接缝不再形成可见环带
        geo = new THREE.CylinderGeometry(d / 2, d / 2, segLen, radialSides, 1, true);
      }

      var mat = new THREE.MeshLambertMaterial({
        color: layerColor(L.index),
        // 圆截面丝用平滑法线消除段间接缝棱面；紧压扇形保留平直棱面
        flatShading: isCompact,
        clippingPlanes: clipping ? [clipPlane] : []
      });
      var mesh = new THREE.InstancedMesh(geo, mat, L.count * perWire);
      var m4 = new THREE.Matrix4();
      var q = new THREE.Quaternion();
      var e = new THREE.Euler();
      var pos = new THREE.Vector3();
      var scl = new THREE.Vector3();
      var id = 0;
      var phase0 = S.nestPhase(L.index);

      for (var w = 0; w < L.count; w++) {
        var wirePhase = phase0 + w * TAU / L.count;
        for (var s = 0; s < segs; s++) {
          var y0 = -length / 2 + (s + 0.5) * (length / segs);
          var theta = S.helixAngleAt(y0 + length / 2, L.pitch, L.dirSign, wirePhase);
          var Rc = L.radius;
          pos.set(Rc * Math.cos(theta), y0, Rc * Math.sin(theta));

          if (isCompact) {
            // 扇形棱柱：局部 z 沿螺旋切线，径向 x、周向 y
            var dTheta = L.dirSign * TAU / L.pitch;
            var tangent = new THREE.Vector3(-Rc * Math.sin(theta) * dTheta, 1, Rc * Math.cos(theta) * dTheta).normalize();
            var radial = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
            var circum = new THREE.Vector3().crossVectors(tangent, radial).normalize();
            var basis = new THREE.Matrix4().makeBasis(radial, circum, tangent);
            q.setFromRotationMatrix(basis);
            scl.set(1, 1, segLen); // 几何体 z 向单位长，拉伸到段长
          } else {
            // 圆柱局部 +Y 对齐螺旋切线；旋转轴 = Y×t（径向轴），角 = acos(t·Y)
            var tan = new THREE.Vector3(
              -Rc * Math.sin(theta) * L.dirSign * TAU / L.pitch,
              1,
              Rc * Math.cos(theta) * L.dirSign * TAU / L.pitch
            ).normalize();
            var axis = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
            q.setFromAxisAngle(axis, Math.acos(Math.max(-1, Math.min(1, tan.y))));
            scl.set(1, 1, 1);
          }
          m4.compose(pos, q, scl);
          mesh.setMatrixAt(id++, m4);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      strandGroup.add(mesh);
    });

    // 外轮廓透明圆筒
    if ($('chkEnvelope').checked) {
      var envR = compact ? compact.radius : r.envelopeRadius;
      var envGeo = new THREE.CylinderGeometry(envR, envR, length * 1.01, 48, 1, true);
      var envMat = new THREE.MeshBasicMaterial({
        color: 0x0f3a5f, wireframe: true, transparent: true, opacity: 0.18,
        clippingPlanes: clipping ? [clipPlane] : []
      });
      envelopeMesh = new THREE.Mesh(envGeo, envMat);
      strandGroup.add(envelopeMesh);
    }

    // 相机取景：竖向 fit 整根电缆，径向再留 2 倍半径余量，整体收紧
    var halfLen = length / 2;
    var rad = compact ? compact.radius : r.envelopeRadius;
    var fitDist = (halfLen + rad * 2.0) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    var dist = fitDist * 1.06;
    camera.position.set(dist * 0.38, length * 0.10 + 2, dist * 0.94);
    camera.near = Math.max(0.01, r.envelopeRadius / 100);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    updateClipPlane();

    // 渲染统计（测试/性能诊断用）
    var instCount = 0, drawCalls = 0;
    strandGroup.children.forEach(function (o) {
      if (o.isInstancedMesh) { instCount += o.instanceMatrix.count; drawCalls++; }
      else drawCalls++;
    });
    window.__renderStats = {
      wires: r.totalWires, instances: instCount, drawCalls: drawCalls,
      lengthMm: length, compacted: !!compact
    };
  }

  function updateClipPlane() {
    if (!state.result) return;
    var r = state.result;
    var outerPitch = r.layers.length ? r.layers[r.layers.length - 1].pitch : 10 * r.input.wireD;
    var length = outerPitch * state.displayLength;
    // plane: -Y + constant = 0 => 保留 y < constant 一侧（剖去上部）
    clipPlane.constant = length / 2 - state.clipFrac * length;
  }

  function animate(now) {
    animId = requestAnimationFrame(animate);
    now = now || performance.now();
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (autoRotate && strandGroup.children.length) strandGroup.rotation.y += dt * 0.45;
    controls.update();
    renderer.render(scene, camera);
    frames++;
    if (now - fpsT >= 1000) {
      $('fpsBadge').textContent = frames + ' fps';
      $('fpsBadge').style.color = frames >= 50 ? 'var(--ok)' : (frames >= 30 ? 'var(--warn)' : 'var(--bad)');
      frames = 0; fpsT = now;
    }
  }

  /* ============ 二维截面 ============ */
  function drawSection() {
    var r = state.result;
    var cv = $('sectionCanvas');
    if (!r) { return; }
    var frac = parseInt($('sectionPos').value, 10) / 100;
    $('sectionPosVal').textContent = Math.round(frac * 100) + '%';
    state.clipFrac = frac;

    var outerPitch = r.layers.length ? r.layers[r.layers.length - 1].pitch : 10 * r.input.wireD;
    var yAbs = frac * outerPitch * state.displayLength;
    var compact = r.compact && $('secCompactView').checked;

    var envR = (compact ? r.compact.radius : r.envelopeRadius);
    var pad = 24;
    var cssSize = Math.min($('sectionHost').clientWidth - 24, 620);
    var px = Math.max(280, cssSize);
    var dpr = window.devicePixelRatio || 1;
    cv.style.width = px + 'px';
    cv.style.height = px + 'px';
    cv.width = px * dpr; cv.height = px * dpr;
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cx = px / 2, cy = px / 2, scale = (px / 2 - pad) / envR;

    ctx.clearRect(0, 0, px, px);
    // 外轮廓
    ctx.beginPath();
    ctx.arc(cx, cy, envR * scale, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0f3a5f';
    ctx.stroke();

    var d = r.input.wireD;

    // 中心丝：紧压后也是完整圆（扇形的 rIn=0 情形用圆弧路径，避免反向弧绕序问题）
    if (compact) {
      fillSector(ctx, cx, cy, 0, r.compact.centerRadius * scale, 0, TAU, '#8a97a3');
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2 * scale, 0, TAU);
      ctx.fillStyle = '#8a97a3'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke();
    }

    r.layers.forEach(function (L) {
      var color = '#' + layerColor(L.index).toString(16).padStart(6, '0');
      var phase0 = S.nestPhase(L.index);
      var Rc = L.radius;
      for (var w = 0; w < L.count; w++) {
        var wirePhase = phase0 + w * TAU / L.count;
        var theta = S.helixAngleAt(yAbs, L.pitch, L.dirSign, wirePhase);
        var x = cx + Rc * scale * Math.cos(theta);
        var yy = cy + Rc * scale * Math.sin(theta);

        if (compact) {
          var cl = r.compact.layers[L.index - 1];
          var a0 = theta - cl.sectorAngle / 2, a1 = theta + cl.sectorAngle / 2;
          fillSector(ctx, cx, cy, cl.rIn * scale, cl.rOut * scale, a0, a1, color);
        } else {
          ctx.beginPath();
          ctx.arc(x, yy, d / 2 * scale, 0, TAU);
          ctx.fillStyle = color; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 0.8; ctx.stroke();
        }
      }
    });

    // 尺寸标注
    ctx.fillStyle = '#1d2733';
    ctx.font = '600 12px "Microsoft YaHei", sans-serif';
    var diaText = (compact ? '紧压外径 ' : '绞合外径 ') + (envR * 2).toFixed(2) + ' mm';
    ctx.fillText(diaText, 10, px - 12);
    updateClipPlane();
  }

  function fillSector(ctx, cx, cy, rIn, rOut, a0, a1, color) {
    ctx.beginPath();
    if (rIn <= 0.001) {
      // 整圆（中心丝），避免零半径反向弧造成的填充绕序问题
      ctx.arc(cx, cy, rOut, 0, TAU);
    } else {
      ctx.arc(cx, cy, rOut, a0, a1);
      ctx.arc(cx, cy, rIn, a1, a0, true);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function exportSvg() {
    if (!state.result) { alert('请先计算结构'); return; }
    var r = state.result;
    var frac = parseInt($('sectionPos').value, 10) / 100;
    var outerPitch = r.layers.length ? r.layers[r.layers.length - 1].pitch : 10 * r.input.wireD;
    var yAbs = frac * outerPitch * state.displayLength;
    var compact = r.compact && $('secCompactView').checked;
    var envR = compact ? r.compact.radius : r.envelopeRadius;
    var size = 600, pad = 24, sc = (size / 2 - pad) / envR, cx = size / 2, cy = size / 2;
    var svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">'];
    svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (envR * sc).toFixed(2) + '" fill="#fff" stroke="#0f3a5f" stroke-width="1.5"/>');
    var d = r.input.wireD;
    if (compact) {
      svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (r.compact.centerRadius * sc).toFixed(2) + '" fill="#8a97a3" stroke="rgba(0,0,0,.35)"/>');
    } else {
      svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (d / 2 * sc).toFixed(2) + '" fill="#8a97a3" stroke="rgba(0,0,0,.35)"/>');
    }
    r.layers.forEach(function (L) {
      var color = '#' + layerColor(L.index).toString(16).padStart(6, '0');
      var phase0 = S.nestPhase(L.index);
      for (var w = 0; w < L.count; w++) {
        var theta = S.helixAngleAt(yAbs, L.pitch, L.dirSign, phase0 + w * TAU / L.count);
        if (compact) {
          var cl = r.compact.layers[L.index - 1];
          var a0 = theta - cl.sectorAngle / 2, a1 = theta + cl.sectorAngle / 2;
          var large = (a1 - a0) > Math.PI ? 1 : 0;
          var p = [
            'M', cx + cl.rIn * sc * Math.cos(a0), cy + cl.rIn * sc * Math.sin(a0),
            'L', cx + cl.rOut * sc * Math.cos(a0), cy + cl.rOut * sc * Math.sin(a0),
            'A', cl.rOut * sc, cl.rOut * sc, 0, large, 1,
            cx + cl.rOut * sc * Math.cos(a1), cy + cl.rOut * sc * Math.sin(a1),
            'L', cx + cl.rIn * sc * Math.cos(a1), cy + cl.rIn * sc * Math.sin(a1),
            'A', cl.rIn * sc, cl.rIn * sc, 0, large, 0,
            cx + cl.rIn * sc * Math.cos(a0), cy + cl.rIn * sc * Math.sin(a0), 'Z'
          ].join(' ');
          svg.push('<path d="' + p + '" fill="' + color + '" stroke="rgba(0,0,0,.35)" stroke-width="0.8"/>');
        } else {
          svg.push('<circle cx="' + (cx + L.radius * sc * Math.cos(theta)).toFixed(2) +
            '" cy="' + (cy + L.radius * sc * Math.sin(theta)).toFixed(2) +
            '" r="' + (d / 2 * sc).toFixed(2) + '" fill="' + color + '" stroke="rgba(0,0,0,.3)" stroke-width="0.8"/>');
        }
      }
    });
    svg.push('</svg>');
    var blob = new Blob([svg.join('\n')], { type: 'image/svg+xml' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '绞线截面_' + r.totalWires + '丝.svg';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ============ 事件绑定 ============ */
  function bind() {
    $('inpLayers').addEventListener('input', rebuildLayerInputTable);
    $('inpFirstDir').addEventListener('change', rebuildLayerInputTable);
    $('inpCompacted').addEventListener('change', function () {
      $('inpCompactK').disabled = !this.checked;
      $('secCompactView').checked = this.checked;
      if (state.result) drawSection();
    });
    $('btnCalc').addEventListener('click', runCalc);
    $('btnSuggest').addEventListener('click', function () {
      var sug = S.suggestLayers(+$('inpArea').value, +$('inpD').value);
      $('inpLayers').value = sug.layers;
      rebuildLayerInputTable();
      alert('按截面估算需 ' + sug.layers + ' 层（' + sug.wiresProvided + ' 根），已填入，请复核后计算。');
    });
    $('btnPresetBig').addEventListener('click', function () {
      $('inpArea').value = 1000; $('inpD').value = 1.1; $('inpLayers').value = 18;
      $('inpCompacted').checked = false; $('inpCompactK').disabled = true;
      rebuildLayerInputTable();
      runCalc();
    });
    $('btnPrint').addEventListener('click', function () { window.print(); });

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        var three = t.dataset.tab === 'three';
        $('tab-three').hidden = !three;
        $('tab-section').hidden = three;
        if (three) resizeThree(); else drawSection();
      });
    });

    $('selLength').addEventListener('change', function () {
      state.displayLength = +this.value;
      buildThree();
    });
    $('chkEnvelope').addEventListener('change', buildThree);
    $('chkAutoRotate').addEventListener('change', function () { autoRotate = this.checked; });
    $('chkClip').addEventListener('change', function () {
      $('clipPos').disabled = !this.checked;
      buildThree();
    });
    $('clipPos').addEventListener('input', function () {
      state.clipFrac = +this.value / 100;
      $('sectionPos').value = this.value;
      updateClipPlane();
    });
    $('sectionPos').addEventListener('input', function () {
      $('clipPos').value = this.value;
      drawSection();
    });
    $('secCompactView').addEventListener('change', drawSection);
    $('btnExportSvg').addEventListener('click', exportSvg);
  }

  /* ============ 启动 ============ */
  rebuildLayerInputTable();
  bind();
  initThree();
  runCalc();

  // 测试钩子（无头浏览器用）：#compact / #section / #big / #clip / #len=0.5
  var h = location.hash.replace('#', '');
  if (h) {
    h.split(',').forEach(function (token) {
      if (token === 'compact') {
        $('inpCompacted').checked = true;
        $('inpCompactK').disabled = false;
        $('secCompactView').checked = true;
        runCalc();
      } else if (token === 'big') {
        $('btnPresetBig').click();
      } else if (token === 'section') {
        document.querySelector('.tab[data-tab="section"]').click();
      } else if (token === 'clip') {
        $('chkClip').checked = true;
        $('clipPos').disabled = false;
        buildThree();
      } else if (/^len=/.test(token)) {
        $('selLength').value = token.split('=')[1];
        state.displayLength = +$('selLength').value;
        buildThree();
      }
    });
  }
})();
