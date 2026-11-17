import * as THREE from 'three';
import { DENSITY_LEVELS, type DensityVariant, type SpeciesTemplate, TemplateLibrary } from './template';
import type { SpeciesParams } from './species';
import {
  cloneSkeleton, cullSubtree, regrowFromCuts, type Skeleton,
} from './lsystem';
import type { LeafInstanceData } from './geometry';
import {
  buildBranchGeometry, buildLeafData, buildLeafGeometry,
} from './geometry';
import {
  createBranchMaterial, createCardMaterial, createLeafMaterial,
  type ForestUniforms,
} from './materials';

export const MAX_TREES = 12000;
export type LodLevel = 0 | 1 | 2;
export const LOD_NEAR = 30;
export const LOD_FAR = 75;
/** LOD1 保留的叶片比例 */
const LOD1_LEAF_RATIO = 0.25;
const INIT_POOL_TREES = 32;
/** 每次 LOD 更新最多迁移的树木数，避免帧卡顿 */
const LOD_MIGRATE_BUDGET = 150;

export interface TreeRecord {
  id: number;
  speciesId: string;
  variant: DensityVariant;
  x: number;
  z: number;
  rotation: number;
  seed: number;
  ageYears: number;
  custom: boolean;
  customMeshes?: THREE.Object3D[];
  customSkeleton?: Skeleton;
  lod: LodLevel;
  /** 枝干池槽位；custom 树为 -1 */
  slot: number;
  /** 叶片池起始实例下标；custom / LOD2 树为 -1 */
  leafStart: number;
  leafCount: number;
}

export interface MaterialSet {
  branch: THREE.ShaderMaterial;
  leaf: THREE.ShaderMaterial;
  card: THREE.ShaderMaterial;
}

export function createMaterialSet(uniforms: ForestUniforms): MaterialSet {
  return {
    branch: createBranchMaterial(uniforms),
    leaf: createLeafMaterial(uniforms),
    card: createCardMaterial(uniforms),
  };
}

/** 生长曲线：growthRate 越高成熟越快，10 年接近成株 */
export function maturityOf(species: SpeciesParams, ageYears: number): number {
  return 1 - Math.exp(-species.growthRate * 0.12 * ageYears);
}

const _dummy = new THREE.Object3D();
const _rot = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** 枝干 / 十字牌实例池（每树种 × 密度变体 × LOD 一个），CPU 改数据、每帧统一 flush */
class BranchPool {
  mesh: THREE.InstancedMesh;
  capacity = MAX_TREES;
  used = 0;
  slotToTree: number[] = [];
  private dirty = false;

  constructor(group: THREE.Group, tpl: SpeciesTemplate, lod: LodLevel, mats: MaterialSet) {
    const geo = lod === 2
      ? tpl.cardGeo
      : (lod === 0 ? tpl.branchGeoLod0 : tpl.branchGeoLod1);
    const mat = lod === 2 ? mats.card : mats.branch;
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(this.mesh);
  }

  write(slot: number, tree: TreeRecord, tpl: SpeciesTemplate): void {
    const scale = 0.25 + 0.75 * maturityOf(tpl.species, tree.ageYears);
    _dummy.position.set(tree.x, 0, tree.z);
    _dummy.rotation.set(0, tree.rotation, 0);
    _dummy.scale.setScalar(scale);
    _dummy.updateMatrix();
    this.mesh.setMatrixAt(slot, _dummy.matrix);
    this.slotToTree[slot] = tree.id;
    this.dirty = true;
  }

  add(tree: TreeRecord, tpl: SpeciesTemplate): number {
    const slot = this.used++;
    this.write(slot, tree, tpl);
    this.mesh.count = this.used;
    return slot;
  }

  /** 交换删除，返回被移动的树 id */
  remove(slot: number): number | undefined {
    const last = this.used - 1;
    let movedId: number | undefined;
    if (slot !== last) {
      this.mesh.getMatrixAt(last, _dummy.matrix);
      this.mesh.setMatrixAt(slot, _dummy.matrix);
      movedId = this.slotToTree[last];
      this.slotToTree[slot] = movedId;
      this.dirty = true;
    }
    this.used--;
    this.slotToTree.length = this.used;
    this.mesh.count = this.used;
    return movedId;
  }

  updateTree(slot: number, tree: TreeRecord, tpl: SpeciesTemplate): void {
    this.write(slot, tree, tpl);
  }

  flush(): void {
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }

