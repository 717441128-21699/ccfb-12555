import * as THREE from 'three';
import './style.css';
import { SPECIES, EDITABLE_FIELDS, cloneSpecies, type SpeciesParams } from './core/species';
import { createForestUniforms } from './core/materials';
import { TemplateLibrary } from './core/template';
import { Forest, MAX_TREES } from './core/forest';
import { Site, SUN_DIR } from './scene/site';
import { OrbitRig, WalkRig } from './scene/controls';
import { SeasonSystem, type Season } from './scene/seasons';
import { TreePreview } from './scene/preview';
import { Planter } from './scene/planter';
import { PrunePicker } from './scene/prune';
import { FpsCounter } from './ui/fps';

// ---------------- 渲染器 / 场景 ----------------
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(80, 60, 80);

// 灯光：平行光投影建筑阴影，半球光补环境
const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
sun.position.copy(SUN_DIR).multiplyScalar(120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 260;
sun.shadow.bias = -0.0006;
scene.add(sun, new THREE.HemisphereLight(0xddeeff, 0x667760, 0.7));

// ---------------- 核心系统 ----------------
const uniforms = createForestUniforms();
const library = new TemplateLibrary();
const forest = new Forest(library, uniforms);
scene.add(forest.group);

const site = new Site();
scene.add(site.group);

// 可编辑的树种参数副本
const workingSpecies: SpeciesParams[] = SPECIES.map(cloneSpecies);
let selectedId = workingSpecies[0].id;
const getSpecies = (id: string) => workingSpecies.find((s) => s.id === id)!;
forest.resolveSpecies = getSpecies;

const seasons = new SeasonSystem(uniforms, scene, sun, getSpecies(selectedId));
const orbit = new OrbitRig(camera, canvas);
const walk = new WalkRig(camera, canvas);

const preview = new TreePreview(document.getElementById('preview') as HTMLCanvasElement);
preview.resize(268, 220);
preview.setSpecies(getSpecies(selectedId));

let ageYears = 3;
const planter = new Planter(
  forest, site, camera, canvas,
  () => workingSpecies,
  () => getSpecies(selectedId),
  () => ageYears,
);
const picker = new PrunePicker(forest, library, getSpecies);

// ---------------- UI 状态 ----------------
type Mode = 'edit' | 'prune' | 'walk';
let mode: Mode = 'edit';
const modeTip = document.getElementById('modeTip') as HTMLDivElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;

// ---------------- 树种面板 ----------------
const speciesSelect = document.getElementById('speciesSelect') as HTMLSelectElement;
const paramList = document.getElementById('paramList') as HTMLDivElement;
for (const s of workingSpecies) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.name;
  speciesSelect.appendChild(opt);
}

function buildParamForm(): void {
  const p = getSpecies(selectedId);
  paramList.innerHTML = '';
  for (const f of EDITABLE_FIELDS) {
    const val = p[f.key] as number;
    const row = document.createElement('div');
    row.className = 'field';
    row.innerHTML = `
      <label>${f.label} <b>${val}${f.unit ?? ''}</b></label>
      <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${val}" data-key="${f.key}" />
    `;
    const input = row.querySelector('input')!;
    const b = row.querySelector('b')!;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      (p[f.key] as number) = v;
      b.textContent = `${v}${f.unit ?? ''}`;
      schedulePreviewRebuild();
    });
    paramList.appendChild(row);
  }
}

let previewTimer: number | undefined;
function schedulePreviewRebuild(): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => preview.setSpecies(getSpecies(selectedId)), 250);
}

speciesSelect.addEventListener('change', () => {
  selectedId = speciesSelect.value;
  buildParamForm();
  preview.setSpecies(getSpecies(selectedId));
  seasons.setSpecies(getSpecies(selectedId));
});

document.getElementById('applyParams')!.addEventListener('click', () => {
  library.invalidate();
  forest.rebuildAll();
  preview.setSpecies(getSpecies(selectedId));
});
document.getElementById('resetParams')!.addEventListener('click', () => {
  const preset = SPECIES.find((s) => s.id === selectedId)!;
  const idx = workingSpecies.findIndex((s) => s.id === selectedId);
  workingSpecies[idx] = cloneSpecies(preset);
  buildParamForm();
  library.invalidate();
  forest.rebuildAll();
  preview.setSpecies(getSpecies(selectedId));
});
buildParamForm();

