import { SPECIES, cloneSpecies } from '../src/core/species';
import { generateSkeleton, cullSubtree, regrowFromCuts, cloneSkeleton } from '../src/core/lsystem';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

console.log('L-系统 / 骨架');
for (const sp of SPECIES) {
  const skel = generateSkeleton(sp, 42, 1);
  check(`${sp.name} 生成节点 >100`, skel.nodes.length > 100, `nodes=${skel.nodes.length}`);
  check(`${sp.name} 有叶片锚点`, skel.anchors.length > 100, `anchors=${skel.anchors.length}`);
  check(`${sp.name} 树高 >2m`, skel.height > 2, `height=${skel.height}`);
  check(`${sp.name} 根节点未剔除`, !skel.nodes[0].culled);

  // 确定性：同种子两次生成一致
  const again = generateSkeleton(sp, 42, 1);
  const same = again.nodes.length === skel.nodes.length
    && Math.abs(again.height - skel.height) < 1e-6
    && again.anchors.length === skel.anchors.length;
  check(`${sp.name} 同种子可复现`, same);
}

console.log('\n密度变体（建筑阴影稀枝）');
const g = SPECIES[0];
const full = generateSkeleton(g, 7, 1);
const sparse = generateSkeleton(g, 7, 0.45);
const fullLive = full.nodes.filter((n) => !n.culled).length;
const sparseLive = sparse.nodes.filter((n) => !n.culled).length;
check('稀枝变体存活节点更少', sparseLive < fullLive, `${sparseLive} vs ${fullLive}`);
check('稀枝变体叶片更少', sparse.anchors.length < full.anchors.length);
check('根节点在稀枝变体中保留', !sparse.nodes[0].culled);

console.log('\n修剪与剪口');
const skel = generateSkeleton(cloneSpecies(g), 99, 1);
const before = skel.nodes.length;
const target = Math.min(15, skel.nodes.length - 1);
const targetChildren = skel.children[target].length;
cullSubtree(skel, target);
check('剪口节点被标记 cut', skel.nodes[target].cut);
check('剪口节点被标记 culled', skel.nodes[target].culled);
check('子节点全部连带剔除', skel.children[target].every((c) => skel.nodes[c].culled));
check('总节点数不变（标记而非删除）', skel.nodes.length === before);

console.log('\n季节萌发');
const r1 = regrowFromCuts(skel, cloneSpecies(g), 123);
const afterFirst = skel.nodes.length;
check('萌发返回剪口数 >0', r1 > 0, `cuts=${r1}`);
check('萌发后节点数增加', afterFirst > before, `${afterFirst} vs ${before}`);
check('萌发产生新叶片锚点', skel.anchors.length > 0);
const cutNode = skel.nodes[target];
check('剪口萌发轮次 = 1', cutNode.regrowRounds === 1, `rounds=${cutNode.regrowRounds}`);
regrowFromCuts(skel, cloneSpecies(g), 456);
regrowFromCuts(skel, cloneSpecies(g), 789);
check('最多萌发三轮', cutNode.regrowRounds === 3, `rounds=${cutNode.regrowRounds}`);
const nodesAfterThree = skel.nodes.length;
regrowFromCuts(skel, cloneSpecies(g), 111);
check('三轮后不再萌发', skel.nodes.length === nodesAfterThree);

console.log('\n克隆独立性');
const base = generateSkeleton(g, 5, 1);
const copy = cloneSkeleton(base);
cullSubtree(copy, 10);
check('克隆修剪不影响原骨架', !base.nodes[10].culled && copy.nodes[10].culled);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
