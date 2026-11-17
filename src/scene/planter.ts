import * as THREE from 'three';
import type { Forest } from '../core/forest';
import type { Site } from './site';
import type { SpeciesParams } from '../core/species';
import type { DensityVariant } from '../core/template';

export type BrushMode = 'plant' | 'erase';

/** 场地平面上的笔刷种植交互 */
export class Planter {
  private forest: Forest;
  private site: Site;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hitPoint = new THREE.Vector3();

  private ring: THREE.Mesh;
  private mode: BrushMode = 'plant';
  radius = 6;
  density = 0.6;
  private painting = false;
  private speciesList: () => SpeciesParams[];
  private selectedSpecies: () => SpeciesParams;
  private ageYears: () => number;
  onCountChange?: () => void;
  /** 空间哈希：2m 网格单元 -> 树 id 列表，把近邻查询从 O(n) 降到 O(1) */
  private spatial = new Map<number, number[]>();
  private readonly cell = 2;

  private cellKey(x: number, z: number): number {
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    return ix * 73856093 ^ iz * 19349663;
  }

  private indexTree(id: number, x: number, z: number): void {
    const k = this.cellKey(x, z);
    let bucket = this.spatial.get(k);
    if (!bucket) { bucket = []; this.spatial.set(k, bucket); }
    bucket.push(id);
  }

  private unindexTree(x: number, z: number, id: number): void {
    const bucket = this.spatial.get(this.cellKey(x, z));
    if (!bucket) return;
    const i = bucket.indexOf(id);
    if (i >= 0) bucket.splice(i, 1);
  }

  clearIndex(): void {
    this.spatial.clear();
  }

