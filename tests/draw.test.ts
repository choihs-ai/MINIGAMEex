import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { GAME_INFO, gameInfo, type GameInfo } from '../src/data/games';
import { drawSet } from '../src/modes/draw';
import { READY_GAMES } from '../src/minigames/registry';
import { tournamentPool } from '../src/modes/tournament';

const RANDOM_POOL = GAME_INFO.filter((g) => g.random7 && !g.partyOnly);
/** 게임이 아주 적을 때의 규칙을 보려고 고정한 3종(완성 게임이 늘어도 그대로) */
const THREE = ['G01', 'G19', 'G22'].map(gameInfo);

function check(seq: string[], opts: { categoryRule?: boolean } = {}): void {
  for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  if (opts.categoryRule !== false) {
    for (let i = 2; i < seq.length; i++) {
      const cats = [seq[i - 2], seq[i - 1], seq[i]].map((c) => gameInfo(c).category);
      expect(cats[0] === cats[1] && cats[1] === cats[2]).toBe(false);
    }
  }
}

describe('drawSet (토너먼트 게임 뽑기)', () => {
  it('세부표의 랜덤 후보는 54종이고 파티 게임은 없다', () => {
    expect(RANDOM_POOL).toHaveLength(54);
    expect(RANDOM_POOL.some((g) => g.category === '파티')).toBe(false);
  });

  it('게임이 충분하면 중복 없이, 같은 카테고리 3연속 없이 판 수만큼 뽑는다', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const rounds of [3, 5, 7, 10]) {
        const seq = drawSet({ rounds, pool: RANDOM_POOL, fixed: [], banned: [], previous: [], rng: createRng(seed) });
        expect(seq).toHaveLength(rounds);
        expect(new Set(seq).size).toBe(rounds);
        check(seq);
      }
    }
  });

  it('확정 게임은 모두 들어가고 밴 게임은 안 나온다', () => {
    const fixed = ['G13', 'G27', 'G50'];
    const banned = ['G01', 'G22', 'G19', 'G03', 'G04', 'G12'];
    for (let seed = 1; seed <= 300; seed++) {
      const seq = drawSet({ rounds: 5, pool: RANDOM_POOL, fixed, banned, previous: [], rng: createRng(seed) });
      for (const f of fixed) expect(seq).toContain(f);
      for (const b of banned) expect(seq).not.toContain(b);
      check(seq);
    }
  });

  it('확정 게임이 판 수와 같으면 확정 게임만, 순서는 섞인다', () => {
    const fixed = ['G13', 'G27', 'G50'];
    const orders = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      const seq = drawSet({ rounds: 3, pool: RANDOM_POOL, fixed, banned: [], previous: [], rng: createRng(seed) });
      expect([...seq].sort()).toEqual(fixed);
      orders.add(seq.join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('직전 세트에 나온 게임은 덜 뽑힌다', () => {
    const previous = RANDOM_POOL.slice(0, 7).map((g) => g.code);
    let prevHits = 0;
    let otherHits = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const seq = drawSet({ rounds: 7, pool: RANDOM_POOL, fixed: [], banned: [], previous, rng: createRng(seed) });
      for (const c of seq) (previous.includes(c) ? prevHits++ : otherHits++);
    }
    const prevRate = prevHits / previous.length;
    const otherRate = otherHits / (RANDOM_POOL.length - previous.length);
    expect(prevRate).toBeLessThan(otherRate * 0.6);
  });

  it('게임이 3종뿐이면 7판: 처음 3판은 모두 다르고, 그 뒤로는 연달아 같은 게임이 없다', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const seq = drawSet({ rounds: 7, pool: THREE, fixed: [], banned: [], previous: [], rng: createRng(seed) });
      expect(seq).toHaveLength(7);
      expect(new Set(seq.slice(0, 3)).size).toBe(3);
      check(seq);
    }
  });

  it('3종 중 둘을 밴하면 남은 하나로만 채운다', () => {
    const seq = drawSet({ rounds: 5, pool: THREE, fixed: [], banned: ['G01', 'G22'], previous: [], rng: createRng(1) });
    expect(seq).toEqual(['G19', 'G19', 'G19', 'G19', 'G19']);
  });

  it('모두 밴하면 빈 목록', () => {
    expect(drawSet({ rounds: 3, pool: THREE, fixed: [], banned: ['G01', 'G19', 'G22'], previous: [], rng: createRng(1) })).toEqual([]);
  });

  it('밴과 확정이 겹치면 밴이 우선', () => {
    const seq = drawSet({ rounds: 3, pool: THREE, fixed: ['G01'], banned: ['G01'], previous: [], rng: createRng(1) });
    expect(seq).not.toContain('G01');
  });

  it('같은 시드면 같은 결과', () => {
    const a = drawSet({ rounds: 7, pool: RANDOM_POOL, fixed: [], banned: [], previous: [], rng: createRng(42) });
    const b = drawSet({ rounds: 7, pool: RANDOM_POOL, fixed: [], banned: [], previous: [], rng: createRng(42) });
    expect(a).toEqual(b);
  });
});

describe('tournamentPool', () => {
  it('완성된 게임 중 랜덤 후보만, 권한 거부한 게임은 뺀다', () => {
    const all = tournamentPool([]).map((g) => g.code);
    expect(all).toEqual(READY_GAMES.filter((c) => gameInfo(c).random7 && !gameInfo(c).partyOnly));
    expect(all).toContain('G19');
    expect(tournamentPool(['G19']).map((g) => g.code)).toEqual(all.filter((c) => c !== 'G19'));
  });
});

// 타입 확인용: GameInfo의 필드가 세부표와 맞는지
const sample: GameInfo = gameInfo('G01');
void sample;
