import * as THREE from 'three';
import { RNG } from './rng';
import type { SpeciesParams } from './species';

export interface SkeletonNode {
  id: number;
  parent: number;
  pos: THREE.Vector3;
  radius: number;
  depth: number;
  /** 被密度变体或修剪移除 */
  culled: boolean;
  /** 修剪切口，下一季萌发侧枝的位置 */
  cut: boolean;
  /** 该切口已经萌发过几轮（最多 3 轮） */
  regrowRounds: number;
}

export interface LeafAnchor {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  seed: number;
}

export interface Skeleton {
  nodes: SkeletonNode[];
  children: number[][];
  anchors: LeafAnchor[];
  maxDepth: number;
  height: number;
  canopyRadius: number;
  canopyCenter: THREE.Vector3;
}

const MAX_STRING = 260000;

/** 随机 L-系统字符串展开（按权重挑选产生式） */
function expand(p: SpeciesParams, rng: RNG): string {
  let s = p.axiom;
  for (let iter = 0; iter < p.iterations; iter++) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const alts = p.rules[ch];
      if (!alts) {
        out += ch;
        continue;
      }
      let total = 0;
      for (const a of alts) total += a.weight;
      let roll = rng.next() * total;
      let chosen = alts[0].successor;
      for (const a of alts) {
        roll -= a.weight;
        if (roll <= 0) {
          chosen = a.successor;
          break;
        }
      }
      out += chosen;
      if (out.length > MAX_STRING) break;
    }
    s = out;
    if (s.length >= MAX_STRING) break;
  }
  return s;
}

interface Frame {
  pos: THREE.Vector3;
  h: THREE.Vector3; // 前进方向
  l: THREE.Vector3; // 左
  u: THREE.Vector3; // 上
  depth: number;
  node: number; // 当前所在节点 id
}

const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.35).normalize();

/** 龟图解释 L-系统字符串，输出枝干骨架 */
function interpret(word: string, p: SpeciesParams, rng: RNG): Skeleton {
  const nodes: SkeletonNode[] = [];
  const children: number[][] = [];

  const root: SkeletonNode = {
    id: 0, parent: -1, pos: new THREE.Vector3(0, 0, 0),
    radius: p.baseRadius, depth: 0, culled: false, cut: false, regrowRounds: 0,
  };
  nodes.push(root);
  children.push([]);

  const frame: Frame = {
    pos: new THREE.Vector3(0, 0, 0),
    h: new THREE.Vector3(0, 1, 0),
    l: new THREE.Vector3(1, 0, 0),
    u: new THREE.Vector3(0, 0, 1),
    depth: 0,
    node: 0,
  };
  const stack: Frame[] = [];
  const tmp = new THREE.Vector3();

  const rotateFrame = (axis: THREE.Vector3, angle: number) => {
    frame.h.applyAxisAngle(axis, angle);
    frame.l.applyAxisAngle(axis, angle);
    frame.u.applyAxisAngle(axis, angle);
  };

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    switch (ch) {
      case 'F': {
        // 向光性：每一步把生长方向往阳光方向掰一点
        tmp.copy(SUN_DIR).multiplyScalar(p.tropism * 0.12);
        frame.h.add(tmp).normalize();
        const len = p.segmentLength * Math.pow(p.lengthDecay, frame.depth);
        const next = frame.pos.clone().addScaledVector(frame.h, len);
        const depth = frame.depth;
        const node: SkeletonNode = {
          id: nodes.length,
          parent: frame.node,
          pos: next,
          radius: p.baseRadius * Math.pow(p.radiusDecay, depth + 1),
          depth: depth + 1,
          culled: false, cut: false, regrowRounds: 0,
        };
        nodes.push(node);
        children.push([]);
        children[frame.node].push(node.id);
        frame.node = node.id;
        frame.pos.copy(next);
        break;
      }
      case '+': rotateFrame(frame.u, p.branchAngle + rng.range(-p.angleJitter, p.angleJitter)); break;
      case '-': rotateFrame(frame.u, -(p.branchAngle + rng.range(-p.angleJitter, p.angleJitter))); break;
      case '&': rotateFrame(frame.l, p.branchAngle + rng.range(-p.angleJitter, p.angleJitter)); break;
      case '^': rotateFrame(frame.l, -(p.branchAngle + rng.range(-p.angleJitter, p.angleJitter))); break;
      case '\\': rotateFrame(frame.h, rng.range(-p.angleJitter, p.angleJitter)); break;
      case '/': rotateFrame(frame.h, rng.range(-p.angleJitter, p.angleJitter)); break;
      case '[':
        stack.push({
          pos: frame.pos.clone(), h: frame.h.clone(), l: frame.l.clone(),
          u: frame.u.clone(), depth: frame.depth, node: frame.node,
        });
        frame.depth++;
        break;
      case ']': {
        const f = stack.pop();
        if (f) {
          frame.pos.copy(f.pos); frame.h.copy(f.h); frame.l.copy(f.l);
          frame.u.copy(f.u); frame.depth = f.depth; frame.node = f.node;
        }
        break;
      }
      default:
        // X 等生长符号：空操作
        break;
    }
  }

  const skeleton: Skeleton = {
    nodes, children, anchors: [], maxDepth: 0,
    height: 0, canopyRadius: 0, canopyCenter: new THREE.Vector3(),
  };
  finalizeAnchors(skeleton, p, rng);
  return skeleton;
}

