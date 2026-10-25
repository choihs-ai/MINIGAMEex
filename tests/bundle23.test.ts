import { describe, expect, it } from 'vitest';
import { STEP } from '../src/core/loop';
import { BTN_DOWN, BTN_LEFT, BTN_RIGHT, BTN_UP } from '../src/input/controls';
import type { Seat } from '../src/input/seats';
import { G03, HIT_HALF_W, type BombDodge } from '../src/minigames/G03';
import { G08, roleOf, teamSeats, type TwinShip } from '../src/minigames/G08';
import { G09, type SignalTap } from '../src/minigames/G09';
import { G11, LOCKOUT, type MoleGrab } from '../src/minigames/G11';
import { G13, RELEASE_GAP, type SumoPush } from '../src/minigames/G13';
import { beats, G20, PAPER, ROCK, SCISSORS, type RpsSpeed } from '../src/minigames/G20';
import { G21, type ColorTrap } from '../src/minigames/G21';
import { G23, type BalloonPop } from '../src/minigames/G23';
import { G24, type Marbles } from '../src/minigames/G24';
import { G25, HOG_X, HOUSE_X, HOUSE_Y, type IceCurling } from '../src/minigames/G25';
import { COLS, G26, type SnakeTail } from '../src/minigames/G26';
import { advanceShell, G27, HP, type TankBattle } from '../src/minigames/G27';
import { G29, LAPS, type KartRace } from '../src/minigames/G29';
import { G54, WRONG_LOCK, type ConvenienceStore } from '../src/minigames/G54';
import { BASE_X, BASE_Y, G57, type ZombieDefense } from '../src/minigames/G57';
import { controlLayout } from '../src/minigames/types';
import { ScrollGrid } from '../src/ui/gameGrid';
import { harness, type Harness } from './helpers';

const tap = (h: Harness, seat: Seat, button = 0) => {
  h.controls.get(seat)!.press(button);
  h.step();
  h.controls.get(seat)!.release(button);
};
const touch = (h: Harness, seat: Seat, x: number, y: number) => {
  h.controls.get(seat)!.pointerDown(x, y);
  h.controls.get(seat)!.pointerUp();
  h.step();
};
const seconds = (s: number) => Math.ceil(s / STEP);

describe('G09 눈치 탭', () => {
  it('빨간불에 누르면 -1이고 그 라운드는 더 못 누른다, 초록불에 먼저 누르면 +1', () => {
    const h = harness<SignalTap>(G09, [0, 1]);
    tap(h, 0);
    expect(h.game.scores.get(0)).toBe(-1);
    expect(h.game.fouled.has(0)).toBe(true);
    while (h.game.light !== 'green') h.step();
    tap(h, 0);
    expect(h.game.scores.get(0)).toBe(-1);
    tap(h, 1);
    expect(h.game.scores.get(1)).toBe(1);
    expect(h.game.light).toBe('off');
  });
});

describe('G11 두더지', () => {
  it('빈 구멍을 치면 잠깐 못 치고, 황금은 +3·폭탄은 -2', () => {
    const h = harness<MoleGrab>(G11, [0, 1]);
    tap(h, 0);
    expect(h.game.locked(0)).toBe(true);
    h.step(seconds(LOCKOUT) + 1);
    expect(h.game.locked(0)).toBe(false);
    while (h.game.phase !== 'up') h.step();
    h.game.kind = 'gold';
    tap(h, 1);
    expect(h.game.scores.get(1)).toBe(3);
    while (h.game.phase !== 'up') h.step();
    h.game.kind = 'bomb';
    tap(h, 1);
    expect(h.game.scores.get(1)).toBe(1);
  });
});

describe('G20 가위바위보 / G21 색깔 함정', () => {
  it('가위←바위←보←가위 순으로 이긴다', () => {
    expect([beats(SCISSORS), beats(ROCK), beats(PAPER)]).toEqual([ROCK, PAPER, SCISSORS]);
  });

  it('맞히면 +1, 틀리면 -1이고 그 문제는 더 못 누른다', () => {
    const h = harness<RpsSpeed>(G20, [0, 1, 2]);
    while (h.game.phase !== 'ask') h.step();
    const wrong = (h.game.answer + 1) % 3;
    tap(h, 0, wrong);
    expect(h.game.scores.get(0)).toBe(-1);
    tap(h, 0, h.game.answer);
    expect(h.game.scores.get(0)).toBe(-1);
    tap(h, 2, h.game.answer);
    expect(h.game.scores.get(2)).toBe(1);
    expect(h.game.phase).toBe('reveal');
  });

  it('색깔 함정은 글자 내용이 아니라 글씨 색 버튼이 정답', () => {
    const h = harness<ColorTrap>(G21, [0, 1]);
    while (h.game.phase !== 'ask') h.step();
    tap(h, 1, h.game.answer);
    expect(h.game.scores.get(1)).toBe(1);
  });
});

