import * as THREE from 'three';
import type { Forest } from '../core/forest';
import { TemplateLibrary } from '../core/template';
import type { SpeciesParams } from '../core/species';

export interface PruneHit {
  treeId: number;
  nodeId: number;
  point: THREE.Vector3;
}

/**
 * 修剪拾取：射线先与场景求交，再用交点处的 branchId 定位骨架节点。
 * 实例池树木用模板几何的 branchId；自定义树直接读自身几何。
 */
export class PrunePicker {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private forest: Forest;
  private library: TemplateLibrary;
  private resolveSpecies: (id: string) => SpeciesParams;

  constructor(
    forest: Forest,
    library: TemplateLibrary,
    resolveSpecies: (id: string) => SpeciesParams,
  ) {
    this.forest = forest;
    this.library = library;
    this.resolveSpecies = resolveSpecies;
  }

  pick(clientX: number, clientY: number, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement): PruneHit | null {
    const rect = canvas.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, camera);

    // 1. 自定义修剪树（普通 Mesh，带 branchId 与 treeId）
    const customHits = this.raycaster.intersectObjects(this.forest.group.children, true);
    for (const hit of customHits) {
      const treeId = hit.object.userData.treeId as number | undefined;
      if (treeId === undefined) continue;
      const tree = this.forest.getTree(treeId);
      if (!tree?.custom || hit.faceIndex == null) continue;
      const obj = hit.object as THREE.Mesh;
      const nodeAttr = obj.geometry.getAttribute('branchId') as THREE.BufferAttribute | undefined;
      if (!nodeAttr) continue;
      const nodeId = nodeAttr.getX(hit.faceIndex * 3);
      return { treeId, nodeId, point: hit.point.clone() };
    }

    // 2. 实例池树木：InstancedMesh 求交，instanceId 反查树记录
    const poolTrees = this.forest.listTrees().filter((t) => !t.custom && t.lod < 2);
    const meshes = this.forest.group.children.filter((o) => {
      const m = o as THREE.InstancedMesh;
      return m.isInstancedMesh && m.count > 0 && m.geometry.getAttribute('branchId') !== undefined;
    }) as THREE.InstancedMesh[];

    const hits = this.raycaster.intersectObjects(meshes, false);
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const hit of hits) {
      if (hit.instanceId === undefined || hit.faceIndex == null) continue;
      const mesh = hit.object as THREE.InstancedMesh;
      const nodeAttr = mesh.geometry.getAttribute('branchId') as THREE.BufferAttribute;
      const nodeId = nodeAttr.getX(hit.faceIndex * 3);
      mesh.getMatrixAt(hit.instanceId, matrix);
      pos.setFromMatrixPosition(matrix);
      const tree = poolTrees.find((t) => Math.abs(t.x - pos.x) < 0.01 && Math.abs(t.z - pos.z) < 0.01);
      if (!tree) continue;
      const species = this.resolveSpecies(tree.speciesId);
      const tpl = this.library.get(species, tree.variant);
      if (nodeId >= tpl.skeleton.nodes.length || tpl.skeleton.nodes[nodeId].culled) continue;
      return { treeId: tree.id, nodeId, point: hit.point.clone() };
    }
    return null;
  }
}
