export interface Rng {
  /** 0 이상 1 미만 */
  next(): number;
  /** 0 이상 n 미만 정수 */
  int(n: number): number;
  range(min: number, max: number): number;
}

/** 시드 고정 난수(mulberry32). 같은 시드는 항상 같은 순서를 만든다. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (min, max) => min + next() * (max - min),
  };
}
