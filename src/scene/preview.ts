import * as THREE from 'three';
import type { SpeciesParams } from '../core/species';
import { generateSkeleton } from '../core/lsystem';
import { buildBranchGeometry, buildLeafData, buildLeafGeometry } from '../core/geometry';
import { createForestUniforms } from '../core/materials';
import { createMaterialSet, maturityOf } from '../core/forest';

/**
 * 树种参数预览：独立 Scene + 剪刀视口渲染到面板小画布，
 * 与主场景共享同一套风 / 季节着色器。
 */
export class TreePreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private uniforms = createForestUniforms();
  private mats = createMaterialSet(this.uniforms);
  private treeGroup = new THREE.Group();
  private current: SpeciesParams | null = null;
  private treeHeight = 4;
  private angle = 0.6;
  private autoRotate = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.scene.background = new THREE.Color('#dfe9dd');
    const hemi = new THREE.HemisphereLight(0xffffff, 0x88aa88, 1.2);
    this.scene.add(hemi);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 32),
      new THREE.MeshStandardMaterial({ color: '#9bc283' }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    this.scene.add(this.treeGroup);

    canvas.addEventListener('pointerdown', () => { this.autoRotate = false; });
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons === 1) this.angle += e.movementX * 0.01;
    });
    canvas.addEventListener('pointerup', () => { this.autoRotate = true; });
  }

  setSpecies(p: SpeciesParams): void {
    this.current = p;
    this.uniforms.uLeafColorA.value.set(p.leafColors[1]);
    this.uniforms.uLeafColorB.value.set(p.leafColors[1]);
    this.uniforms.uLeafCoverage.value = 1;
    this.uniforms.uBarkColor.value.set(p.barkColor);
    this.rebuild();
  }

  setSeason(season: number, p: SpeciesParams): void {
    this.uniforms.uLeafColorA.value.set(p.leafColors[season]);
    this.uniforms.uLeafColorB.value.set(p.leafColors[(season + 1) % 4]);
    this.uniforms.uLeafCoverage.value = p.evergreen ? 0.9 : [0.85, 1, 0.6, 0.08][season];
  }

  private rebuild(): void {
    if (!this.current) return;
    this.clearGroup();
    const p = this.current;
    const skel = generateSkeleton(p, 12345, 1);
    const branchGeo = buildBranchGeometry(skel, 6, p.barkColor);
    const branch = new THREE.Mesh(branchGeo, this.mats.branch);
    this.treeGroup.add(branch);

    const leafData = buildLeafData(skel);
    const geo = new THREE.InstancedBufferGeometry();
    const unit = buildLeafGeometry();
    geo.index = unit.getIndex();
    geo.setAttribute('position', unit.getAttribute('position'));
    geo.setAttribute('normal', unit.getAttribute('normal'));
    geo.setAttribute('uv', unit.getAttribute('uv'));
    const maturity = maturityOf(p, 5);
    const treeScale = 0.25 + 0.75 * maturity;
    const leafScale = treeScale * p.leafSize * 2;
    const n = leafData.count;
    // 预览只有一棵树，叶片位置直接乘树体缩放（位于原点，无平移/旋转）
    const worldPos = new Float32Array(leafData.positions.length);
    for (let i = 0; i < n; i++) {
      worldPos[i * 3] = leafData.positions[i * 3] * treeScale;
      worldPos[i * 3 + 1] = leafData.positions[i * 3 + 1] * treeScale;
      worldPos[i * 3 + 2] = leafData.positions[i * 3 + 2] * treeScale;
    }
    geo.setAttribute('aLeafPos', new THREE.InstancedBufferAttribute(worldPos, 3));
    geo.setAttribute('aLeafDir', new THREE.InstancedBufferAttribute(leafData.directions, 3));
    geo.setAttribute('aLeafSeed', new THREE.InstancedBufferAttribute(leafData.seeds, 1));
    geo.setAttribute('aTreeAge', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(maturity), 1));
    geo.setAttribute('aTreeDensity', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(leafScale), 1));
    geo.instanceCount = n;
    const leaves = new THREE.Mesh(geo, this.mats.leaf);
    leaves.frustumCulled = false;
    this.treeGroup.add(leaves);

    // 相机取景
    this.treeHeight = Math.max(2, skel.height);
    this.camera.position.set(Math.cos(this.angle) * this.treeHeight * 1.3, this.treeHeight * 0.7, Math.sin(this.angle) * this.treeHeight * 1.3);
    this.camera.lookAt(0, this.treeHeight * 0.45, 0);
  }

  private clearGroup(): void {
    for (const child of [...this.treeGroup.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      this.treeGroup.remove(mesh);
    }
  }

  render(t: number): void {
    if (!this.current) return;
    if (this.autoRotate) this.angle += 0.0035;
    const h = this.treeHeight;
    const dist = Math.max(5, h * 1.5);
    this.camera.position.set(Math.cos(this.angle) * dist, h * 0.55, Math.sin(this.angle) * dist);
    this.camera.lookAt(0, h * 0.42, 0);
    this.uniforms.uTime.value = t;
    // 独立 WebGL 上下文，铺满自身小画布
    this.renderer.setViewport(0, 0, this.renderer.domElement.width, this.renderer.domElement.height);
    this.renderer.render(this.scene, this.camera);
  }

  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