/** 在枝梢上布置叶片锚点 */
function finalizeAnchors(skel: Skeleton, p: SpeciesParams, rng: RNG): void {
  let maxDepth = 0;
  let height = 0;
  const tips: number[] = [];
  for (const n of skel.nodes) {
    if (n.depth > maxDepth) maxDepth = n.depth;
    if (n.pos.y > height) height = n.pos.y;
    if (skel.children[n.id].length === 0 && n.depth >= 2) tips.push(n.id);
  }
  skel.maxDepth = maxDepth;
  skel.height = height;

  // 冠幅与冠心：取上部 40% 节点的外包范围
  const canopyNodes = skel.nodes.filter((n) => n.depth >= Math.max(2, maxDepth - 2));
  const center = new THREE.Vector3();
  for (const cn of canopyNodes) center.add(cn.pos);
  if (canopyNodes.length) center.multiplyScalar(1 / canopyNodes.length);
  let radius = 0.1;
  for (const cn of canopyNodes) radius = Math.max(radius, cn.pos.distanceTo(center));
  skel.canopyCenter.copy(center);
  skel.canopyRadius = radius;

  if (tips.length === 0) return;
  const anchors: LeafAnchor[] = [];
  for (let i = 0; i < p.leafCount; i++) {
    const nodeId = tips[Math.floor(rng.next() * tips.length)];
    const n = skel.nodes[nodeId];
    const parent = skel.nodes[n.parent];
    const dir = n.pos.clone().sub(parent.pos).normalize();
    const jitter = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1))
      .multiplyScalar(p.leafSize * 1.6);
    anchors.push({
      pos: n.pos.clone().add(jitter),
      dir,
      seed: rng.next() * 1000,
    });
  }
  skel.anchors = anchors;
}

/**
 * 生成完整骨架。
 * @param density 1=茂密 0.7=中等 0.45=建筑阴影下的稀枝变体
 */
export function generateSkeleton(p: SpeciesParams, seed: number, density = 1): Skeleton {
  const rng = new RNG(seed);
  const word = expand(p, rng);
  const skel = interpret(word, p, rng);
  if (density < 0.999) applyDensity(skel, density, rng);
  return skel;
}

