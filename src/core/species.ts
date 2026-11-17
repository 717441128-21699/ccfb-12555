/** 树种参数：每棵树一套，L-系统、叶量、物候全部由它驱动。 */
export interface SpeciesParams {
  id: string;
  name: string;
  /** L-系统公理 */
  axiom: string;
  /** 随机产生式：键为符号，值为候选规则及权重 */
  rules: Record<string, { successor: string; weight: number }[]>;
  /** L-系统迭代次数 */
  iterations: number;
  /** 初始节间长度（米） */
  segmentLength: number;
  /** 初始枝干半径（米） */
  baseRadius: number;
  /** 每升高一级枝序，半径衰减系数 */
  radiusDecay: number;
  /** 每升高一级枝序，节间长度衰减 */
  lengthDecay: number;
  /** 分枝基础偏转角（弧度） */
  branchAngle: number;
  /** 偏转角随机扰动幅度（弧度） */
  angleJitter: number;
  /** 向光弯曲强度（树冠朝光照方向偏长） */
  tropism: number;
  /** 叶片数量（满冠时） */
  leafCount: number;
  /** 单片叶尺寸（米） */
  leafSize: number;
  /** 生长速度：每年成熟度增量，1.0 表示约 10 年成熟 */
  growthRate: number;
  /** 常绿树种冬季不落叶（如雪松） */
  evergreen: boolean;
  /** 春夏秋冬四季叶色（线性 sRGB） */
  leafColors: [string, string, string, string];
  /** 树皮色 */
  barkColor: string;
}

export const SPECIES: SpeciesParams[] = [
  {
    id: 'ginkgo',
    name: '银杏',
    axiom: 'X',
    rules: {
      X: [
        { successor: 'F[+X][-X]FX', weight: 3 },
        { successor: 'F[-X]FX', weight: 2 },
        { successor: 'F[+X]FX', weight: 2 },
        { successor: 'F[+X][&X][^X]FX', weight: 1 },
      ],
      F: [{ successor: 'FF', weight: 1 }],
    },
    iterations: 5,
    segmentLength: 0.62,
    baseRadius: 0.14,
    radiusDecay: 0.68,
    lengthDecay: 0.86,
    branchAngle: 0.55,
    angleJitter: 0.22,
    tropism: 0.35,
    leafCount: 1300,
    leafSize: 0.11,
    growthRate: 0.75,
    evergreen: false,
    leafColors: ['#9fcf6a', '#4f9e3c', '#e8b53a', '#c9b48a'],
    barkColor: '#6b5238',
  },
  {
    id: 'camphor',
    name: '香樟',
    axiom: 'X',
    rules: {
      X: [
        { successor: 'F[+X][-X][&X]FX', weight: 4 },
        { successor: 'F[+X][-X]FX', weight: 3 },
        { successor: 'F[^X][&X]FX', weight: 2 },
      ],
      F: [{ successor: 'FF', weight: 1 }],
    },
    iterations: 5,
    segmentLength: 0.5,
    baseRadius: 0.17,
    radiusDecay: 0.7,
    lengthDecay: 0.82,
    branchAngle: 0.72,
    angleJitter: 0.3,
    tropism: 0.5,
    leafCount: 1700,
    leafSize: 0.09,
    growthRate: 0.9,
    evergreen: true,
    leafColors: ['#7cc25a', '#2f7d33', '#5d9440', '#3d6b35'],
    barkColor: '#5a4632',
  },
  {
    id: 'cherry',
    name: '樱花',
    axiom: 'X',
    rules: {
      X: [
        { successor: 'F[+X][-X]FX', weight: 3 },
        { successor: 'F[+X][&X]FX', weight: 2 },
        { successor: 'F[-X][^X]FX', weight: 2 },
        { successor: 'F[+X][-X][^X]FX', weight: 1 },
      ],
      F: [{ successor: 'FF', weight: 1 }],
    },
    iterations: 5,
    segmentLength: 0.55,
    baseRadius: 0.12,
    radiusDecay: 0.65,
    lengthDecay: 0.84,
    branchAngle: 0.62,
    angleJitter: 0.28,
    tropism: 0.42,
    leafCount: 1100,
    leafSize: 0.1,
    growthRate: 1.0,
    evergreen: false,
    leafColors: ['#f3b7c5', '#5ca848', '#e08a3c', '#b79a7d'],
    barkColor: '#59423c',
  },
  {
    id: 'metasequoia',
    name: '水杉',
    axiom: 'X',
    rules: {
      X: [
        { successor: 'F[+X]F[-X]FX', weight: 2 },
        { successor: 'F[+X][-X]FX', weight: 3 },
        { successor: 'F[&X][^X]FX', weight: 2 },
      ],
      F: [{ successor: 'FF', weight: 1 }],
    },
    iterations: 6,
    segmentLength: 0.42,
    baseRadius: 0.16,
    radiusDecay: 0.6,
    lengthDecay: 0.8,
    branchAngle: 0.95,
    angleJitter: 0.14,
    tropism: 0.15,
    leafCount: 1500,
    leafSize: 0.07,
    growthRate: 1.1,
    evergreen: false,
    leafColors: ['#86c96a', '#3c8f4a', '#b5793a', '#9a8a72'],
    barkColor: '#6a4a35',
  },
  {
    id: 'cedar',
    name: '雪松',
    axiom: 'X',
    rules: {
      X: [
        { successor: 'F[&X][^X][+X][-X]FX', weight: 3 },
        { successor: 'F[+X][-X]FX', weight: 2 },
        { successor: 'F[&X][^X]FX', weight: 2 },
      ],
      F: [{ successor: 'FF', weight: 1 }],
    },
    iterations: 5,
    segmentLength: 0.46,
    baseRadius: 0.18,
    radiusDecay: 0.62,
    lengthDecay: 0.78,
    branchAngle: 1.05,
    angleJitter: 0.18,
    tropism: 0.1,
    leafCount: 1800,
    leafSize: 0.06,
    growthRate: 0.85,
    evergreen: true,
    leafColors: ['#5d8f6a', '#2f6b4f', '#46705a', '#35544a'],
    barkColor: '#5e4a3a',
  },
];