  dispose(group: THREE.Group): void {
    group.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

/**
 * 叶片池：每片叶一个实例，世界坐标在写入时烘焙进属性，
 * 网格本身保持单位变换。数组按树木数量动态倍增，脏标记每帧统一上传。
 */
class LeafPool {
  mesh: THREE.Mesh;
  readonly leafPerTree: number;
  private capTrees: number;
  usedLeaves = 0;
  private positions: Float32Array;
  private directions: Float32Array;
  private seeds: Float32Array;
  private ageArr: Float32Array;
  private densityArr: Float32Array;
  private scaleArr: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  /** 起点 -> 树 id，交换删除后维护 */
  ownerAt = new Map<number, number>();
  private tpl: SpeciesTemplate;
  private lod: LodLevel;
  private group: THREE.Group;
  private mats: MaterialSet;
  private dirty = false;
  private attrNames = ['aLeafPos', 'aLeafDir', 'aLeafSeed', 'aTreeAge', 'aTreeDensity', 'aScale'];

  constructor(group: THREE.Group, tpl: SpeciesTemplate, lod: LodLevel, mats: MaterialSet) {
    this.group = group;
    this.mats = mats;
    this.tpl = tpl;
    this.lod = lod;
    this.leafPerTree = lod === 1
      ? Math.max(64, Math.floor(tpl.leaf.count * LOD1_LEAF_RATIO))
      : tpl.leaf.count;
    this.capTrees = INIT_POOL_TREES;
    const geo = new THREE.InstancedBufferGeometry();
    const unit = buildLeafGeometry();
    geo.index = unit.getIndex();
    geo.setAttribute('position', unit.getAttribute('position'));
    geo.setAttribute('normal', unit.getAttribute('normal'));
    geo.setAttribute('uv', unit.getAttribute('uv'));
    this.geo = geo;

    const n = this.capTrees * this.leafPerTree;
    this.positions = new Float32Array(n * 3);
    this.directions = new Float32Array(n * 3);
    this.seeds = new Float32Array(n);
    this.ageArr = new Float32Array(n);
    this.densityArr = new Float32Array(n);
    this.scaleArr = new Float32Array(n);
    this.attachAttrs();
    geo.instanceCount = 0;

    this.mesh = new THREE.Mesh(geo, mats.leaf);
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
  }

  private attachAttrs(): void {
    const mk = (arr: Float32Array, size: number) => {
      const attr = new THREE.InstancedBufferAttribute(arr, size);
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    };
    this.geo.setAttribute('aLeafPos', mk(this.positions, 3));
    this.geo.setAttribute('aLeafDir', mk(this.directions, 3));
    this.geo.setAttribute('aLeafSeed', mk(this.seeds, 1));
    this.geo.setAttribute('aTreeAge', mk(this.ageArr, 1));
    this.geo.setAttribute('aTreeDensity', mk(this.densityArr, 1));
    this.geo.setAttribute('aScale', mk(this.scaleArr, 1));
    this.dirty = true;
  }

  private ensure(treeCount: number): void {
    if (treeCount <= this.capTrees) return;
    const old = {
      positions: this.positions, directions: this.directions, seeds: this.seeds,
      ageArr: this.ageArr, densityArr: this.densityArr, scaleArr: this.scaleArr,
    };
    this.capTrees *= 2;
    const n = this.capTrees * this.leafPerTree;
    this.positions = new Float32Array(n * 3);
    this.directions = new Float32Array(n * 3);
    this.seeds = new Float32Array(n);
    this.ageArr = new Float32Array(n);
    this.densityArr = new Float32Array(n);
    this.scaleArr = new Float32Array(n);
    this.positions.set(old.positions);
    this.directions.set(old.directions);
    this.seeds.set(old.seeds);
    this.ageArr.set(old.ageArr);
    this.densityArr.set(old.densityArr);
    this.scaleArr.set(old.scaleArr);
    this.attachAttrs();
    this.geo.instanceCount = this.usedLeaves;
  }

  /** LOD1 按步长抽样取叶片子集 */
  private sampleIndex(i: number): number {
    if (this.lod === 1) {
      const stride = 1 / LOD1_LEAF_RATIO;
      return Math.min(this.tpl.leaf.count - 1, Math.floor(i * stride));
    }
    return i;
  }

  private bakeLeaf(
    idx: number, src: LeafInstanceData, si: number,
    tree: TreeRecord, maturity: number, leafScale: number, density: number,
  ): void {
    _v.set(src.positions[si * 3], src.positions[si * 3 + 1], src.positions[si * 3 + 2])
      .multiplyScalar(0.25 + 0.75 * maturity).applyMatrix4(_rot);
    this.positions[idx * 3] = _v.x + tree.x;
    this.positions[idx * 3 + 1] = _v.y;
    this.positions[idx * 3 + 2] = _v.z + tree.z;
    _v.set(src.directions[si * 3], src.directions[si * 3 + 1], src.directions[si * 3 + 2])
      .applyMatrix4(_rot).normalize();
    this.directions[idx * 3] = _v.x;
    this.directions[idx * 3 + 1] = _v.y;
    this.directions[idx * 3 + 2] = _v.z;
    this.seeds[idx] = src.seeds[si];
    this.ageArr[idx] = maturity;
    this.densityArr[idx] = density;
    this.scaleArr[idx] = leafScale;
  }

  /** 写一棵树（世界坐标烘焙），返回起始实例下标 */
  writeTree(tree: TreeRecord): number {
    this.ensure(this.usedLeaves / this.leafPerTree + 1);
    const start = this.usedLeaves;
    const count = this.leafPerTree;
    const src = this.tpl.leaf;
    const maturity = maturityOf(this.tpl.species, tree.ageYears);
    const leafScale = (0.25 + 0.75 * maturity) * this.tpl.species.leafSize * 2;
    const density = DENSITY_LEVELS[tree.variant];
    _rot.makeRotationY(tree.rotation);
    for (let i = 0; i < count; i++) {
      this.bakeLeaf(start + i, src, this.sampleIndex(i), tree, maturity, leafScale, density);
    }
    this.usedLeaves += count;
    this.geo.instanceCount = this.usedLeaves;
    this.dirty = true;
    return start;
  }

  /** 用自定义骨架数据写一棵树（修剪树） */
  writeCustom(tree: TreeRecord, data: LeafInstanceData, species: SpeciesParams): { start: number; count: number } {
    const count = data.count;
    this.ensure(this.usedLeaves / this.leafPerTree + Math.ceil(count / this.leafPerTree));
    const start = this.usedLeaves;
    const maturity = maturityOf(species, tree.ageYears);
    const leafScale = (0.25 + 0.75 * maturity) * species.leafSize * 2;
    const density = DENSITY_LEVELS[tree.variant];
    _rot.makeRotationY(tree.rotation);
    for (let i = 0; i < count; i++) {
      this.bakeLeaf(start + i, data, i, tree, maturity, leafScale, density);
    }
    this.usedLeaves += count;
    this.geo.instanceCount = this.usedLeaves;
    this.dirty = true;
    return { start, count };
  }

  updateTree(tree: TreeRecord): void {
    if (tree.leafStart < 0) return;
    const start = tree.leafStart;
    const count = tree.leafCount;
    const maturity = maturityOf(this.tpl.species, tree.ageYears);
    const leafScale = (0.25 + 0.75 * maturity) * this.tpl.species.leafSize * 2;
    _rot.makeRotationY(tree.rotation);
    const src = this.tpl.leaf;
    for (let i = 0; i < count; i++) {
      const idx = start + i;
      _v.set(src.positions[this.sampleIndex(i) * 3], src.positions[this.sampleIndex(i) * 3 + 1], src.positions[this.sampleIndex(i) * 3 + 2])
        .multiplyScalar(0.25 + 0.75 * maturity).applyMatrix4(_rot);
      this.positions[idx * 3] = _v.x + tree.x;
      this.positions[idx * 3 + 1] = _v.y;
      this.positions[idx * 3 + 2] = _v.z + tree.z;
      this.ageArr[idx] = maturity;
      this.scaleArr[idx] = leafScale;
    }
    this.dirty = true;
  }

  /** 交换删除一个连续区间，返回被移动树的新起点 */
  removeRange(start: number, count: number): { movedId: number; newStart: number } | undefined {
    const lastStart = this.usedLeaves - count;
    let movedId: number | undefined;
    if (start !== lastStart) {
      this.copyRange(lastStart, start, count);
      movedId = this.ownerAt.get(lastStart);
      this.ownerAt.delete(lastStart);
      if (movedId !== undefined) this.ownerAt.set(start, movedId);
    }
    this.usedLeaves -= count;
    this.geo.instanceCount = this.usedLeaves;
    this.ownerAt.delete(start);
    this.dirty = true;
    if (movedId === undefined) return undefined;
    return { movedId, newStart: start };
  }

  private copyRange(from: number, to: number, count: number): void {
    this.positions.copyWithin(to * 3, from * 3, (from + count) * 3);
    this.directions.copyWithin(to * 3, from * 3, (from + count) * 3);
    this.seeds.copyWithin(to, from, from + count);
    this.ageArr.copyWithin(to, from, from + count);
    this.densityArr.copyWithin(to, from, from + count);
    this.scaleArr.copyWithin(to, from, from + count);
  }

  flush(): void {
    if (!this.dirty) return;
    for (const name of this.attrNames) {
      (this.geo.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    this.dirty = false;
  }

  dispose(): void {
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

interface PoolEntry {
  tpl: SpeciesTemplate;
  branches: (BranchPool | undefined)[];
  leaves: (LeafPool | undefined)[]; // 仅 LOD0 / LOD1
}

export class Forest {
  readonly group = new THREE.Group();
  private trees: TreeRecord[] = [];
  private byId = new Map<number, TreeRecord>();
  private entries = new Map<string, PoolEntry>();
  private nextId = 1;
  private uniforms: ForestUniforms;
  private materials: MaterialSet;
  readonly library: TemplateLibrary;
  prunedTrees = 0;
  cutCount = 0;
  /** 最近一次相机位置，决定新种树木的初始 LOD */
  private cameraPos = new THREE.Vector3(0, 60, 140);
  resolveSpecies: (id: string) => SpeciesParams = () => {
    throw new Error('resolveSpecies 未注入');
  };

  constructor(library: TemplateLibrary, uniforms: ForestUniforms) {
    this.library = library;
    this.uniforms = uniforms;
    this.materials = createMaterialSet(uniforms);
  }

  get count(): number {
    return this.trees.length;
  }

  listTrees(): readonly TreeRecord[] {
    return this.trees;
  }

  getTree(id: number): TreeRecord | undefined {
    return this.byId.get(id);
  }

  /** 每帧由主循环调用，记录相机位置供 LOD 判定 */
  setCameraPos(p: { x: number; y: number; z: number }): void {
    this.cameraPos.set(p.x, p.y, p.z);
  }

  private lodOf(x: number, z: number): LodLevel {
    const dx = x - this.cameraPos.x;
    const dz = z - this.cameraPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < LOD_NEAR * LOD_NEAR) return 0;
    if (d2 < LOD_FAR * LOD_FAR) return 1;
    return 2;
  }

  /** 每帧渲染前统一上传所有池的脏数据 */
  flush(): void {
    for (const entry of this.entries.values()) {
      for (const p of entry.branches) p?.flush();
      for (const p of entry.leaves) p?.flush();
    }
  }

  private key(speciesId: string, variant: DensityVariant): string {
    return `${speciesId}#${variant}`;
  }

  private getEntry(species: SpeciesParams, variant: DensityVariant): PoolEntry {
    const k = this.key(species.id, variant);
    let entry = this.entries.get(k);
    if (!entry) {
      const tpl = this.library.get(species, variant);
      entry = { tpl, branches: [], leaves: [] };
      this.entries.set(k, entry);
    }
    return entry;
  }

  private getBranchPool(entry: PoolEntry, lod: LodLevel): BranchPool {
    let pool = entry.branches[lod];
    if (!pool) {
      pool = new BranchPool(this.group, entry.tpl, lod, this.materials);
      entry.branches[lod] = pool;
    }
    return pool;
  }

  private getLeafPool(entry: PoolEntry, lod: LodLevel): LeafPool {
    let pool = entry.leaves[lod];
    if (!pool) {
      pool = new LeafPool(this.group, entry.tpl, lod, this.materials);
      entry.leaves[lod] = pool;
    }
    return pool;
  }

  addTree(species: SpeciesParams, variant: DensityVariant, x: number, z: number, ageYears: number, rotation?: number): TreeRecord {
    if (this.trees.length >= MAX_TREES) throw new Error(`场景树木已达上限 ${MAX_TREES}`);
    const entry = this.getEntry(species, variant);
    const lod = this.lodOf(x, z);
    const tree: TreeRecord = {
      id: this.nextId++, speciesId: species.id, variant,
      x, z, rotation: rotation ?? Math.random() * Math.PI * 2,
      seed: (Math.random() * 1e9) | 0, ageYears,
      custom: false, lod, slot: -1, leafStart: -1, leafCount: 0,
    };
    tree.slot = this.getBranchPool(entry, lod).add(tree, entry.tpl);
    if (lod < 2) {
      const leafPool = this.getLeafPool(entry, lod);
      tree.leafStart = leafPool.writeTree(tree);
      tree.leafCount = leafPool.leafPerTree;
      leafPool.ownerAt.set(tree.leafStart, tree.id);
    }
    this.trees.push(tree);
    this.byId.set(tree.id, tree);
    return tree;
  }

  private removePooledTree(tree: TreeRecord, entry: PoolEntry): void {
    const branchPool = entry.branches[tree.lod];
    if (branchPool) {
      const movedId = branchPool.remove(tree.slot);
      if (movedId !== undefined) this.byId.get(movedId)!.slot = tree.slot;
    }
    if (tree.lod < 2 && tree.leafStart >= 0) {
      const leafPool = entry.leaves[tree.lod]!;
      const res = leafPool.removeRange(tree.leafStart, tree.leafCount);
      if (res) this.byId.get(res.movedId)!.leafStart = res.newStart;
    }
  }

  removeTree(id: number): void {
    const tree = this.byId.get(id);
    if (!tree) return;
    if (tree.custom) {
      // 回收自定义树烘焙在共享叶片池里的叶片区间
      const entry = this.entries.get(this.key(tree.speciesId, tree.variant));
      if (entry && tree.leafStart >= 0) {
        const leafPool = entry.leaves[0];
        if (leafPool) {
          const res = leafPool.removeRange(tree.leafStart, tree.leafCount);
          if (res) this.byId.get(res.movedId)!.leafStart = res.newStart;
        }
      }
      this.disposeCustom(tree);
    } else {
      const entry = this.entries.get(this.key(tree.speciesId, tree.variant));
      if (entry) this.removePooledTree(tree, entry);
    }
    this.byId.delete(id);
    const idx = this.trees.indexOf(tree);
    if (idx >= 0) this.trees.splice(idx, 1);
  }

  /** 整池快速清空：直接释放全部实例池与自定义网格，避免逐树交换删除的 O(n²) 开销 */
  clear(): void {
    for (const tree of this.trees) {
      if (tree.custom) this.disposeCustom(tree);
    }
    for (const entry of this.entries.values()) {
      for (const pool of entry.branches) pool?.dispose(this.group);
      for (const pool of entry.leaves) pool?.dispose();
    }
    this.entries.clear();
    this.trees.length = 0;
    this.byId.clear();
    this.prunedTrees = 0;
    this.cutCount = 0;
  }

  setAgeYears(ageYears: number): void {
    for (const tree of this.trees) {
      tree.ageYears = ageYears;
      if (tree.custom) {
        this.rebuildCustom(tree);
        continue;
      }
      const entry = this.entries.get(this.key(tree.speciesId, tree.variant));
      if (!entry) continue;
      entry.branches[tree.lod]?.updateTree(tree.slot, tree, entry.tpl);
      if (tree.lod < 2 && tree.leafStart >= 0) entry.leaves[tree.lod]!.updateTree(tree);
    }
  }

  rebuildAll(): void {
    for (const entry of this.entries.values()) {
      for (const pool of entry.branches) pool?.dispose(this.group);
      for (const pool of entry.leaves) pool?.dispose();
    }
    this.entries.clear();
    for (const tree of this.trees) {
      if (tree.custom) {
        this.rebuildCustom(tree);
        continue;
      }
      const species = this.resolveSpecies(tree.speciesId);
      const entry = this.getEntry(species, tree.variant);
      const pool = this.getBranchPool(entry, tree.lod);
      tree.slot = pool.add(tree, entry.tpl);
      if (tree.lod < 2) {
        const leafPool = this.getLeafPool(entry, tree.lod);
        tree.leafStart = leafPool.writeTree(tree);
        tree.leafCount = leafPool.leafPerTree;
        leafPool.ownerAt.set(tree.leafStart, tree.id);
      } else {
        tree.leafStart = -1;
        tree.leafCount = 0;
      }
    }
  }

  // ---------------- LOD 迁移（带每帧预算） ----------------

  updateLod(camPos: { x: number; y: number; z: number }): void {
    this.cameraPos.set(camPos.x, camPos.y, camPos.z);
    let budget = LOD_MIGRATE_BUDGET;
    for (const tree of this.trees) {
      if (tree.custom) continue;
      const target = this.lodOf(tree.x, tree.z);
      if (target === tree.lod) continue;
      if (budget-- <= 0) break;
      this.migrate(tree, target);
    }
  }

  private migrate(tree: TreeRecord, newLod: LodLevel): void {
    const entry = this.entries.get(this.key(tree.speciesId, tree.variant))!;
    const oldBranch = entry.branches[tree.lod];
    if (oldBranch) {
      const movedId = oldBranch.remove(tree.slot);
      if (movedId !== undefined) this.byId.get(movedId)!.slot = tree.slot;
    }
    if (tree.lod < 2 && tree.leafStart >= 0) {
      const oldLeaf = entry.leaves[tree.lod]!;
      const res = oldLeaf.removeRange(tree.leafStart, tree.leafCount);
      if (res) this.byId.get(res.movedId)!.leafStart = res.newStart;
    }
    tree.lod = newLod;
    tree.slot = this.getBranchPool(entry, newLod).add(tree, entry.tpl);
    if (newLod < 2) {
      const newLeaf = this.getLeafPool(entry, newLod);
      tree.leafStart = newLeaf.writeTree(tree);
      tree.leafCount = newLeaf.leafPerTree;
      newLeaf.ownerAt.set(tree.leafStart, tree.id);
    } else {
      tree.leafStart = -1;
      tree.leafCount = 0;
    }
  }

  // ---------------- 修剪 ----------------

  pruneTree(treeId: number, nodeId: number): boolean {
    const tree = this.byId.get(treeId);
    if (!tree || tree.custom) return false;
    const species = this.resolveSpecies(tree.speciesId);
    const tpl = this.library.get(species, tree.variant);
    const skel = cloneSkeleton(tpl.skeleton);
    if (nodeId <= 0 || nodeId >= skel.nodes.length || skel.nodes[nodeId].culled) return false;

    const entry = this.entries.get(this.key(tree.speciesId, tree.variant))!;
    this.removePooledTree(tree, entry);

    cullSubtree(skel, nodeId);
    tree.custom = true;
    tree.slot = -1;
    tree.leafStart = -1;
    tree.leafCount = 0;
    tree.customSkeleton = skel;
    this.buildCustomMeshes(tree, species);
    this.prunedTrees++;
    this.cutCount++;
    return true;
  }

  applySeasonalRegrow(seasonOrdinal: number): void {
    for (const tree of this.trees) {
      if (!tree.custom || !tree.customSkeleton) continue;
      const species = this.resolveSpecies(tree.speciesId);
      const grown = regrowFromCuts(tree.customSkeleton, species, tree.seed + seasonOrdinal * 131 + 7);
      if (grown > 0) this.rebuildCustom(tree);
    }
  }

  private buildCustomMeshes(tree: TreeRecord, species: SpeciesParams): void {
    this.disposeCustom(tree);
    const skel = tree.customSkeleton!;
    const treeScale = 0.25 + 0.75 * maturityOf(species, tree.ageYears);

    const branchGeo = buildBranchGeometry(skel, 5, species.barkColor);
    const branch = new THREE.Mesh(branchGeo, this.materials.branch);
    branch.position.set(tree.x, 0, tree.z);
    branch.rotation.y = tree.rotation;
    branch.scale.setScalar(treeScale);
    branch.userData.treeId = tree.id;
    branch.userData.isCustomBranch = true;
    branch.frustumCulled = false;

    // 叶片烘焙进 LOD0 叶片池，与实例池树木共用同一个 draw call
    const leafData = buildLeafData(skel);
    const entry = this.entries.get(this.key(tree.speciesId, tree.variant))
      ?? this.getEntry(species, tree.variant);
    const leafPool = this.getLeafPool(entry, 0);
    const { start, count } = leafPool.writeCustom(tree, leafData, species);
    tree.leafStart = start;
    tree.leafCount = count;
    leafPool.ownerAt.set(start, tree.id);

    tree.customMeshes = [branch];
    this.group.add(branch);
  }

  private rebuildCustom(tree: TreeRecord): void {
    const entry = this.entries.get(this.key(tree.speciesId, tree.variant));
    if (entry && tree.leafStart >= 0) {
      const leafPool = entry.leaves[0];
      if (leafPool) {
        const res = leafPool.removeRange(tree.leafStart, tree.leafCount);
        if (res) this.byId.get(res.movedId)!.leafStart = res.newStart;
      }
    }
    this.buildCustomMeshes(tree, this.resolveSpecies(tree.speciesId));
  }

  private disposeCustom(tree: TreeRecord): void {
    if (!tree.customMeshes) return;
    for (const obj of tree.customMeshes) {
      this.group.remove(obj);
      (obj as THREE.Mesh).geometry.dispose();
    }
    tree.customMeshes = undefined;
  }
}
