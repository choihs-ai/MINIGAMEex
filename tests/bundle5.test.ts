import { describe, expect, it } from 'vitest';
import { STEP } from '../src/core/loop';
import type { Seat } from '../src/input/seats';
import { G29, type KartRace } from '../src/minigames/G29';
import { G04, STUN, type PaintLand } from '../src/minigames/G04';
import { G62, type BumperCars } from '../src/minigames/G62';
import { CX, CY, G63, type ChickenFight } from '../src/minigames/G63';
import { G64, GUARD, type CrownSteal } from '../src/minigames/G64';
import { G65, soccerTeams, type MiniSoccer } from '../src/minigames/G65';
import { G66, START_TAIL, type TailTag } from '../src/minigames/G66';
import { G67, type MusicalChairs } from '../src/minigames/G67';
import { G68, PASS_GUARD, type HotPotato } from '../src/minigames/G68';
import { atLeast, DOUBT, G69, OK, PLUS, type BluffDice } from '../src/minigames/G69';
import { HIDDEN_GAMES, READY_GAMES } from '../src/minigames/registry';
import { harness, type Harness } from './helpers';

const tap = (h: Harness, seat: Seat, b = 0) => {
  h.controls.get(seat)!.press(b);
  h.step();
  h.controls.get(seat)!.release(b);
  h.step();
};
const secs = (s: number) => Math.ceil(s / STEP);

describe('메뉴 정리', () => {
  it('숨긴 게임은 메뉴·토너먼트에 안 나온다(G19는 서든데스용으로 코드만 남김)', () => {
    for (const c of HIDDEN_GAMES) expect(READY_GAMES).not.toContain(c);
    expect(READY_GAMES).toContain('G01');
    expect(READY_GAMES).toContain('G69');
    expect(READY_GAMES).toHaveLength(23);
  });
});

describe('부딪히기 추가', () => {
  it('G29: 옆구리를 들이받힌 카트는 옆으로 튕겨 나간다', () => {
    const h = harness<KartRace>(G29, [0, 1]);
    const [a, b] = h.game.karts;
    Object.assign(a, { x: 100, y: 150, heading: 0, speed: 80 });
    Object.assign(b, { x: 108, y: 150, heading: -Math.PI / 2, speed: 10 });
    h.step();
    expect(b.kx).toBeGreaterThan(20);
    expect(Math.abs(a.kx)).toBeLessThan(b.kx);
  });

  it('G04: 달려든 사람이 이기고, 받힌 사람은 잠깐 못 칠한다', () => {
    const h = harness<PaintLand>(G04, [0, 1]);
    const [a, b] = h.game.painters;
    Object.assign(a, { x: 100, y: 90 });
    Object.assign(b, { x: 108, y: 90 });
    // a만 오른쪽으로 끌기
    const c = h.controls.get(a.seat)!;
    c.pointerDown(100, 90, 1);
    c.pointerMove(130, 90, 1);
    h.step(2);
    expect(b.stun).toBeGreaterThan(STUN * 0.8);
    expect(a.stun).toBe(0);
  });
});

describe('G62 범퍼카', () => {
  it('무너진 칸 위에 서면 탈락', () => {
    const h = harness<BumperCars>(G62, [0, 1, 2]);
    const car = h.game.cars[0];
    car.x = 70;
    car.y = 30;
    h.game.tiles[0] = -1;
    h.step();
    expect(car.alive).toBe(false);
    const ranking = h.game.getRanking();
    expect(ranking[ranking.length - 1]).toEqual([car.seat]);
  });
});

describe('G63 닭싸움', () => {
  it('뛰어든 닭이 서 있는 닭만 크게 밀어낸다', () => {
    const h = harness<ChickenFight>(G63, [0, 1]);
    const [a, b] = h.game.chickens;
    Object.assign(a, { x: CX - 13, y: CY, vx: 200, vy: 0, air: 0.2 });
    Object.assign(b, { x: CX, y: CY, vx: 0, vy: 0, air: 0 });
    h.step();
    expect(b.vx).toBeGreaterThan(100);
    expect(Math.abs(a.vx)).toBeLessThan(40);
  });

  it('공중에선 판 밖이어도 안 떨어지고, 내려앉으면 떨어진다', () => {
    const h = harness<ChickenFight>(G63, [0, 1]);
    const c = h.game.chickens[0];
    Object.assign(c, { x: CX + 200, y: CY, vx: 0, vy: 0, air: 0.1 });
    h.step();
    expect(c.alive).toBe(true);
    h.step(secs(0.2));
    expect(c.alive).toBe(false);
  });
});

describe('G64 왕관 뺏기', () => {
  it('왕관 쓴 사람에게 부딪히면 빼앗고, 잠깐은 다시 못 뺏긴다', () => {
    const h = harness<CrownSteal>(G64, [0, 1]);
    const [a, b] = h.game.movers;
    h.game.holder = a.seat;
    h.game.guardUntil = 0;
    Object.assign(a, { x: 150, y: 96, vx: 0, vy: 0 });
    Object.assign(b, { x: 136, y: 96, vx: 80, vy: 0 });
    h.step();
    expect(h.game.holder).toBe(b.seat);
    expect(h.game.guardUntil).toBeCloseTo(h.game.t + GUARD, 1);
  });
});

