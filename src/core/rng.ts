/** 可播种的确定性随机数生成器（mulberry32），保证同一棵树的形态可复现。 */
export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** [0, 1) 均匀分布 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 以概率 p 返回 true */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
}

/** 字符串哈希，用于把树种名 / 规则文本变成整数种子 */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