/** 随机移除整段侧枝来模拟光照不足导致的稀枝 */
function applyDensity(skel: Skeleton, density: number, rng: RNG): void {
  const removeProb = 1 - density;
  for (let id = 1; id < skel.nodes.length; id++) {
    const n = skel.nodes[id];
    if (n.culled || n.depth < 2) continue;
    if (rng.chance(removeProb * 0.55)) cullSubtree(skel, id);
  }
  // 叶片锚点按密度等比保留
  const keep = Math.floor(skel.anchors.length * density);
  if (keep < skel.anchors.length) skel.anchors.length = keep;
}

/** 剪除某节点及其全部后代，节点本身标记为切口 */
export function cullSubtree(skel: Skeleton, nodeId: number): void {
  const stack = [nodeId];
  const target = skel.nodes[nodeId];
  if (!target || target.culled) return;
  target.culled = true;
  target.cut = true;
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of skel.children[id]) {
      skel.nodes[c].culled = true;
      stack.push(c);
    }
  }
  // 去掉被剪除区域的叶片锚点（按位置范围近似剔除）
  const culledPos = skel.nodes[nodeId].pos;
  const parentNode = skel.nodes[skel.nodes[nodeId].parent];
  const parentPos = parentNode ? parentNode.pos : new THREE.Vector3();
  const r = culledPos.distanceTo(parentPos) + 0.01;
  skel.anchors = skel.anchors.filter((a) => a.pos.distanceTo(culledPos) > r * 3);
}

/**
 * 季节切换时从剪口萌发侧枝：每个切口长出 2~3 根、每根 2~3 节的新枝。
 * 返回本次新增的切口数；已萌发 3 轮的切口不再生长。
 */
export function regrowFromCuts(skel: Skeleton, p: SpeciesParams, seed: number): number {
  const rng = new RNG(seed);
  const cuts = skel.nodes.filter((n) => n.cut && n.regrowRounds < 3);
  if (cuts.length === 0) return 0;

  for (const cut of cuts) {
    cut.regrowRounds++;
    const shootCount = 2 + Math.floor(rng.next() * 2);
    for (let s = 0; s < shootCount; s++) {
      let parent = cut.id;
      let dir = new THREE.Vector3(rng.range(-1, 1), 0.6, rng.range(-1, 1)).normalize();
      const chain = 2 + Math.floor(rng.next() * 2);
      for (let k = 0; k < chain; k++) {
        const len = p.segmentLength * Math.pow(p.lengthDecay, cut.depth + k) * 0.7;
        const pos = skel.nodes[parent].pos.clone().addScaledVector(dir, len);
        const node: SkeletonNode = {
          id: skel.nodes.length,
          parent,
          pos,
          radius: Math.max(0.008, p.baseRadius * Math.pow(p.radiusDecay, cut.depth + k + 1)),
          depth: cut.depth + k + 1,
          culled: false, cut: false, regrowRounds: 0,
        };
        skel.nodes.push(node);
        skel.children.push([]);
        skel.children[parent].push(node.id);
        parent = node.id;
        // 新梢向光弯曲
        dir.addScaledVector(SUN_DIR, p.tropism * 0.15).add(
          new THREE.Vector3(rng.range(-0.3, 0.3), rng.range(0, 0.2), rng.range(-0.3, 0.3)),
        ).normalize();
        if (k === chain - 1) {
          skel.anchors.push({
            pos: pos.clone(), dir: dir.clone(), seed: rng.next() * 1000,
          });
        }
      }
    }
  }
  return cuts.length;
}

export function cloneSkeleton(skel: Skeleton): Skeleton {
  return {
    nodes: skel.nodes.map((n) => ({ ...n, pos: n.pos.clone() })),
    children: skel.children.map((c) => [...c]),
    anchors: skel.anchors.map((a) => ({
      pos: a.pos.clone(), dir: a.dir.clone(), seed: a.seed,
    })),
    maxDepth: skel.maxDepth,
    height: skel.height,
    canopyRadius: skel.canopyRadius,
    canopyCenter: skel.canopyCenter.clone(),
  };
}