  constructor(
    forest: Forest,
    site: Site,
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    speciesList: () => SpeciesParams[],
    selectedSpecies: () => SpeciesParams,
    ageYears: () => number,
  ) {
    this.forest = forest;
    this.site = site;
    this.camera = camera;
    this.canvas = canvas;
    this.speciesList = speciesList;
    this.selectedSpecies = selectedSpecies;
    this.ageYears = ageYears;

    const ringGeo = new THREE.RingGeometry(0.97, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x8ff0a4, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 10;
    site.group.add(this.ring);

    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  setMode(m: BrushMode): void {
    this.mode = m;
    (this.ring.material as THREE.MeshBasicMaterial).color.set(m === 'plant' ? 0x8ff0a4 : 0xff8a8a);
  }

  setEnabled(v: boolean): void {
    this.ring.visible = v;
    if (!v) this.painting = false;
  }

  get isEnabled(): boolean {
    return this.ring.visible;
  }

  private projectGround(e: PointerEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint) !== null;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.ring.visible || e.button !== 0) return;
    this.painting = true;
    this.stamp();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.ring.visible) return;
    if (!this.projectGround(e)) {
      this.ring.visible = false;
      return;
    }
    this.ring.visible = true;
    this.ring.position.set(this.hitPoint.x, 0.12, this.hitPoint.z);
    this.ring.scale.setScalar(this.radius);
    if (this.painting) this.stamp();
  };

  private onUp = () => {
    this.painting = false;
  };

  private stamp(): void {
    const x = this.hitPoint.x;
    const z = this.hitPoint.z;
    if (this.mode === 'erase') {
      this.eraseAt(x, z);
      return;
    }
    const points = this.site.stampBrush(x, z, this.radius, this.density, false);
    for (const p of points) {
      if (this.hasNearbyTree(p.x, p.z, 1.6)) continue;
      const species = this.pickSpecies();
      const variant: DensityVariant = p.shadow ? 2 : (Math.random() < 0.25 ? 1 : 0);
      const tree = this.forest.addTree(species, variant, p.x, p.z, this.ageYears());
      this.indexTree(tree.id, p.x, p.z);
    }
    this.onCountChange?.();
  }

  private eraseAt(x: number, z: number): void {
    this.site.stampBrush(x, z, this.radius, 0, true);
    const r2 = this.radius * this.radius;
    const remove = this.treesInRadius(x, z, this.radius);
    for (const t of remove) {
      this.unindexTree(t.x, t.z, t.id);
      this.forest.removeTree(t.id);
    }
    void r2;
    this.onCountChange?.();
  }

  /** 查询半径内的树（走空间哈希） */
  private treesInRadius(x: number, z: number, radius: number) {
    const out: { id: number; x: number; z: number }[] = [];
    const minIx = Math.floor((x - radius) / this.cell);
    const maxIx = Math.floor((x + radius) / this.cell);
    const minIz = Math.floor((z - radius) / this.cell);
    const maxIz = Math.floor((z + radius) / this.cell);
    const r2 = radius * radius;
    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iz = minIz; iz <= maxIz; iz++) {
        const bucket = this.spatial.get(ix * 73856093 ^ iz * 19349663);
        if (!bucket) continue;
        for (const id of bucket) {
          const t = this.forest.getTree(id);
          if (!t) continue;
          const dx = t.x - x;
          const dz = t.z - z;
          if (dx * dx + dz * dz <= r2) out.push({ id, x: t.x, z: t.z });
        }
      }
    }
    return out;
  }

  private hasNearbyTree(x: number, z: number, minDist: number): boolean {
    return this.treesInRadius(x, z, minDist).length > 0;
  }

  private pickSpecies(): SpeciesParams {
    // 70% 当前选中树种，30% 从全部树种里混交
    if (Math.random() < 0.7) return this.selectedSpecies();
    const list = this.speciesList();
    return list[Math.floor(Math.random() * list.length)];
  }

  /**
   * 一键随机混交林（分帧批量）。
   * 用抖动网格 + 洗牌保证疏密自然且能稳定种满目标数量，避免拒绝采样在高密度时失效。
   */
  async randomForest(target: number, onProgress?: (placed: number, total: number) => void): Promise<number> {
    const list = this.speciesList();
    const region = 190; // 可用场地边长
    // 网格间距密于目标密度，预留建筑 / 道路剔除余量，保证扣障碍后仍能种满目标数量
    const spacing = Math.sqrt((region * region) / target) * 0.82;
    const cellsPerSide = Math.floor(region / spacing);
    const order: number[] = [];
    for (let i = 0; i < cellsPerSide * cellsPerSide; i++) order.push(i);
    // Fisher-Yates 洗牌，让落点顺序自然随机
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    let placed = 0;
    const CHUNK = 400;
    let cursor = 0;
    while (placed < target && cursor < order.length) {
      const chunkEnd = Math.min(cursor + CHUNK, order.length);
      for (; cursor < chunkEnd && placed < target; cursor++) {
        const cellIndex = order[cursor];
        const gx = cellIndex % cellsPerSide;
        const gz = Math.floor(cellIndex / cellsPerSide);
        const jitterX = (Math.random() - 0.5) * spacing * 0.6;
        const jitterZ = (Math.random() - 0.5) * spacing * 0.6;
        const x = -region / 2 + (gx + 0.5) * spacing + jitterX;
        const z = -region / 2 + (gz + 0.5) * spacing + jitterZ;
        if (this.site.isObstacle(x, z)) continue;
        const species = list[Math.floor(Math.random() * list.length)];
        const shadow = this.site.isInBuildingShadow(x, z);
        const variant: DensityVariant = shadow ? 2 : (Math.random() < 0.3 ? 1 : 0);
        const tree = this.forest.addTree(species, variant, x, z, this.ageYears());
        this.indexTree(tree.id, x, z);
        placed++;
      }
      this.onCountChange?.();
      onProgress?.(placed, target);
      // 让出主线程，保持帧循环与 UI 响应
      await new Promise((r) => setTimeout(r, 0));
    }
    this.onCountChange?.();
    return placed;
  }

  clearAll(): void {
    this.site.resetDensity();
    this.forest.clear();
    this.clearIndex();
    this.onCountChange?.();
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }
}
