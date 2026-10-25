import { describe, expect, it } from 'vitest';
import { STEP as TICK } from '../src/core/loop';
import type { Seat } from '../src/input/seats';
import { crossed, G30, GRACE as HOP_GRACE, wrapAngle, type LaserHop } from '../src/minigames/G30';
import { G50, type BeatStack } from '../src/minigames/G50';
import { CUE, G51, LISTEN, STEP as DRUM_STEP, type DrumBattle } from '../src/minigames/G51';
import { G52, TARGET, TIMEOUT, type StopClock } from '../src/minigames/G52';
import { G53, tapsNeeded, type FishingDuel } from '../src/minigames/G53';
import { harness, type Harness } from './helpers';

/** 한 틱 동안 누르고 바로 뗀다 */
function tap(h: Harness, seat: Seat): void {
  h.controls.get(seat)!.press();
  h.step();
  h.controls.get(seat)!.release();
}

function stepUntil(h: Harness, cond: () => boolean, maxSeconds = 60): void {
  for (let i = 0; i < maxSeconds / TICK && !cond(); i++) h.step();
}

describe('G30 회전판 점프', () => {
  it('각도 도우미', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(crossed(-0.1, 0.1, 0)).toBe(true);
    expect(crossed(0.1, 0.2, 0)).toBe(false);
    expect(crossed(Math.PI - 0.05, -Math.PI + 0.05, Math.PI)).toBe(true);
  });

  it('레이저가 올 때 뛰는 사람은 살고, 가만히 있는 사람은 유예 뒤 탈락', () => {
    const h = harness<LaserHop>(G30, [0, 1]);
    stepUntil(h, () => h.game.t >= HOP_GRACE, 5);
    const jumper = h.game.hoppers.find((x) => x.seat === 0)!;
    for (let i = 0; i < 10 / TICK && h.game.hoppers.find((x) => x.seat === 1)!.outAt === null; i++) {
      if (h.game.timeToReach(jumper.angle) < 0.2 && h.game.canPress(0)) {
        h.controls.get(0)!.press();
        h.step();
        h.controls.get(0)!.release();
      } else h.step();
    }
    expect(h.game.hoppers.find((x) => x.seat === 1)!.outAt).not.toBeNull();
    expect(jumper.outAt).toBeNull();
  });
});

describe('G50 박자 쌓기', () => {
  it('딱 맞추면 그대로, 어긋나면 잘리고, 완전히 빗나가면 끝', () => {
    const h = harness<BeatStack>(G50, [0, 1]);
    const st = h.game.stacks[0];
    const base = st.slabs[0];
    st.moving = { x: base.x, w: 30, dir: 1 };
    tap(h, 0);
    expect(st.slabs[1]).toEqual({ x: base.x, w: 30 });

    stepUntil(h, () => st.state === 'move', 1);
    st.moving = { x: st.slabs[1].x + 6, w: 30, dir: 1 };
    tap(h, 0);
    // 누른 틱에도 판이 조금(1px 안쪽) 더 움직인 뒤 멈춘다
    expect(st.slabs[2].w).toBeGreaterThan(22);
    expect(st.slabs[2].w).toBeLessThan(24.5);

    stepUntil(h, () => st.state === 'move', 1);
    st.moving = { x: st.slabs[2].x + 40, w: 24, dir: 1 };
    tap(h, 0);
    expect(st.state).toBe('over');
    expect(h.game.height(st)).toBe(2);
  });

  it('높이 순', () => {
    const h = harness<BeatStack>(G50, [0, 1, 2]);
    h.game.stacks[1].slabs.push({ x: 0, w: 10 }, { x: 0, w: 10 });
    h.game.stacks[2].slabs.push({ x: 0, w: 10 });
    expect(h.game.getRanking()).toEqual([[1], [2], [0]]);
  });
});

