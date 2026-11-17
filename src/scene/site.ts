import * as THREE from 'three';

export interface BuildingBox {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  height: number;
}

export const SITE_SIZE = 200;

/** 场地建筑布局：办公楼、展廊、管理用房，围合出开放草坪 */
export const BUILDINGS: BuildingBox[] = [
  { minX: -70, maxX: -38, minZ: -55, maxZ: -25, height: 16 },
  { minX: 30, maxX: 62, minZ: -60, maxZ: -30, height: 10 },
  { minX: -55, maxX: -25, minZ: 35, maxZ: 58, height: 7 },
  { minX: 40, maxX: 70, minZ: 30, maxZ: 52, height: 12 },
  { minX: -12, maxX: 12, minZ: 78, maxZ: 90, height: 6 },
];

/** 阳光方向（与 L-系统向光方向、着色器 sunDir 保持一致） */
export const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.35).normalize();

export class Site {
  readonly group = new THREE.Group();
  readonly shadowMesh: THREE.Mesh;
  private buildings: THREE.Mesh[] = [];
  private grid: Float32Array;
  private readonly cells = 256;
  private readonly cellSize = SITE_SIZE / 256;

  constructor() {
    // 地面
    const groundGeo = new THREE.PlaneGeometry(SITE_SIZE, SITE_SIZE, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: '#7fae6b', roughness: 1, metalness: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.group.add(ground);

    // 场地边界与网格线（总平面感）
    const gridHelper = new THREE.GridHelper(SITE_SIZE, 40, 0x4a7a4f, 0x6a9a6a);
    (gridHelper.material as THREE.Material).opacity = 0.35;
    (gridHelper.material as THREE.Material).transparent = true;
    gridHelper.position.y = 0.02;
    this.group.add(gridHelper);

    // 道路：十字主路
    const roadMat = new THREE.MeshStandardMaterial({ color: '#9aa098', roughness: 0.95 });
    const road1 = new THREE.Mesh(new THREE.PlaneGeometry(8, SITE_SIZE), roadMat);
    road1.rotation.x = -Math.PI / 2;
    road1.position.y = 0.03;
    const road2 = new THREE.Mesh(new THREE.PlaneGeometry(SITE_SIZE, 8), roadMat);
    road2.rotation.x = -Math.PI / 2;
    road2.position.y = 0.03;
    this.group.add(road1, road2);

    // 建筑
    const wallMat = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.8 });
    for (const b of BUILDINGS) {
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const geo = new THREE.BoxGeometry(w, b.height, d);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set((b.minX + b.maxX) / 2, b.height / 2, (b.minZ + b.maxZ) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.buildings.push(mesh);
      this.group.add(mesh);
    }

    // 阴影接收用隐形地面（shadow material 叠加），与主地面共面略抬高避免 z-fighting
    const shadowGeo = new THREE.PlaneGeometry(SITE_SIZE, SITE_SIZE);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMesh = new THREE.Mesh(
      shadowGeo,
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    this.shadowMesh.position.y = 0.05;
    this.shadowMesh.receiveShadow = true;
    this.group.add(this.shadowMesh);

    this.grid = new Float32Array(this.cells * this.cells);
  }

  /** 世界坐标是否落在建筑或道路内（禁止种树） */
  isObstacle(x: number, z: number): boolean {
    const half = SITE_SIZE / 2;
    if (x < -half || x > half || z < -half || z > half) return true;
    for (const b of BUILDINGS) {
      if (x >= b.minX - 1 && x <= b.maxX + 1 && z >= b.minZ - 1 && z <= b.maxZ + 1) return true;
    }
    // 十字路
    if (Math.abs(x) <= 4.6 || Math.abs(z) <= 4.6) return true;
    return false;
  }

  /**
   * 建筑投影阴影判定：沿阳光反方向发射水平射线，
   * 若先碰到建筑立面且交点低于建筑高度，则该点处于阴影中。
   */
  isInBuildingShadow(x: number, z: number): boolean {
    const dirX = -SUN_DIR.x;
    const dirZ = -SUN_DIR.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const dx = dirX / len;
    const dz = dirZ / len;
    const reach = 80;
    for (let t = 2; t < reach; t += 2) {
      const px = x + dx * t;
      const pz = z + dz * t;
      for (const b of BUILDINGS) {
        if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) {
          // 阴影长度 ≈ height / tan(太阳高度角)
          const shadowLen = b.height * (Math.hypot(SUN_DIR.x, SUN_DIR.z) / SUN_DIR.y);
          if (t <= shadowLen) return true;
          return false;
        }
      }
    }
    return false;
  }

