import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { rankByScore } from '../src/core/ranking';

describe('rankByScore', () => {
  it('점수 높은 순, 공동 순위는 한 배열로 묶는다', () => {
    const ranking = rankByScore([
      { seat: 0, score: 5 },
      { seat: 1, score: 9 },
      { seat: 2, score: 5 },
      { seat: 3, score: 1 },
    ]);
    expect(ranking).toEqual([[1], [0, 2], [3]]);
  });

  it('낮을수록 좋은 점수(반응 속도 등)도 처리한다', () => {
    expect(rankByScore([{ seat: 0, score: 300 }, { seat: 1, score: 250 }], false)).toEqual([[1], [0]]);
  });

  it('전원 동점이면 전원 1위', () => {
    expect(rankByScore([{ seat: 0, score: 0 }, { seat: 1, score: 0 }])).toEqual([[0, 1]]);
  });
});

describe('createRng', () => {
  it('같은 시드는 같은 순서, 범위를 지킨다', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 50; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(createRng(1).next()).not.toBe(createRng(2).next());
    const r = createRng(3);
    for (let i = 0; i < 100; i++) expect([0, 1, 2]).toContain(r.int(3));
  });
});
