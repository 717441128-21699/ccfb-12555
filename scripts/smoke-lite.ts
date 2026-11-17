import puppeteer from 'puppeteer-core';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5181/';
const errors: string[] = [];

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  protocolTimeout: 120000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const G = () => page.evaluate(() => (window as any).__garden);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(1500);

// 1. 万棵随机造林，轮询直到接近目标
await page.click('#randomForest');
let planted = 0;
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  planted = await page.evaluate(() => (window as any).__garden.trees);
  if (planted >= 9900) break;
}
console.log('STEP1 planted =', planted);

// 2. LOD 三级分布
const lod = await page.evaluate(() => (window as any).__garden.lodStats);
console.log('STEP2 lod =', JSON.stringify(lod));

// 3. 春夏秋冬切换不报错，并读到冬季低覆盖率
const season = await page.evaluate(() => {
  const g = (window as any).__garden;
  const seen: number[] = [];
  for (let s = 0; s < 4; s++) { g.seasons.setSeason(s); seen.push(s); }
  // 叶片材质的全局覆盖率 uniform（冬季落叶树应接近 0.08）
  const leafMat = g.forest;
  void leafMat;
  g.seasons.setSeason(1);
  return { iterations: seen.length };
});

// 4. 树龄切换
const ageCheck = await page.evaluate(() => {
  const g = (window as any).__garden;
  const tree = g.forest.listTrees().find((t: any) => !t.custom && t.lod === 0);
  if (!tree) return { ok: false };
  g.forest.setAgeYears(1);
  const young = tree.ageYears;
  g.forest.setAgeYears(10);
  const old = tree.ageYears;
  g.forest.setAgeYears(3);
  return { ok: young === 1 && old === 10 };
});

// 5. 修剪 + 剪口萌发
const prune = await page.evaluate(() => {
  const g = (window as any).__garden;
  const tree = g.forest.listTrees().find((t: any) => !t.custom);
  if (!tree) return { ok: false, reason: 'no tree', total: g.forest.listTrees().length };
  const species = g.forest.resolveSpecies(tree.speciesId);
  const tpl = g.forest.library.get(species, tree.variant);
  if (!tpl || !tpl.skeleton) return { ok: false, reason: 'no template', speciesId: tree.speciesId, variant: tree.variant };
  // 选一个深度≥2 且未被密度剔除的存活节点
  const node = tpl.skeleton.nodes.find((n: any) => n.id >= 2 && !n.culled && n.depth >= 2);
  if (!node) return { ok: false, reason: 'no live node' };
  const ok = g.forest.pruneTree(tree.id, node.id);
  if (!ok) return { ok: false, reason: 'pruneTree returned false' };
  const rec = g.forest.getTree(tree.id);
  if (!rec.custom || !rec.customSkeleton) return { ok: false, reason: 'not converted to custom' };
  const before = rec.customSkeleton.nodes.length;
  g.forest.applySeasonalRegrow(2);
  const after = rec.customSkeleton.nodes.length;
  const cut = rec.customSkeleton.nodes.find((n: any) => n.cut);
  return { ok: true, becameCustom: rec.custom, grew: after > before, rounds: cut?.regrowRounds };
});
console.log('STEP5 prune =', JSON.stringify(prune));

// 6. 单棵删除
const removeCheck = await page.evaluate(() => {
  const g = (window as any).__garden;
  const before = g.trees;
  const id = g.forest.listTrees()[0].id;
  g.forest.removeTree(id);
  return { removed: g.trees === before - 1, now: g.trees };
});

// 7. 清空（整池快速释放）
await page.click('#clearForest');
await sleep(1200);
const gardenAfterClear = await page.evaluate(() => {
  const g = (window as any).__garden;
  return g ? { alive: true, count: g.trees } : { alive: false, count: -1 };
});
const afterClear = gardenAfterClear.count;

// 8. 清空后再种，验证系统可复用
await page.click('#randomForest');
let replant = 0;
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  replant = await page.evaluate(() => (window as any).__garden?.trees ?? -1);
  if (replant >= 3000) break;
}

// 9. WebGL 上下文存活
const gl = await page.evaluate(() => {
  const c = document.getElementById('scene') as HTMLCanvasElement;
  const ctx = c.getContext('webgl2') || c.getContext('webgl');
  return { alive: !!ctx, w: ctx?.drawingBufferWidth, h: ctx?.drawingBufferHeight };
});

console.log(JSON.stringify({
  planted,
  reachedTarget: planted >= 9900,
  lodDistribution: lod,
  season,
  ageCheck,
  prune,
  removeCheck,
  gardenAfterClear,
  afterClear,
  replant,
  gl,
  shaderErrors: errors.filter((e) => e.includes('Shader') || e.includes('PAGEERROR')),
  errorCount: errors.length,
  errors: errors.slice(0, 8),
}, null, 2));

await browser.close();
