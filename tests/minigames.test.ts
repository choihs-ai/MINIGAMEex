import { describe, expect, it } from 'vitest';
import { STEP } from '../src/core/loop';
import { BTN_LEFT, BTN_RIGHT } from '../src/input/controls';
import type { Seat } from '../src/input/seats';
import { ARENA_R, ARENA_X, ARENA_Y, DURATION as G01_DURATION, G01, SAFE_TIME, type SpinningTopBattle } from '../src/minigames/G01';
import { G19, ROUNDS, type QuickDraw } from '../src/minigames/G19';
import { BASKET_SPEED, CATCH_Y_BOTTOM, DURATION as G22_DURATION, G22, type StarCatch } from '../src/minigames/G22';
import { GAMES, READY_GAMES } from '../src/minigames/registry';
import { expectPartition, harness, runToEnd } from './helpers';

const SETUPS: Array<{ name: string; joined: Seat[] }> = [
  { name: '1인(+AI 3)', joined: [0] },
  { name: '2인', joined: [3, 1] },
  { name: '3인', joined: [0, 2, 3] },
  { name: '4인', joined: [0, 1, 2, 3] },
];

describe.each(READY_GAMES)('%s: 1·2·3·4인을 AI끼리 끝까지 돌린다', (code) => {
  it.each(SETUPS)('$name', ({ joined }) => {
    for (const seed of [1, 2, 3]) {
      const h = harness(GAMES[code], joined, { seed, withAI: true });
      const t = runToEnd(h);
      expect(h.game.isFinished()).toBe(true);
      expect(t).toBeLessThan(200);
      expect(expectPartition(h.game.getRanking(), h.players)).toBe(true);
    }
  });
});

describe('G01 팽이 난투', () => {
  const pushOut = (h: { game: SpinningTopBattle }, seat: Seat) => {
    const top = h.game.tops.find((t) => t.seat === seat)!;
    top.x = ARENA_X + ARENA_R + 5;
    top.y = ARENA_Y;
  };

  it('보호 시간에는 가장자리 밖으로 나가도 떨어지지 않는다', () => {
    const h = harness<SpinningTopBattle>(G01, [0, 1, 2]);
    pushOut(h, 0);
    h.step();
    expect(h.game.tops.find((t) => t.seat === 0)!.alive).toBe(true);
  });

  it('탈락 역순으로 순위를 매기고, 한 명 남으면 끝난다', () => {
    const h = harness<SpinningTopBattle>(G01, [0, 1, 2]);
    h.step(Math.ceil(SAFE_TIME / STEP) + 1);
    pushOut(h, 2);
    h.step();
    h.step(10);
    pushOut(h, 0);
    h.step();
    expect(h.game.isFinished()).toBe(true);
    expect(h.game.getRanking()).toEqual([[1], [0], [2]]);
  });

  it('시간이 다 되면 살아남은 사람은 공동 1위', () => {
    const h = harness<SpinningTopBattle>(G01, [0, 1, 2, 3]);
    h.step(Math.ceil(SAFE_TIME / STEP) + 1);
    pushOut(h, 3);
    h.step();
    // 나머지는 서로 안 부딪히게 가운데 근처에 묶어 둔다
    for (let i = 0; i < Math.ceil(G01_DURATION / STEP); i++) {
      for (const [k, top] of h.game.tops.filter((t) => t.alive).entries()) {
        top.x = ARENA_X - 30 + k * 30;
        top.y = ARENA_Y;
      }
      h.step();
      if (h.game.isFinished()) break;
    }
    expect(h.game.getRanking()).toEqual([[0, 1, 2], [3]]);
  });

  it('누르는 순간 휘는 방향이 바뀌고, 계속 누르면 돌진한다', () => {
    const h = harness<SpinningTopBattle>(G01, [0, 1]);
    const top = h.game.tops.find((t) => t.seat === 0)!;
    const before = top.turn;
    h.controls.get(0)!.press();
    h.step();
    expect(top.turn).toBe(-before);
    expect(top.dashing).toBe(false);
    h.step(15);
    expect(top.dashing).toBe(true);
  });
});