  // ---------------- 密度网格（笔刷） ----------------

  private cellAt(x: number, z: number): { cx: number; cz: number } {
    const half = SITE_SIZE / 2;
    const cx = Math.floor((x + half) / this.cellSize);
    const cz = Math.floor((z + half) / this.cellSize);
    return { cx, cz };
  }

  /** 圆形笔刷叠加密度，返回新增的候选落点（米坐标 + 阴影标志） */
  stampBrush(cx: number, cz: number, radius: number, density: number, erase: boolean): { x: number; z: number; shadow: boolean }[] {
    const half = SITE_SIZE / 2;
    const minCx = Math.max(0, Math.floor((cx - radius + half) / this.cellSize));
    const maxCx = Math.min(this.cells - 1, Math.floor((cx + radius + half) / this.cellSize));
    const minCz = Math.max(0, Math.floor((cz - radius + half) / this.cellSize));
    const maxCz = Math.min(this.cells - 1, Math.floor((cz + radius + half) / this.cellSize));
    const r2 = radius * radius;
    const out: { x: number; z: number; shadow: boolean }[] = [];

    for (let ix = minCx; ix <= maxCx; ix++) {
      for (let iz = minCz; iz <= maxCz; iz++) {
        const wx = -half + (ix + 0.5) * this.cellSize;
        const wz = -half + (iz + 0.5) * this.cellSize;
        const d2 = (wx - cx) ** 2 + (wz - cz) ** 2;
        if (d2 > r2) continue;
        const idx = iz * this.cells + ix;
        if (erase) {
          this.grid[idx] = 0;
          continue;
        }
        const falloff = 1 - Math.sqrt(d2) / radius;
        const target = Math.min(1, this.grid[idx] + density * falloff * 0.35);
        const before = this.grid[idx];
        this.grid[idx] = target;
        // 密度跨过阈值时产生一个种植点
        if (before < 0.5 && target >= 0.5 && !this.isObstacle(wx, wz)) {
          out.push({ x: wx, z: wz, shadow: this.isInBuildingShadow(wx, wz) });
        }
      }
    }
    return out;
  }

  /** 擦除笔刷：返回需要移除的树所在网格单元范围 */
  eraseCells(cx: number, cz: number, radius: number): { minCx: number; maxCx: number; minCz: number; maxCz: number } {
    const half = SITE_SIZE / 2;
    return {
      minCx: Math.max(0, Math.floor((cx - radius + half) / this.cellSize)),
      maxCx: Math.min(this.cells - 1, Math.floor((cx + radius + half) / this.cellSize)),
      minCz: Math.max(0, Math.floor((cz - radius + half) / this.cellSize)),
      maxCz: Math.min(this.cells - 1, Math.floor((cz + radius + half) / this.cellSize)),
    };
  }

  cellIndexOf(x: number, z: number): number {
    const { cx, cz } = this.cellAt(x, z);
    if (cx < 0 || cz < 0 || cx >= this.cells || cz >= this.cells) return -1;
    return cz * this.cells + cx;
  }

  get cellsPerSide(): number {
    return this.cells;
  }

  resetDensity(): void {
    this.grid.fill(0);
  }
}
