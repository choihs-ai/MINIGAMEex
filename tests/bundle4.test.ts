import { describe, expect, it } from 'vitest';
import { STEP } from '../src/core/loop';
import { BTN_LEFT } from '../src/input/controls';
import type { Seat } from '../src/input/seats';
import { G04, type PaintLand } from '../src/minigames/G04';
import { G06, type BombQuiz } from '../src/minigames/G06';
import { CONFIRM, G07, PLUS, uniqueWinner, type SecretAuction } from '../src/minigames/G07';
import { G12, type GoalKeep } from '../src/minigames/G12';
import { G18, type MemoryRelay } from '../src/minigames/G18';
import { beats, G21, type ColorTrap } from '../src/minigames/G21';
import { G22, type StarCatch } from '../src/minigames/G22';
import { G31, treasure, type GreedDig } from '../src/minigames/G31';
import { G32, type BombBoxes } from '../src/minigames/G32';
import { roundPoints } from '../src/minigames/G33';
import { G35, type MemoryPairs } from '../src/minigames/G35';
import { EXIT, makeMaze, solve, START } from '../src/minigames/G37';
import { G46, REACH_TIME, type FingerTwister } from '../src/minigames/G46';
import { G49, type SliceArea } from '../src/minigames/G49';
import { G54, type ConvenienceStore } from '../src/minigames/G54';
import { G58, type SpaceSweep } from '../src/minigames/G58';
import { createRng } from '../src/core/rng';
import { harness, type Harness } from './helpers';

const tap = (h: Harness, seat: Seat, b = 0) => {
  h.controls.get(seat)!.press(b);
  h.step();
  h.controls.get(seat)!.release(b);
};
const touch = (h: Harness, seat: Seat, x: number, y: number) => {
  h.controls.get(seat)!.pointerDown(x, y);
  h.controls.get(seat)!.pointerUp();
  h.step();
};
const secs = (s: number) => Math.ceil(s / STEP);

describe('통폐합한 게임', () => {
  it('G21: 손 문제는 그 손을 이기는 버튼이 정답', () => {
    const h = harness<ColorTrap>(G21, [0, 1]);
    for (let i = 0; i < 2000 && !(h.game.phase === 'ask' && h.game.hand !== null); i++) h.step();
    expect(h.game.answer).toBe(beats(h.game.hand!));
  });

  it('G22: 좌우가 뒤바뀐 동안에는 왼쪽 버튼으로 오른쪽에 간다', () => {
    const h = harness<StarCatch>(G22, [0, 3]);
    h.game.nextSwap = 0;
    const b = h.game.baskets.find((x) => x.seat === 0)!;
    const x0 = b.x;
    h.controls.get(0)!.press(BTN_LEFT);
    h.step(10);
    expect(b.x).toBeGreaterThan(x0);
  });

  it('G54: 두 개 주문은 순서대로 눌러야 한다', () => {
    const h = harness<ConvenienceStore>(G54, [0, 1]);
    h.game.t = 10;
    while (h.game.order === null || h.game.order.length < 2) {
      h.game.order = null;
      h.step();
    }
    const s = h.game.shelves.find((x) => x.seat === 0)!;
    const [a, b] = h.game.order!;
    const ca = h.game.cellRect(s, s.items.indexOf(a));
    const cb = h.game.cellRect(s, s.items.indexOf(b));
    touch(h, 0, cb.x + 4, cb.y + 4);
    expect(h.game.locked(0)).toBe(true);
    h.step(secs(1.1));
    touch(h, 0, ca.x + 4, ca.y + 4);
    touch(h, 0, cb.x + 4, cb.y + 4);
    expect(h.game.scores.get(0)).toBe(1);
  });
});