// ---------------- 季节 / 树龄 ----------------
const seasonSeg = document.getElementById('seasonSeg')!;
seasonSeg.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    seasonSeg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const s = parseInt(btn.dataset.season!, 10) as Season;
    seasons.setSeason(s);
    preview.setSeason(s, getSpecies(selectedId));
  });
});
document.getElementById('autoSeason')!.addEventListener('change', (e) => {
  seasons.setAuto((e.target as HTMLInputElement).checked);
});

document.getElementById('ageSeg')!.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById('ageSeg')!.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ageYears = parseInt(btn.dataset.age!, 10);
    forest.setAgeYears(ageYears);
  });
});

// ---------------- 种植 ----------------
const brushRadius = document.getElementById('brushRadius') as HTMLInputElement;
const brushDensity = document.getElementById('brushDensity') as HTMLInputElement;
brushRadius.addEventListener('input', () => {
  planter.radius = parseFloat(brushRadius.value);
  document.getElementById('brushRadiusVal')!.textContent = `${brushRadius.value} m`;
});
brushDensity.addEventListener('input', () => {
  planter.density = parseFloat(brushDensity.value);
  document.getElementById('brushDensityVal')!.textContent = brushDensity.value;
});
const btnPlant = document.getElementById('brushPlant')!;
const btnErase = document.getElementById('brushErase')!;
btnPlant.addEventListener('click', () => {
  btnPlant.classList.add('active');
  btnErase.classList.remove('active');
  planter.setMode('plant');
});
btnErase.addEventListener('click', () => {
  btnErase.classList.add('active');
  btnPlant.classList.remove('active');
  planter.setMode('erase');
});

const forestStat = document.getElementById('forestStat')!;
planter.onCountChange = () => {
  forestStat.textContent = `场地树木：${forest.count}（上限 ${MAX_TREES}）`;
};
planter.onCountChange();

let planting = false;
document.getElementById('randomForest')!.addEventListener('click', async () => {
  if (planting) return;
  planting = true;
  const target = Math.max(0, 10000 - forest.count);
  const btn = document.getElementById('randomForest') as HTMLButtonElement;
  btn.disabled = true;
  const n = await planter.randomForest(target, (placed, total) => {
    forestStat.textContent = `正在生成混交林… ${placed}/${total}（全场 ${forest.count}）`;
  });
  forestStat.textContent = `场地树木：${forest.count}（本次新增 ${n}，上限 ${MAX_TREES}）`;
  btn.disabled = false;
  planting = false;
});
document.getElementById('clearForest')!.addEventListener('click', () => planter.clearAll());

// ---------------- 修剪 ----------------
const pruneBtn = document.getElementById('pruneToggle')!;
const pruneStat = document.getElementById('pruneStat')!;
pruneBtn.addEventListener('click', () => {
  if (mode === 'prune') exitPrune();
  else enterPrune();
});

function activeTab(): string {
  return (document.querySelector('.tab.active') as HTMLElement).dataset.tab!;
}

function syncPlanterVisibility(): void {
  const planting = mode === 'edit' && activeTab() === 'plant';
  planter.setEnabled(planting);
  orbit.leftRotateEnabled = !planting;
}

function enterPrune(): void {
  mode = 'prune';
  orbit.enabled = false;
  planter.setEnabled(false);
  pruneBtn.classList.add('active');
  pruneBtn.textContent = '退出修剪模式';
  modeTip.style.display = 'block';
  modeTip.textContent = '修剪模式：点击枝条剪除整段分枝，下一切换季节时剪口萌发侧枝';
  canvas.style.cursor = 'crosshair';
}

function exitPrune(): void {
  mode = 'edit';
  orbit.enabled = true;
  pruneBtn.classList.remove('active');
  pruneBtn.textContent = '进入修剪模式';
  modeTip.style.display = 'none';
  canvas.style.cursor = '';
  syncPlanterVisibility();
}

canvas.addEventListener('click', (e) => {
  if (mode !== 'prune') return;
  const hit = picker.pick(e.clientX, e.clientY, camera, canvas);
  if (!hit) return;
  const ok = forest.pruneTree(hit.treeId, hit.nodeId);
  if (ok) {
    pruneStat.textContent = `已修剪：${forest.prunedTrees} 棵 / 剪口：${forest.cutCount} 个`;
  }
});

