import * as THREE from 'three';
import type { SpeciesParams } from './species';
import { generateSkeleton, type Skeleton } from './lsystem';
import {
  buildBranchGeometry, buildCardGeometry, buildLeafData, buildLeafGeometry,
  type LeafInstanceData,
} from './geometry';

export type DensityVariant = 0 | 1 | 2;
export const DENSITY_LEVELS = [1, 0.7, 0.45] as const;

export interface SpeciesTemplate {
  species: SpeciesParams;
  variant: DensityVariant;
  skeleton: Skeleton;
  branchGeoLod0: THREE.BufferGeometry;
  branchGeoLod1: THREE.BufferGeometry;
  cardGeo: THREE.BufferGeometry;
  leaf: LeafInstanceData;
  leafUnitGeo: THREE.BufferGeometry;
}

/** 每个树种 × 3 种密度变体（茂密 / 中等 / 建筑阴影下稀枝）各生成一次，全林复用 */
export class TemplateLibrary {
  private cache = new Map<string, SpeciesTemplate>();
  private generation = 0;

  private key(speciesId: string, variant: DensityVariant): string {
    return `${speciesId}#${variant}#${this.generation}`;
  }

  /** 参数被编辑后调用，使所有缓存失效 */
  invalidate(): void {
    for (const t of this.cache.values()) {
      t.branchGeoLod0.dispose();
      t.branchGeoLod1.dispose();
      t.cardGeo.dispose();
      t.leafUnitGeo.dispose();
    }
    this.cache.clear();
    this.generation++;
  }

  get(species: SpeciesParams, variant: DensityVariant): SpeciesTemplate {
    const k = this.key(species.id, variant);
    const hit = this.cache.get(k);
    if (hit) return hit;

    const density = DENSITY_LEVELS[variant];
    const seedBase = hashId(species.id);
    const skeleton = generateSkeleton(species, seedBase + variant * 977, density);
    const tpl: SpeciesTemplate = {
      species,
      variant,
      skeleton,
      branchGeoLod0: buildBranchGeometry(skeleton, 6, species.barkColor),
      branchGeoLod1: buildBranchGeometry(skeleton, 4, species.barkColor),
      cardGeo: buildCardGeometry(skeleton),
      leaf: buildLeafData(skeleton),
      leafUnitGeo: buildLeafGeometry(),
    };
    this.cache.set(k, tpl);
    return tpl;
  }
}

function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}