describe('G23 풍선', () => {
  it('터뜨린 풍선은 그 색 주인 점수', () => {
    const h = harness<BalloonPop>(G23, [0, 1, 2, 3]);
    while (h.game.balloons.length === 0) h.step();
    const b = h.game.balloons[0];
    const other = ([0, 1, 2, 3] as Seat[]).find((s) => s !== b.owner)!;
    const pos = h.game.posOf(b, h.game.t + STEP);
    touch(h, other, pos.x, pos.y);
    expect(h.game.scores.get(b.owner)).toBe(1);
    expect(h.game.scores.get(other)).toBe(0);
  });
});

describe('G54 편의점', () => {
  it('원하는 물건을 먼저 누르면 +1, 엉뚱한 물건은 잠깐 못 누른다', () => {
    const h = harness<ConvenienceStore>(G54, [0, 1]);
    while (h.game.wanted === null) h.step();
    const s0 = h.game.shelves.find((s) => s.seat === 0)!;
    const wrongCell = h.game.cellRect(s0, s0.items.findIndex((it) => it !== h.game.wanted));
    touch(h, 0, wrongCell.x + 5, wrongCell.y + 5);
    expect(h.game.locked(0)).toBe(true);
    h.step(seconds(WRONG_LOCK) + 1);
    const s1 = h.game.shelves.find((s) => s.seat === 1)!;
    const right = h.game.cellRect(s1, s1.items.indexOf(h.game.wanted!));
    touch(h, 1, right.x + 5, right.y + 5);
    expect(h.game.scores.get(1)).toBe(1);
  });
});

describe('G57 좀비 막기', () => {
  it('좀비를 탭하면 처치 수가 오르고, 기지에 닿으면 모두 끝난다', () => {
    const h = harness<ZombieDefense>(G57, [0, 1]);
    while (h.game.zombies.length === 0) h.step();
    const z = h.game.zombies[0];
    z.x = 160;
    z.y = 150;
    z.hp = 1;
    touch(h, 0, z.x, z.y);
    expect(h.game.kills.get(0)).toBe(1);
    h.game.zombies.push({ ...z, id: 99, x: BASE_X, y: BASE_Y + 20, hp: 1 });
    h.step(seconds(2));
    expect(h.game.isFinished()).toBe(true);
    expect(h.game.breachedAt).not.toBeNull();
  });
});

describe('G08 두 명이 한 우주선', () => {
  it('4인: 왼쪽 둘 대 오른쪽 둘, 번호가 앞인 사람이 조종(위/아래), 다른 사람은 사격(원버튼)', () => {
    expect(teamSeats([0, 1, 2, 3])).toEqual([[0, 2], [1, 3]]);
    expect([0, 1, 2, 3].map((s) => roleOf(s as Seat, [0, 1, 2, 3]))).toEqual(['pilot', 'pilot', 'gunner', 'gunner']);
    expect(controlLayout(G08, 0, [0, 1, 2, 3])).toBe('upDown');
    expect(controlLayout(G08, 3, [0, 1, 2, 3])).toBe('one');
  });

  it('3인은 혼자인 팀이 조종만 하고 자동 사격, 2인은 한 배로 협동(순위는 늘 함께)', () => {
    expect(teamSeats([0, 1, 2])).toEqual([[0, 2], [1]]);
    const three = harness<TwinShip>(G08, [0, 1, 2]);
    three.step(seconds(1));
    expect(three.game.bullets.some((b) => b.team.pilot === 1)).toBe(true);
    const two = harness<TwinShip>(G08, [0, 1]);
    expect(two.game.coop).toBe(true);
    expect(two.game.getRanking()).toEqual([[0, 1]]);
  });

  it('조종은 화면 기준 위/아래로 배를 옮기고, 운석을 부수면 팀 점수(둘 다 같은 점수)', () => {
    const h = harness<TwinShip>(G08, [0, 1, 2, 3]);
    const left = h.game.teams[0];
    const y0 = left.y;
    h.controls.get(0)!.press(BTN_UP);
    h.step(10);
    expect(left.y).toBeLessThan(y0);
    h.controls.get(0)!.release(BTN_UP);
    h.controls.get(0)!.press(BTN_DOWN);
    h.step(20);
    expect(left.y).toBeGreaterThan(y0);
    h.game.rocks = [{ id: 99, x: left.x + 30, y: left.y, vx: 0, vy: 0, r: 5, hp: 1, points: 1, ufo: false, hitAt: -1 }];
    tap(h, 2);
    h.step(20);
    expect(left.score).toBe(1);
    expect(h.game.getScores()).toMatchObject({ 0: 1, 2: 1 });
  });
});