// 季节切换时触发剪口萌发（手动按钮与自动轮播都走这里）
const origSetSeason = seasons.setSeason.bind(seasons);
seasons.setSeason = (s: Season) => {
  origSetSeason(s);
  forest.applySeasonalRegrow(s);
};

// ---------------- 漫游 ----------------
const walkBtn = document.getElementById('walkToggle')!;
const walkSpeed = document.getElementById('walkSpeed') as HTMLInputElement;
walkSpeed.addEventListener('input', () => {
  walk.speed = parseFloat(walkSpeed.value);
  document.getElementById('walkSpeedVal')!.textContent = `${walkSpeed.value} m/s`;
});

walkBtn.addEventListener('click', () => {
  if (mode === 'walk') exitWalk();
  else enterWalk();
});

function enterWalk(): void {
  mode = 'walk';
  orbit.enabled = false;
  planter.setEnabled(false);
  walkBtn.classList.add('active');
  walkBtn.textContent = '退出实时漫游（Esc）';
  camera.position.set(0, 1.7, 30);
  walk.enter();
  modeTip.style.display = 'block';
  modeTip.textContent = 'WASD 移动 · Shift 加速 · 鼠标转向 · Esc 退出';
}

function exitWalk(): void {
  walk.exit();
  mode = 'edit';
  orbit.enabled = true;
  walkBtn.classList.remove('active');
  walkBtn.textContent = '进入实时漫游';
  modeTip.style.display = 'none';
  orbit.update();
  syncPlanterVisibility();
}
walk.onExit = () => {
  if (mode === 'walk') exitWalk();
};

// ---------------- 面板 Tab ----------------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = (tab as HTMLElement).dataset.tab!;
    document.querySelectorAll('.tab-body').forEach((b) => {
      (b as HTMLElement).hidden = (b as HTMLElement).dataset.body !== name;
    });
    syncPlanterVisibility();
  });
});
// 默认在种植页启用笔刷
planter.setMode('plant');
syncPlanterVisibility();

// ---------------- 画质自适应（集显保 30 帧） ----------------
let pixelRatioCap = 1.5;
const fps = new FpsCounter();
fps.onDegrade = (measured) => {
  if (pixelRatioCap > 0.9) {
    pixelRatioCap = 0.9;
    renderer.setPixelRatio(pixelRatioCap);
    modeTip.textContent = `帧率 ${measured} FPS 低于目标，已自动降低渲染分辨率`;
    modeTip.style.display = 'block';
    window.setTimeout(() => { if (mode === 'edit') modeTip.style.display = 'none'; }, 3000);
  }
};

// ---------------- 主循环 ----------------
const clock = new THREE.Clock();
let lodTimer = 0;
let previewAccum = 0;

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  uniforms.uTime.value = t;

  const newSeason = seasons.update(dt);
  if (newSeason !== null) forest.applySeasonalRegrow(newSeason);

  if (mode === 'walk') {
    walk.update(dt);
  } else {
    orbit.update();
  }

  // LOD 每 0.25 秒重算一次，避免逐帧迁移实例
  lodTimer += dt;
  if (lodTimer > 0.25) {
    forest.updateLod(camera.position);
    lodTimer = 0;
  }
  forest.setCameraPos(camera.position);
  forest.flush();
  renderer.render(scene, camera);

  // 小窗预览：独立 WebGL 上下文，限 30FPS
  previewAccum += dt;
  if (previewAccum > 1 / 30) {
    previewAccum = 0;
    const pvCanvas = preview.domElement;
    const rect = pvCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (pvCanvas.width !== w || pvCanvas.height !== h) preview.resize(w, h);
    preview.render(t);
  }

  const f = fps.update(dt);
  fpsEl.textContent = `FPS: ${f || '--'} · 树木 ${forest.count}`;
  fpsEl.className = f >= 50 ? '' : f >= 30 ? 'low' : 'bad';

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 调试 / 自动化验证句柄
(window as unknown as { __garden: unknown }).__garden = {
  forest,
  site,
  seasons,
  get trees() { return forest.count; },
  get lodStats() {
    const stats = { lod0: 0, lod1: 0, lod2: 0, custom: 0 };
    for (const t of forest.listTrees()) {
      if (t.custom) stats.custom++;
      else stats[`lod${t.lod}` as 'lod0' | 'lod1' | 'lod2']++;
    }
    return stats;
  },
};