describe('G19 칼 뽑기 결투', () => {
  const untilPhase = (h: { game: QuickDraw; step(): void }, phase: string) => {
    for (let i = 0; i < 600 && h.game.phase !== phase; i++) h.step();
  };

  it('신호 뒤 가장 먼저 누른 사람이 1점', () => {
    const h = harness<QuickDraw>(G19, [0, 1, 2]);
    untilPhase(h, 'signal');
    h.controls.get(1)!.press();
    h.step();
    h.controls.get(1)!.release();
    h.controls.get(0)!.press();
    h.step();
    expect(h.game.wins.get(1)).toBe(1);
    expect(h.game.wins.get(0)).toBe(0);
  });

  it('같은 틱에 누르면 공동 승리', () => {
    const h = harness<QuickDraw>(G19, [0, 1]);
    untilPhase(h, 'signal');
    h.controls.get(0)!.press();
    h.controls.get(1)!.press();
    h.step();
    expect([h.game.wins.get(0), h.game.wins.get(1)]).toEqual([1, 1]);
  });

  it('1라운드는 너무 빨리 눌러도 경고만, 2라운드부터는 실격', () => {
    const h = harness<QuickDraw>(G19, [0, 1]);
    h.controls.get(0)!.press();
    h.step();
    h.controls.get(0)!.release();
    expect(h.game.fouled.has(0)).toBe(false);
    untilPhase(h, 'signal');
    h.controls.get(0)!.press();
    h.step();
    h.controls.get(0)!.release();
    expect(h.game.wins.get(0)).toBe(1);

    untilPhase(h, 'wait');
    expect(h.game.round).toBe(1);
    h.controls.get(0)!.press();
    h.step();
    h.controls.get(0)!.release();
    expect(h.game.fouled.has(0)).toBe(true);
    untilPhase(h, 'signal');
    h.controls.get(0)!.press();
    h.step();
    expect(h.game.wins.get(0)).toBe(1);
  });

  it('5라운드 뒤 이긴 라운드 순, 동점은 평균 반응 시간이 빠른 쪽', () => {
    const h = harness<QuickDraw>(G19, [0, 1, 2]);
    // 0번이 3라운드, 1번이 2라운드를 이기고 2번은 아무것도 안 누른다
    for (let round = 0; round < ROUNDS; round++) {
      untilPhase(h, 'signal');
      const seat: Seat = round < 3 ? 0 : 1;
      h.controls.get(seat)!.press();
      h.step();
      h.controls.get(seat)!.release();
      untilPhase(h, 'wait');
    }
    for (let i = 0; i < 200 && !h.game.isFinished(); i++) h.step();
    expect(h.game.isFinished()).toBe(true);
    expect(h.game.getRanking()).toEqual([[0], [1], [2]]);
    expect(h.game.getScores()).toEqual({ 0: 3, 1: 2, 2: 0 });
  });
});

describe('G22 별 받기', () => {
  it('2인: 1P 바구니는 아래, 2P는 위', () => {
    const h = harness<StarCatch>(G22, [0, 1]);
    expect(h.game.baskets.map((b) => [b.seat, b.side])).toEqual([[0, 'bottom'], [1, 'top']]);
  });

  it('1인(+AI)은 모두 아래쪽에 1P~4P 순서로 놓인다', () => {
    const h = harness<StarCatch>(G22, [0]);
    expect(h.game.baskets.map((b) => b.side)).toEqual(['bottom', 'bottom', 'bottom', 'bottom']);
    const xs = h.game.baskets.slice().sort((a, b) => a.seat - b.seat).map((b) => b.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('위쪽 사람이 자기 오른쪽을 누르면 화면에서는 왼쪽으로 간다', () => {
    const h = harness<StarCatch>(G22, [0, 1]);
    const top = h.game.baskets.find((b) => b.seat === 1)!;
    const x0 = top.x;
    h.controls.get(1)!.press(BTN_RIGHT);
    h.step(30);
    expect(top.x).toBeCloseTo(x0 - BASKET_SPEED * 30 * STEP, 0);
    const bottom = h.game.baskets.find((b) => b.seat === 0)!;
    const b0 = bottom.x;
    h.controls.get(0)!.press(BTN_LEFT);
    h.step(30);
    expect(bottom.x).toBeLessThan(b0);
  });

  it('바구니 위로 떨어진 별을 받고, 옆 사람 쪽 별도 가로챌 수 있다', () => {
    const h = harness<StarCatch>(G22, [2, 3, 0, 1]);
    const yellow = h.game.baskets.find((b) => b.seat === 2)!;
    const green = h.game.baskets.find((b) => b.seat === 3)!;
    h.game.stars = [{ x: green.x, y: CATCH_Y_BOTTOM - 0.5, side: 'bottom', dir: 1 }];
    yellow.x = green.x - 4; // 노랑이 초록 바구니 쪽으로 넘어와 더 가깝다
    green.x += 6;
    h.step();
    expect(yellow.count).toBe(1);
    expect(green.count).toBe(0);
  });

  it('45초가 지나면 끝나고 받은 개수 순위', () => {
    const h = harness<StarCatch>(G22, [0, 1, 2]);
    h.step(Math.ceil(G22_DURATION / STEP) + 1);
    expect(h.game.isFinished()).toBe(true);
    h.game.baskets.forEach((b, i) => (b.count = [5, 9, 5][i]));
    const bySeat = Object.fromEntries(h.game.baskets.map((b) => [b.seat, b.count]));
    const ranking = h.game.getRanking();
    expect(ranking.map((g) => bySeat[g[0]])).toEqual([9, 5]);
    expect(ranking[1]).toHaveLength(2);
  });
});
