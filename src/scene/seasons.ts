import * as THREE from 'three';
import type { ForestUniforms } from '../core/materials';
import type { SpeciesParams } from '../core/species';

export type Season = 0 | 1 | 2 | 3;
export const SEASON_NAMES = ['春', '夏', '秋', '冬'] as const;

/** 各季节全局叶量覆盖率（常绿树冬季仍保留 0.85） */
const COVERAGE = [0.85, 1.0, 0.6, 0.08];
const EVERGREEN_COVERAGE = [0.9, 1.0, 0.92, 0.85];

const FOG_COLORS = ['#d7e8da', '#cfe3d4', '#e6dcc4', '#dde2e6'];
const BG_COLORS = ['#cfe2f3', '#bfe0f5', '#f0e2c8', '#e6eaee'];
const SUN_COLORS = ['#fff2d8', '#fff8e6', '#ffd9a0', '#e8eef8'];

export class SeasonSystem {
  season: Season = 0;
  /** 0..1，向当前季节内推进的插值 */
  private mix = 0;
  private auto = false;
  private timer = 0;
  private autoPeriod = 8; // 秒/季
  private uniforms: ForestUniforms;
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private currentSpecies: SpeciesParams;

  constructor(uniforms: ForestUniforms, scene: THREE.Scene, sun: THREE.DirectionalLight, species: SpeciesParams) {
    this.uniforms = uniforms;
    this.scene = scene;
    this.sun = sun;
    this.currentSpecies = species;
    this.apply(0, true);
  }

  setSpecies(species: SpeciesParams): void {
    this.currentSpecies = species;
    this.apply(this.season, true);
  }

  setSeason(s: Season): void {
    this.season = s;
    this.mix = 0;
    this.apply(s, true);
  }

  setAuto(v: boolean): void {
    this.auto = v;
  }

  get isAuto(): boolean {
    return this.auto;
  }

  update(dt: number): Season | null {
    if (!this.auto) return null;
    this.timer += dt;
    this.mix = Math.min(1, this.timer / this.autoPeriod);
    this.apply(this.season, false);
    if (this.timer >= this.autoPeriod) {
      this.timer = 0;
      this.mix = 0;
      const next = ((this.season + 1) % 4) as Season;
      this.season = next;
      this.apply(next, true);
      return next;
    }
    return null;
  }

  private apply(season: Season, snap: boolean): void {
    const p = this.currentSpecies;
    const nextSeason = ((season + 1) % 4) as Season;
    const cA = new THREE.Color(p.leafColors[season]);
    const cB = new THREE.Color(p.leafColors[nextSeason]);
    this.uniforms.uLeafColorA.value.copy(cA);
    this.uniforms.uLeafColorB.value.copy(cB);
    this.uniforms.uSeason.value = season;
    this.uniforms.uSeasonMix.value = snap ? 0 : this.mix;

    const covTable = p.evergreen ? EVERGREEN_COVERAGE : COVERAGE;
    const covA = covTable[season];
    const covB = covTable[nextSeason];
    this.uniforms.uLeafCoverage.value = THREE.MathUtils.lerp(covA, covB, snap ? 0 : this.mix);

    const fogA = new THREE.Color(FOG_COLORS[season]);
    const fogB = new THREE.Color(FOG_COLORS[nextSeason]);
    this.uniforms.uFogColor.value.copy(fogA).lerp(fogB, snap ? 0 : this.mix);

    const bgA = new THREE.Color(BG_COLORS[season]);
    const bgB = new THREE.Color(BG_COLORS[nextSeason]);
    this.scene.background = bgA.clone().lerp(bgB, snap ? 0 : this.mix);
    this.scene.fog = new THREE.Fog(this.uniforms.uFogColor.value.getHex(), 60, 190);

    const sunA = new THREE.Color(SUN_COLORS[season]);
    const sunB = new THREE.Color(SUN_COLORS[nextSeason]);
    this.sun.color.copy(sunA).lerp(sunB, snap ? 0 : this.mix);
    this.sun.intensity = [1.5, 1.7, 1.25, 0.9][season];
  }
}