describe('새 게임 규칙', () => {
  it('G04: 내 색으로 둘러싼 칸은 내 것이 된다', () => {
    const h = harness<PaintLand>(G04, [0, 1]);
    const COLS = 40;
    for (let x = 10; x <= 14; x++) for (const y of [5, 9]) h.game.grid[y * COLS + x] = 0;
    for (let y = 5; y <= 9; y++) for (const x of [10, 14]) h.game.grid[y * COLS + x] = 0;
    h.step(secs(0.5));
    expect(h.game.grid[7 * COLS + 12]).toBe(0);
  });

  it('G06: 맞히면 폭탄이 넘어가고, 터지면 든 사람이 탈락', () => {
    const h = harness<BombQuiz>(G06, [0, 1, 2]);
    const first = h.game.holder;
    tap(h, first, h.game.item.answer);
    expect(h.game.holder).not.toBe(first);
    const holder = h.game.holder;
    h.game.fuse = 0.01;
    h.step(2);
    expect(h.game.alive(holder)).toBe(false);
  });

  it('G07: 혼자만 낸 금액 중 최고가가 낙찰', () => {
    expect(uniqueWinner([{ seat: 0, bid: 5 }, { seat: 1, bid: 5 }, { seat: 2, bid: 3 }])).toBe(2);
    expect(uniqueWinner([{ seat: 0, bid: 2 }, { seat: 1, bid: 2 }])).toBeNull();
    const h = harness<SecretAuction>(G07, [0, 1]);
    tap(h, 0, PLUS);
    tap(h, 0, CONFIRM);
    tap(h, 1, CONFIRM);
    expect(h.game.winner).toBe(0);
    expect(h.game.bidders.find((b) => b.seat === 0)!.coins).toBe(9);
  });

  it('G12: 자기 골에 퍽이 들어가면 체력이 깎인다', () => {
    const h = harness<GoalKeep>(G12, [0, 1]);
    const bottom = h.game.keepers.find((k) => k.seat === 0)!;
    bottom.x = 300;
    h.game.pucks = [{ x: 160, y: 170, vx: 0, vy: 200, wait: 0 }];
    h.step(10);
    expect(bottom.hp).toBe(2);
  });

  it('G18: 순서를 틀리면 탈락', () => {
    const h = harness<MemoryRelay>(G18, [0, 1, 2]);
    while (h.game.phase !== 'input') h.step();
    const cur = h.game.current;
    tap(h, cur, (h.game.seq[0] + 1) % 4);
    expect(h.game.outAt.has(cur)).toBe(true);
  });

  it('G31: 해골 때 누르고 있으면 0점, 미리 떼면 챙긴다', () => {
    const h = harness<GreedDig>(G31, [0, 1]);
    h.controls.get(0)!.press();
    h.controls.get(1)!.press();
    while (h.game.phase !== 'dig') h.step();
    h.game.skullAt = 2;
    h.step(secs(1));
    h.controls.get(0)!.release();
    h.step(secs(1.2));
    const [a, b] = h.game.diggers;
    expect(a.total).toBeGreaterThanOrEqual(treasure(0.9));
    expect(b.state).toBe('blown');
    expect(b.total).toBe(0);
  });

  it('G32: 폭탄 상자를 연 사람은 탈락', () => {
    const h = harness<BombBoxes>(G32, [0, 1, 2]);
    const cur = h.game.current;
    const r = h.game.boxRect(h.game.bomb);
    touch(h, cur, r.x + 5, r.y + 5);
    expect(h.game.outAt.has(cur)).toBe(true);
  });

  it('G33: 전원 나눔 2점, 독식 1명 5점, 독식 2명 이상 0점', () => {
    expect([...roundPoints(new Map([[0, 'share'], [1, 'share']] as const)).values()]).toEqual([2, 2]);
    expect([...roundPoints(new Map([[0, 'grab'], [1, 'share']] as const)).values()]).toEqual([5, 0]);
    expect([...roundPoints(new Map([[0, 'grab'], [1, 'grab'], [2, 'share']] as const)).values()]).toEqual([0, 0, 0]);
  });

  it('G35: 짝을 맞히면 1점이고 한 번 더', () => {
    const h = harness<MemoryPairs>(G35, [0, 1]);
    const cur = h.game.current;
    const a = 0;
    const b = h.game.cards.findIndex((k, i) => i !== a && k === h.game.cards[a]);
    for (const i of [a, b]) {
      const r = h.game.cardRect(i);
      touch(h, cur, r.x + 5, r.y + 5);
    }
    expect(h.game.pairs.get(cur)).toBe(1);
    expect(h.game.current).toBe(cur);
  });

  it('G37: 미로는 늘 출발점에서 출구까지 길이 있다', () => {
    for (let seed = 1; seed < 20; seed++) {
      const m = makeMaze(createRng(seed));
      const path = solve(m, START);
      expect(path[0]).toEqual(START);
      expect(path[path.length - 1]).toEqual(EXIT);
    }
  });

  it('G46: 새 원에 제때 손가락을 못 올리면 탈락', () => {
    const h = harness<FingerTwister>(G46, [0, 1]);
    h.step(secs(0.7));
    const s1 = h.game.players.find((p) => p.seat === 1)!.spots[0];
    h.controls.get(1)!.pointerDown(s1.x, s1.y, 5);
    h.step(secs(REACH_TIME + 0.2));
    expect(h.game.players.find((p) => p.seat === 0)!.outAt).not.toBeNull();
    expect(h.game.players.find((p) => p.seat === 1)!.outAt).toBeNull();
  });

  it('G49: 선이 다 자라면 공 없는 쪽이 잘려 점수가 된다', () => {
    const h = harness<SliceArea>(G49, [0, 1]);
    const b = h.game.boards.find((x) => x.seat === 0)!;
    b.ball = { x: b.rect.x + 5, y: b.rect.y + 5, vx: 0.01, vy: 0.01 };
    const x = b.rect.x + b.rect.w / 2;
    const y = b.rect.y + b.rect.h - 6;
    const c = h.controls.get(0)!;
    c.pointerDown(x, y);
    c.pointerMove(x + 20, y);
    c.pointerUp();
    h.step(secs(2));
    expect(b.score).toBeGreaterThan(0);
  });

  it('G58: 쓰레기에 닿으면 꼬리에 달리고 기지에 가져가면 점수', () => {
    const h = harness<SpaceSweep>(G58, [0, 1]);
    const s = h.game.ships.find((x) => x.seat === 0)!;
    h.game.junk = [{ x: s.x, y: s.y, vx: 0, vy: 0 }];
    h.step();
    expect(s.tail.length).toBe(1);
    s.x = s.base.x;
    s.y = s.base.y;
    h.step();
    expect(s.banked).toBe(1);
  });
});