describe('G65 미니 축구', () => {
  it('팀: 4인은 1P·3P 대 2P·4P, 3인은 1:2, 2인은 1:1', () => {
    expect(soccerTeams([0, 1, 2, 3])).toEqual([[0, 2], [1, 3]]);
    expect(soccerTeams([0, 2, 3])).toEqual([[0, 2], [3]]);
    expect(soccerTeams([3, 1])).toEqual([[1], [3]]);
  });

  it('공이 오른쪽 골에 들어가면 왼쪽 팀 득점, 같은 팀은 같은 순위', () => {
    const h = harness<MiniSoccer>(G65, [0, 1, 2, 3]);
    h.step(secs(1.5));
    Object.assign(h.game.ball, { x: 296, y: 97, vx: 200, vy: 0 });
    h.step(3);
    expect(h.game.teams[0].goals).toBe(1);
    expect(h.game.getRanking()).toEqual([[0, 2], [1, 3]]);
  });
});

describe('G66 꼬리 뺏기', () => {
  it('남의 꼬리를 머리로 박으면 한 마디를 빼앗는다', () => {
    const h = harness<TailTag>(G66, [0, 1]);
    const [a, b] = h.game.snakes;
    const seg = h.game.segment(b, 1);
    // a를 순간이동시키면 a의 꼬리 길도 b 머리를 지나가므로, b는 이번엔 못 뺏게
    b.grabAt = 99;
    a.x = seg.x;
    a.y = seg.y;
    h.step();
    expect(a.tail).toBe(START_TAIL + 1);
    expect(b.tail).toBe(START_TAIL - 1);
  });
});

describe('G67 의자 뺏기', () => {
  it('의자는 사람보다 하나 적고, 못 앉은 사람이 탈락', () => {
    const h = harness<MusicalChairs>(G67, [0, 1, 2]);
    expect(h.game.chairs).toHaveLength(2);
    h.game.musicLen = 0;
    h.step();
    expect(h.game.phase).toBe('grab');
    const [a, b, c] = h.game.movers;
    for (const [m, ch] of [[a, h.game.chairs[0]], [b, h.game.chairs[1]]] as const) {
      m.x = ch.x;
      m.y = ch.y;
    }
    c.x = 20;
    c.y = 96;
    h.step(2);
    expect(c.alive).toBe(false);
    expect(a.alive && b.alive).toBe(true);
  });
});

describe('G68 뜨거운 감자', () => {
  it('폭탄 든 사람이 부딪히면 넘어가고, 터지면 든 사람 탈락', () => {
    const h = harness<HotPotato>(G68, [0, 1, 2]);
    const [a, b] = h.game.movers;
    h.game.carrier = a.seat;
    h.game.passAt = -9;
    Object.assign(a, { x: 150, y: 95, vx: 80, vy: 0 });
    Object.assign(b, { x: 164, y: 95, vx: 0, vy: 0 });
    h.step();
    expect(h.game.carrier).toBe(b.seat);
    // 받자마자 되돌려 줄 수 없다
    h.step(secs(PASS_GUARD * 0.5));
    h.game.boomAt = h.game.t;
    h.step();
    expect(b.alive).toBe(false);
  });
});

describe('G69 블러핑 주사위', () => {
  it('확률표', () => {
    expect(atLeast(2)).toBe(1);
    expect(atLeast(12)).toBeCloseTo(1 / 36);
    expect(atLeast(7)).toBeCloseTo(21 / 36);
  });

  it('의심했는데 진짜면 의심한 사람이, 거짓말이면 선언한 사람이 목숨을 잃는다', () => {
    for (const honest of [true, false]) {
      const h = harness<BluffDice>(G69, [0, 1]);
      const roller = h.game.roller;
      h.game.dice = honest ? [6, 6] : [1, 1];
      tap(h, roller, PLUS);
      tap(h, roller, OK);
      expect(h.game.phase).toBe('respond');
      const doubter = h.game.current!;
      tap(h, doubter, DOUBT);
      expect(h.game.loser).toBe(honest ? doubter : roller);
    }
  });

  it('믿으면 그 사람이 굴리고, 앞사람보다 크게 선언해야 한다', () => {
    const h = harness<BluffDice>(G69, [0, 1]);
    const roller = h.game.roller;
    tap(h, roller, OK);
    const claim = h.game.claim;
    const next = h.game.current!;
    tap(h, next, OK);
    expect(h.game.roller).toBe(next);
    expect(h.game.claim).toBe(claim + 1);
  });

  it('시간 안에 못 고르면 목숨 -1', () => {
    const h = harness<BluffDice>(G69, [0, 1]);
    const roller = h.game.roller;
    h.step(secs(10.1));
    expect(h.game.loser).toBe(roller);
    expect(h.game.timedOut).toBe(true);
  });
});
