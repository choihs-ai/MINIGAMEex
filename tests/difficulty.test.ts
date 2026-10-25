import { describe, expect, it } from 'vitest';
import { STEP } from '../src/core/loop';
import type { Seat } from '../src/input/seats';
import { ARENA_MIN, ARENA_R, G01, SHRINK_END, type SpinningTopBattle } from '../src/minigames/G01';
import { CRASH_PENALTY, G08, type TwinShip } from '../src/minigames/G08';
import { G11, type MoleGrab } from '../src/minigames/G11';
import { G27, type TankBattle } from '../src/minigames/G27';
import { G19, type QuickDraw } from '../src/minigames/G19';
import { G53, type FishingDuel } from '../src/minigames/G53';
import { BASE_X, BASE_Y, G57, type ZombieDefense } from '../src/minigames/G57';
import { harness, type Harness } from './helpers';

const tap = (h: Harness, seat: Seat) => {
  h.controls.get(seat)!.press();
  h.step();
  h.controls.get(seat)!.release();
};

describe('끝까지 버티기 어렵게(승부가 나게)', () => {
  it('G01: 경기장이 시간이 지나면 줄어든다', () => {
    const top = harness<SpinningTopBattle>(G01, [0, 1]).game;
    expect(top.arenaR(0)).toBe(ARENA_R);
    expect(top.arenaR(SHRINK_END)).toBe(ARENA_MIN);
  });

  it('G08: 운석에 부딪힌 배는 멈추고 팀 점수가 깎인다', () => {
    const h = harness<TwinShip>(G08, [0, 1, 2, 3]);
    const team = h.game.teams[0];
    team.score = 5;
    h.game.rocks = [{ id: 1, x: team.x, y: team.y, vx: 0, vy: 0, r: 5, hp: 1, points: 1, ufo: false, hitAt: -1 }];
    h.step();
    expect(team.score).toBe(5 - CRASH_PENALTY);
    expect(h.game.stunned(team)).toBe(true);
  });

  it('G57: 자기 쪽이 뚫린 사람은 처치 수와 상관없이 꼴찌', () => {
    const h = harness<ZombieDefense>(G57, [0, 1]);
    h.game.kills.set(0, 9);
    h.game.kills.set(1, 2);
    h.game.zombies = [{ id: 1, lane: 0, x: BASE_X, y: BASE_Y + 16, hp: 1, big: false, speed: 30, hitAt: -1 }];
    h.step(30);
    expect(h.game.isFinished()).toBe(true);
    expect(h.game.getRanking()).toEqual([[1], [0]]);
  });
});

describe('가만히 있으면 손해', () => {
  it('G27: 끝까지 살아남은 사람끼리는 많이 맞힌 순', () => {
    const h = harness<TankBattle>(G27, [0, 1]);
    const [a, b] = h.game.tanks;
    a.hits = 0;
    a.hp = 3;
    b.hits = 2;
    b.hp = 1;
    expect(h.game.getRanking()).toEqual([[b.seat], [a.seat]]);
  });
});

describe('속임수', () => {
  it('G19: 신호처럼 번쩍여도 느낌표가 없을 때 누르면 실격(연습 라운드 뒤)', () => {
    const h = harness<QuickDraw>(G19, [0, 1]);
    h.game.round = 1;
    h.game.fakeAt = 0.2;
    h.game.phaseT = 0;
    h.game.waitTime = 3;
    while (!h.game.faking()) h.step();
    tap(h, 0);
    expect(h.game.fouled.has(0)).toBe(true);
  });

  it('G11: 고개만 내민 두더지를 치면 헛방', () => {
    const h = harness<MoleGrab>(G11, [0, 1]);
    h.game.phase = 'empty';
    h.game.phaseT = 0;
    h.game.emptyTime = 2;
    h.game.peekAt = 0.1;
    while (!h.game.peeking()) h.step();
    tap(h, 0);
    expect(h.game.locked(0)).toBe(true);
    expect(h.game.scores.get(0)).toBe(0);
  });

  it('G53: 속임 입질에 낚아채면 고기가 놀라 도망간다', () => {
    const h = harness<FishingDuel>(G53, [0, 1]);
    const a = h.game.anglers[0];
    a.timer = 2;
    a.nibble = 1.9;
    h.step(Math.ceil(0.15 / STEP));
    expect(h.game.nibbling(a)).toBe(true);
    tap(h, a.seat);
    expect(a.state).toBe('scared');
  });
});
