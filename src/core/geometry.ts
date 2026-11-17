import * as THREE from 'three';
import type { Skeleton } from './lsystem';

/**
 * 把骨架的每个节间生成为带锥度的圆柱段，合并成单个 BufferGeometry。
 * branchId 属性记录每段对应的骨架节点 id，供修剪模式射线拾取。
 * barkColor 烘焙为逐顶点 aBarkColor，区分不同树种的树皮色。
 */
export function buildBranchGeometry(
  skel: Skeleton,
  radialSegments: number,
  barkColor = '#6b5238',
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const branchIds: number[] = [];
  const bark: number[] = [];
  const barkRGB = new THREE.Color(barkColor);
  const indices: number[] = [];

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i < radialSegments; i++) {
    const a = (i / radialSegments) * Math.PI * 2;
    ring.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }

  for (const node of skel.nodes) {
    if (node.culled || node.parent < 0) continue;
    const parentNode = skel.nodes[node.parent];
    if (parentNode.culled) continue;

    dir.subVectors(node.pos, parentNode.pos);
    const len = dir.length();
    if (len < 1e-5) continue;
    dir.normalize();
    quat.setFromUnitVectors(up, dir);
    mid.addVectors(node.pos, parentNode.pos).multiplyScalar(0.5);
    const r0 = parentNode.radius;
    const r1 = node.radius;
    const base = positions.length / 3;

    for (let ringI = 0; ringI < 2; ringI++) {
      const r = ringI === 0 ? r0 : r1;
      const y = ringI === 0 ? -len / 2 : len / 2;
      for (let i = 0; i < radialSegments; i++) {
        const v = ring[i].clone().multiplyScalar(r);
        v.y = y;
        v.applyQuaternion(quat).add(mid);
        positions.push(v.x, v.y, v.z);
        const n = ring[i].clone().applyQuaternion(quat).normalize();
        normals.push(n.x, n.y, n.z);
        branchIds.push(node.id);
        bark.push(barkRGB.r, barkRGB.g, barkRGB.b);
      }
    }
    for (let i = 0; i < radialSegments; i++) {
      const a = base + i;
      const b = base + ((i + 1) % radialSegments);
      const c = base + radialSegments + i;
      const d = base + radialSegments + ((i + 1) % radialSegments);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('branchId', new THREE.Float32BufferAttribute(branchIds, 1));
  geo.setAttribute('aBarkColor', new THREE.Float32BufferAttribute(bark, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/** 叶片实例属性（位置/朝向/随机种子），位置本身在实例矩阵之外重复存储以便着色器使用 */
export interface LeafInstanceData {
  positions: Float32Array;
  directions: Float32Array;
  seeds: Float32Array;
  count: number;
}

export function buildLeafData(skel: Skeleton): LeafInstanceData {
  const anchors = skel.anchors;
  const count = anchors.length;
  const positions = new Float32Array(count * 3);
  const directions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = anchors[i];
    positions[i * 3] = a.pos.x;
    positions[i * 3 + 1] = a.pos.y;
    positions[i * 3 + 2] = a.pos.z;
    directions[i * 3] = a.dir.x;
    directions[i * 3 + 1] = a.dir.y;
    directions[i * 3 + 2] = a.dir.z;
    seeds[i] = a.seed;
  }
  return { positions, directions, seeds, count };
}

/** 单位四边形（本地 XY 平面），由实例矩阵缩放到叶片真实尺寸 */
export function buildLeafGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

/** 远景 LOD：两片正交的十字冠幅牌 */
export function buildCardGeometry(skel: Skeleton): THREE.BufferGeometry {
  const r = skel.canopyRadius;
  const c = skel.canopyCenter;
  const h = r * 1.25;
  const quad = (rotY: number): { pos: number[]; uv: number[] } => {
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const corners = [
      [-r, -h, 0, 0], [r, -h, 1, 0], [r, h, 1, 1], [-r, h, 0, 1],
    ];
    const pos: number[] = [];
    const uv: number[] = [];
    for (const [x, y, u, v] of corners) {
      const wx = x * cos;
      const wz = -x * sin;
      pos.push(c.x + wx, c.y + y, c.z + wz);
      uv.push(u, v);
    }
    return { pos, uv };
  };
  const q1 = quad(0);
  const q2 = quad(Math.PI / 2);
  const positions = [...q1.pos, ...q2.pos];
  const uvs = [...q1.uv, ...q2.uv];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ]);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