/** UI 可编辑的数值参数（规则文本另行处理） */
export const EDITABLE_FIELDS: { key: keyof SpeciesParams; label: string; min: number; max: number; step: number; unit?: string }[] = [
  { key: 'iterations', label: 'L-系统迭代次数', min: 3, max: 6, step: 1 },
  { key: 'segmentLength', label: '节间长度', min: 0.2, max: 1.0, step: 0.02, unit: 'm' },
  { key: 'baseRadius', label: '主干半径', min: 0.05, max: 0.3, step: 0.01, unit: 'm' },
  { key: 'radiusDecay', label: '枝径衰减系数', min: 0.5, max: 0.85, step: 0.01 },
  { key: 'lengthDecay', label: '节间长度衰减', min: 0.65, max: 0.98, step: 0.01 },
  { key: 'branchAngle', label: '分枝角度', min: 0.2, max: 1.3, step: 0.02, unit: 'rad' },
  { key: 'angleJitter', label: '角度随机扰动', min: 0, max: 0.5, step: 0.02, unit: 'rad' },
  { key: 'tropism', label: '向光弯曲强度', min: 0, max: 1, step: 0.02 },
  { key: 'leafCount', label: '叶片数量', min: 300, max: 3000, step: 100 },
  { key: 'leafSize', label: '叶片尺寸', min: 0.03, max: 0.2, step: 0.005, unit: 'm' },
  { key: 'growthRate', label: '生长速度', min: 0.4, max: 1.5, step: 0.05 },
];

export function cloneSpecies(p: SpeciesParams): SpeciesParams {
  return {
    ...p,
    rules: Object.fromEntries(
      Object.entries(p.rules).map(([k, alts]) => [k, alts.map((a) => ({ ...a }))]),
    ),
    leafColors: [...p.leafColors] as [string, string, string, string],
  };
}
