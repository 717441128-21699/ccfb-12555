// view3d.js — 三维绞线结构:每根单丝按螺旋线生成,逐层 InstancedMesh 实例化
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 螺旋线路径:半径 r,节距 h,方向 dir(+1/-1),长度 len,沿 Z 轴
class HelixCurve extends THREE.Curve {
  constructor(r, h, dir, len) { super(); this.r = r; this.h = h; this.dir = dir; this.len = len; }
  getPoint(t, target = new THREE.Vector3()) {
    const z = t * this.len;
    const th = this.dir * 2 * Math.PI * z / this.h;
    return target.set(this.r * Math.cos(th), this.r * Math.sin(th), z);
  }
}

// 紧压扇形截面沿螺旋线扫掠成的几何体
// 截面:节圆两侧 ±dκ/2 的圆环扇形,半角 β=π/n,在 (径向N, 副法向B) 平面内
function sectorHelixGeometry(r, h, dir, len, halfThick, beta, tubularSegs, arcSegs) {
  // 截面轮廓(闭合):外弧 a→b,内弧 b→a
  const prof = [];
  const a = -halfThick, b = halfThick;
  for (let i = 0; i <= arcSegs; i++) {
    const ph = -beta + (2 * beta * i) / arcSegs;
    prof.push([r + b * Math.cos(ph) - r, b * Math.sin(ph)]); // (u沿径向, v沿周向) — u 相对于节圆
  }
  for (let i = arcSegs; i >= 0; i--) {
    const ph = -beta + (2 * beta * i) / arcSegs;
    prof.push([a * Math.cos(ph), a * Math.sin(ph)]);
  }
  const P = prof.length;
  const pos = new Float32Array((tubularSegs + 1) * P * 3);
  const idx = [];
  const p = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  let k = 0;
  for (let s = 0; s <= tubularSegs; s++) {
    const z = (s / tubularSegs) * len;
    const th = dir * 2 * Math.PI * z / h;
    const c = Math.cos(th), si = Math.sin(th);
    p.set(r * c, r * si, z);
    // 切向
    T.set(-r * si * dir * 2 * Math.PI / h, r * c * dir * 2 * Math.PI / h, 1).normalize();
    N.set(c, si, 0);                       // 径向(朝外)
    B.crossVectors(T, N).normalize();      // 副法向
    for (let j = 0; j < P; j++) {
      const [u, v] = prof[j];
      pos[k++] = p.x + N.x * u + B.x * v;
      pos[k++] = p.y + N.y * u + B.y * v;
      pos[k++] = p.z + N.z * u + B.z * v;
    }
  }
  for (let s = 0; s < tubularSegs; s++) {
    for (let j = 0; j < P; j++) {
      const j2 = (j + 1) % P;
      const a0 = s * P + j, b0 = s * P + j2, c0 = (s + 1) * P + j, d0 = (s + 1) * P + j2;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const LAYER_COLORS = [0xc47b3a, 0x8a9ba8, 0xd8a24a, 0x6f8f6a, 0xb0653f, 0x7a86b0, 0xc98f5a, 0x5f7f8f];

export function createView3D(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f6f8);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6);
  dl.position.set(3, 5, 2);
  scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.5);
  dl2.position.set(-4, -3, 6);
  scene.add(dl2);

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e9);
  let group = null;
  let cableLen = 1, cableR = 1;

  function disposeGroup() {
    if (!group) return;
    group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    scene.remove(group);
    group = null;
  }

  /**
   * 按计算结果重建绞线
   * result: computeStranding 返回值; lenScale: 显示长度(最外层节距倍数); quality: high/mid/low
   */
  function build(result, lenScale = 1.5, quality = 'mid') {
    disposeGroup();
    group = new THREE.Group();
    const { layers, input } = result;
    const d = input.wireDia, kappa = input.kappa;
    const outer = layers.filter(l => l.n > 0).pop();
    if (!outer) { scene.add(group); return; }
    const len = Math.max(outer.lay * lenScale, d * 20);
    cableLen = len; cableR = result.dOut / 2;

    const segPerTurn = quality === 'high' ? 28 : quality === 'low' ? 10 : 16;
    const radialSegs = quality === 'high' ? 8 : quality === 'low' ? 4 : 6;

    // 中心丝
    const centerGeo = new THREE.CylinderGeometry(d * kappa / 2, d * kappa / 2, len, radialSegs * 2, 1, true);
    centerGeo.rotateX(Math.PI / 2); centerGeo.translate(0, 0, len / 2);
    const centerMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, metalness: 0.85, roughness: 0.35, clippingPlanes: [clipPlane] });
    group.add(new THREE.Mesh(centerGeo, centerMat));

    const m4 = new THREE.Matrix4();
    layers.forEach((L, li) => {
      if (L.n === 0) return;
      const turns = len / L.lay;
      const tubSegs = Math.max(12, Math.ceil(turns * segPerTurn));
      let geo;
      if (input.mode === 'compact' && L.index > 0) {
        const beta = Math.PI / L.n * 0.98; // 留 2% 间隙便于分辨单丝
        geo = sectorHelixGeometry(L.radius, L.lay, L.dir, len, d * kappa / 2, beta, tubSegs, 6);
      } else {
        const curve = new HelixCurve(L.radius, L.lay, L.dir, len);
        geo = new THREE.TubeGeometry(curve, tubSegs, d / 2, radialSegs, false);
      }
      const mat = new THREE.MeshStandardMaterial({
        color: LAYER_COLORS[li % LAYER_COLORS.length],
        metalness: input.material === 'aluminum' || input.material === 'alloy' ? 0.9 : 0.75,
        roughness: 0.38, clippingPlanes: [clipPlane],
      });
      if (input.material !== 'copper') mat.color.lerp(new THREE.Color(0xcfd6dc), 0.55);
      const inst = new THREE.InstancedMesh(geo, mat, L.n);
      for (let j = 0; j < L.n; j++) {
        m4.makeRotationZ((2 * Math.PI * j) / L.n);
        inst.setMatrixAt(j, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    });

    scene.add(group);
    // 相机取景
    const R = cableR;
    controls.target.set(0, 0, len / 2);
    camera.position.set(R * 6, R * 5, len / 2 + R * 7);
    camera.near = Math.max(0.1, R / 20); camera.far = len * 4 + R * 40;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function setClip(enabled, z) {
    clipPlane.constant = enabled ? z : 1e9;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // 渲染循环 + 帧率统计
  let frames = 0, tPrev = performance.now(), fps = 0;
  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    frames++;
    const now = performance.now();
    if (now - tPrev >= 500) { fps = Math.round(frames * 1000 / (now - tPrev)); frames = 0; tPrev = now; }
  })();

  return { build, setClip, resize, getFps: () => fps, get length() { return cableLen; } };
}