describe('G03 폭탄 피하기', () => {
  it('아이템은 먹은 사람 빼고 나머지에게 걸리고, 폭탄에 맞으면 탈락', () => {
    const h = harness<BombDodge>(G03, [0, 1, 2]);
    const [a, b, c] = h.game.dodgers;
    h.game.drops = [{ x: a.x, y: 120, speed: 60, item: 'reverse' }];
    h.step(seconds(0.5));
    expect(h.game.reversed(a)).toBe(false);
    expect(h.game.reversed(b) && h.game.reversed(c)).toBe(true);
    h.game.drops = [{ x: b.x + HIT_HALF_W - 1, y: 120, speed: 80, item: null }];
    h.step(seconds(0.4));
    expect(b.alive).toBe(false);
    expect(a.alive && c.alive).toBe(true);
  });

  it('조작 반전 중에는 좌우가 바뀐다', () => {
    const h = harness<BombDodge>(G03, [0, 2]);
    const d = h.game.dodgers.find((x) => x.seat === 0)!;
    d.reverseUntil = 99;
    const x0 = d.x;
    h.controls.get(0)!.press(BTN_RIGHT);
    h.step(10);
    expect(d.x).toBeLessThan(x0);
  });
});

describe('G13 스모', () => {
  it('연타로 힘을 모으고 멈추면 가장 가까운 상대에게 돌진한다', () => {
    const h = harness<SumoPush>(G13, [0, 1]);
    const me = h.game.wrestlers.find((w) => w.seat === 0)!;
    for (let i = 0; i < 6; i++) {
      tap(h, 0);
      h.step(5);
    }
    expect(me.charge).toBeGreaterThan(0.5);
    h.step(seconds(RELEASE_GAP) + 1);
    expect(me.charge).toBe(0);
    const foe = h.game.wrestlers.find((w) => w.seat === 1)!;
    const toward = (foe.x - me.x) * me.vx + (foe.y - me.y) * me.vy;
    expect(toward).toBeGreaterThan(0);
  });
});

describe('G26 뱀 꼬리 잡기', () => {
  it('좌우 버튼은 뱀 기준으로 꺾고, 벽에 부딪히면 탈락', () => {
    const h = harness<SnakeTail>(G26, [0, 1]);
    const s = h.game.snakes.find((x) => x.seat === 0)!;
    expect(s.dir).toBe(0);
    tap(h, 0, BTN_LEFT);
    h.step(seconds(0.2));
    expect(s.dir).toBe(3);
    tap(h, 0, BTN_RIGHT);
    h.step(seconds(0.2));
    expect(s.dir).toBe(0);
    s.x = COLS - 1;
    s.y = 22;
    h.step(seconds(0.2));
    expect(s.alive).toBe(false);
    expect(h.game.isFinished()).toBe(true);
    expect(h.game.getRanking()).toEqual([[1], [0]]);
  });
});

describe('G27 탱크 대전', () => {
  it('포탄은 벽에 튕기고, 튕긴 포탄은 쏜 사람도 맞는다. 3번 맞으면 탈락', () => {
    const shell = { x: 300, y: 90, vx: 120, vy: 0, bounces: 0 };
    for (let i = 0; i < 30; i++) advanceShell(shell, 1 / 60);
    expect(shell.vx).toBeLessThan(0);
    expect(shell.bounces).toBe(1);

    const h = harness<TankBattle>(G27, [0, 1]);
    const t0 = h.game.tanks.find((t) => t.seat === 0)!;
    for (let k = 0; k < HP; k++) {
      h.game.shells.push({ owner: 0, x: t0.x, y: t0.y, vx: 0, vy: 0, age: 0, bounces: 1 });
      h.step(seconds(0.7));
    }
    expect(t0.alive).toBe(false);
    expect(h.game.getRanking()).toEqual([[1], [0]]);
  });
});