describe('G51 드럼 배틀', () => {
  it('리듬에 맞춰 치면 맞힘, 엉뚱한 때 치면 헛침', () => {
    const h = harness<DrumBattle>(G51, [0, 1]);
    const pattern = h.game.pattern;
    stepUntil(h, () => h.game.roundT >= LISTEN + CUE, 5);
    for (const s of pattern) {
      stepUntil(h, () => h.game.playT >= s * DRUM_STEP - TICK / 2, 3);
      tap(h, 0);
    }
    const d0 = h.game.drummers.find((d) => d.seat === 0)!;
    expect(d0.hits).toBe(pattern.length);
    expect(d0.extras).toBe(0);
    // 1번은 박자가 없는 칸에 친다
    const h2 = harness<DrumBattle>(G51, [0, 1]);
    const empty = [1, 2, 3, 4, 5, 6, 7].find((s) => !h2.game.pattern.includes(s))!;
    stepUntil(h2, () => h2.game.playT >= empty * DRUM_STEP - TICK / 2, 5);
    tap(h2, 1);
    expect(h2.game.drummers.find((d) => d.seat === 1)!.extras).toBe(1);
  });

  it('듣는 동안 누른 것은 점수에 안 들어간다', () => {
    const h = harness<DrumBattle>(G51, [0, 1]);
    tap(h, 0);
    const d = h.game.drummers.find((x) => x.seat === 0)!;
    expect(d.hits + d.extras).toBe(0);
  });
});

describe('G52 멈춰 시계', () => {
  it('10초에 멈추면 오차 0에 가깝고, 안 누르면 4초 오차, 오차 작은 순', () => {
    const h = harness<StopClock>(G52, [0, 1, 2]);
    stepUntil(h, () => h.game.phaseT >= TARGET - TICK / 2, 12);
    tap(h, 0);
    stepUntil(h, () => h.game.phaseT >= TARGET + 0.5, 3);
    tap(h, 1);
    stepUntil(h, () => h.game.phase === 'reveal', TIMEOUT);
    expect(h.game.lastError(0)).toBeLessThan(0.03);
    expect(h.game.lastError(1)).toBeCloseTo(0.5, 1);
    expect(h.game.lastError(2)).toBeCloseTo(TIMEOUT - TARGET, 5);
    expect(h.game.getRanking()).toEqual([[0], [1], [2]]);
  });

  it('모두 누르면 바로 공개로 넘어간다', () => {
    const h = harness<StopClock>(G52, [0, 1]);
    tap(h, 0);
    expect(h.game.phase).toBe('run');
    tap(h, 1);
    expect(h.game.phase).toBe('reveal');
  });
});

describe('G53 낚시 대결', () => {
  it('입질 전에 누르면 고기가 놀라 도망간다', () => {
    const h = harness<FishingDuel>(G53, [0, 1]);
    tap(h, 0);
    expect(h.game.anglers[0].state).toBe('scared');
  });

  it('입질에 누르면 작은 고기는 바로, 큰 고기는 연타로 잡는다', () => {
    const h = harness<FishingDuel>(G53, [0, 1]);
    const a = h.game.anglers[0];
    a.state = 'bite';
    a.timer = 0.5;
    a.fish = { weight: 2, big: false };
    tap(h, 0);
    expect(a.total).toBe(2);

    a.state = 'bite';
    a.timer = 0.5;
    a.fish = { weight: 5, big: true };
    tap(h, 0);
    expect(a.state).toBe('reel');
    for (let i = 0; i < tapsNeeded(a.fish!); i++) {
      tap(h, 0);
      h.step();
    }
    expect(a.total).toBe(7);
  });

  it('입질을 놓치면 고기가 도망간다', () => {
    const h = harness<FishingDuel>(G53, [0, 1]);
    const a = h.game.anglers[0];
    a.state = 'bite';
    a.timer = 0.05;
    a.fish = { weight: 2, big: false };
    h.step(5);
    expect(a.state).toBe('escape');
    expect(a.total).toBe(0);
  });
});