describe('G29 카트 레이스', () => {
  it('트랙을 시계 반대 방향으로 돌면 바퀴 수가 오르고, 먼저 들어온 순서대로 순위', () => {
    const h = harness<KartRace>(G29, [0, 1]);
    const [a, b] = h.game.karts;
    for (let i = 0; i < 400 && a.finishAt === null; i++) {
      // a를 가운데 선을 따라 강제로 옮긴다
      const ang = Math.PI / 2 - (i / 100) * Math.PI * 2 * 0.8;
      a.x = 160 + 110 * Math.cos(ang);
      a.y = 90 + 56 * Math.sin(ang);
      h.step();
    }
    expect(a.finishAt).not.toBeNull();
    expect(a.progress).toBeGreaterThanOrEqual(LAPS);
    expect(h.game.getRanking()[0]).toEqual([a.seat]);
    expect(b.finishAt).toBeNull();
  });
});

describe('G24 구슬치기 / G25 컬링 (차례제, 당겨서 튕기기)', () => {
  it('구슬: 자기 차례에 내 구슬을 당겼다 놓으면 반대쪽으로 굴러가고, 멈추면 다음 차례', () => {
    const h = harness<Marbles>(G24, [0, 1]);
    expect(h.game.activeSeat()).toBe(0);
    const m = h.game.mine(0)[0];
    const c = h.controls.get(0)!;
    c.pointerDown(m.x, m.y);
    h.step();
    c.pointerMove(m.x, m.y + 20);
    h.step();
    c.pointerUp();
    h.step();
    expect(h.game.phase).toBe('roll');
    expect(m.vy).toBeLessThan(0);
    while (h.game.phase === 'roll') h.step();
    expect(h.game.activeSeat()).toBe(1);
  });

  it('컬링: 기준선을 못 넘긴 돌은 빠지고, 과녁에 가까운 돌의 주인이 이긴다', () => {
    const h = harness<IceCurling>(G25, [0, 1]);
    const c0 = h.controls.get(0)!;
    const stone = h.game.ready!;
    c0.pointerDown(stone.x, stone.y);
    h.step();
    c0.pointerMove(stone.x - 8, stone.y);
    c0.pointerUp();
    h.step();
    while (h.game.phase === 'slide') h.step();
    expect(stone.x).toBeLessThan(HOG_X);
    expect(stone.out).toBe(true);
    expect(h.game.activeSeat()).toBe(1);
    // 2P 돌을 과녁 한가운데에 둔다
    const s1 = h.game.ready!;
    s1.x = HOUSE_X;
    s1.y = HOUSE_Y;
    h.game.ready = null;
    h.game.phase = 'slide';
    while (!h.game.isFinished()) {
      if (h.game.phase === 'slide') h.step();
      else {
        h.game.ready!.out = true;
        h.step(seconds(8));
      }
    }
    expect(h.game.getRanking()[0]).toEqual([1]);
  });
});

describe('ScrollGrid (아이콘 격자)', () => {
  const t = (id: number, x: number, y: number) => ({ id, zone: 0, x, y, startX: x, startY: y, startTime: 0 });
  it('짧게 눌렀다 떼면 그 칸, 위아래로 끌면 넘기기만 한다', () => {
    const grid = new ScrollGrid({ x: 0, y: 60, w: 320, h: 80 }, () => 40, 1);
    const first = grid.rect(0);
    grid.down(t(1, first.x + 5, first.y + 5));
    expect(grid.up(t(1, first.x + 5, first.y + 5))).toBe(0);
    grid.down(t(2, first.x + 5, first.y + 40));
    grid.move(t(2, first.x + 5, first.y + 10));
    expect(grid.scroll).toBeGreaterThan(0);
    expect(grid.up(t(2, first.x + 5, first.y + 10))).toBe(-1);
    grid.down(t(3, 10, 70));
    grid.move(t(3, 10, -500));
    expect(grid.scroll).toBe(grid.maxScroll);
  });
});
