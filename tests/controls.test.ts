import { describe, expect, it } from 'vitest';
import { BUTTON_COUNT, PlayerControls } from '../src/input/controls';
import { PAD_HIT_R, padAt, padButtons } from '../src/input/padButtons';
import { layoutPlayers } from '../src/input/seats';
import { AiHand } from '../src/minigames/ai';
import { buildPlayers, homeDir } from '../src/minigames/players';
import { gameZones } from '../src/scenes/miniGame';

describe('PlayerControls', () => {
  it('눌림·뗌은 그 틱에만 참이고, 누른 시간은 틱마다 쌓인다', () => {
    const c = new PlayerControls(1);
    c.press();
    expect(c.justPressed()).toBe(true);
    expect(c.isDown()).toBe(true);
    c.endTick(0.1);
    expect(c.justPressed()).toBe(false);
    c.endTick(0.1);
    expect(c.heldFor()).toBeCloseTo(0.2);
    c.release();
    expect(c.justReleased()).toBe(true);
    expect(c.heldFor()).toBe(0);
  });

  it('같은 틱에 눌렀다 뗀 짧은 탭도 눌림으로 잡힌다', () => {
    const c = new PlayerControls(1);
    c.press();
    c.release();
    expect(c.justPressed()).toBe(true);
    expect(c.justReleased()).toBe(true);
    expect(c.isDown()).toBe(false);
  });

  it('손가락 두 개로 누르면 둘 다 떼야 떨어진다', () => {
    const c = new PlayerControls(1);
    c.press();
    c.press();
    c.endTick(0.016);
    c.release();
    expect(c.isDown()).toBe(true);
    expect(c.justReleased()).toBe(false);
    c.release();
    expect(c.justReleased()).toBe(true);
  });
});

describe('padButtons (가장자리 큰 버튼)', () => {
  it('2인 원버튼: 1P는 오른쪽 아래, 2P는 그 사람 기준 오른쪽 아래(화면 왼쪽 위)', () => {
    const pads = padButtons(layoutPlayers([0, 1]), 'one');
    expect(pads.map((p) => [p.seat, p.x, p.y, p.flipped])).toEqual([[0, 298, 158, false], [1, 22, 22, true]]);
  });

  it('4인은 각자 자기 모서리, 좌우 버튼은 그 사람 기준 왼쪽이 0번', () => {
    const pads = padButtons(layoutPlayers([0, 1, 2, 3]), 'leftRight');
    const at = (seat: number, index: number) => pads.find((p) => p.seat === seat && p.index === index)!;
    // 아래쪽(3P 좌하): 화면 왼쪽이 왼쪽
    expect(at(2, 0).x).toBeLessThan(at(2, 1).x);
    // 위쪽(1P 좌상, 회전): 화면 오른쪽이 자기 왼쪽
    expect(at(0, 0).x).toBeGreaterThan(at(0, 1).x);
    expect(at(0, 0).y).toBe(22);
    expect(at(3, 1)).toMatchObject({ x: 298, y: 158 });
  });

  it('1인 좌우 버튼은 아래 양 끝', () => {
    const pads = padButtons(layoutPlayers([0]), 'leftRight');
    expect(pads.map((p) => [p.index, p.x, p.y])).toEqual([[0, 22, 158], [1, 298, 158]]);
  });

  it('버튼은 서로 겹치지 않고 화면 안에 있다', () => {
    for (const n of [1, 2, 3, 4]) {
      for (const layout of ['one', 'leftRight', 'upDown', 'three', 'four'] as const) {
        const pads = padButtons(layoutPlayers([0, 1, 2, 3].slice(0, n) as never), layout);
        expect(pads).toHaveLength(n * BUTTON_COUNT[layout]);
        for (const p of pads) expect(p.x - p.r >= 0 && p.x + p.r <= 320 && p.y - p.r >= 0 && p.y + p.r + 2 <= 180).toBe(true);
        for (const a of pads) for (const b of pads) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
      }
    }
  });

  it('위/아래 버튼은 화면 기준: 0번이 화면 위쪽(위에 앉은 사람도 같다)', () => {
    for (const n of [1, 2, 4]) {
      const pads = padButtons(layoutPlayers([0, 1, 2, 3].slice(0, n) as never), 'upDown');
      for (const seat of [...new Set(pads.map((p) => p.seat))]) {
        const [up, down] = [0, 1].map((i) => pads.find((p) => p.seat === seat && p.index === i)!);
        expect(up.y).toBeLessThan(down.y);
        expect(up.x).toBe(down.x);
      }
    }
  });

  it('버튼 4개(2×2)는 그 사람 기준 윗줄 왼쪽부터', () => {
    const pads = padButtons(layoutPlayers([0, 1, 2, 3]), 'four');
    const at = (seat: number, index: number) => pads.find((p) => p.seat === seat && p.index === index)!;
    // 3P(좌하, 똑바로): 0번 왼쪽 위, 3번 오른쪽 아래
    expect(at(2, 0).x).toBeLessThan(at(2, 1).x);
    expect(at(2, 0).y).toBeLessThan(at(2, 2).y);
    // 1P(좌상, 거꾸로): 화면에서는 반대
    expect(at(0, 0).x).toBeGreaterThan(at(0, 1).x);
    expect(at(0, 0).y).toBeGreaterThan(at(0, 2).y);
  });

  it('사람마다 다른 배치를 줄 수 있고, 화면 직접 조작(pointer)은 버튼이 없다', () => {
    const pads = padButtons(layoutPlayers([0, 1, 2, 3]), (seat) => (seat < 2 ? 'upDown' : seat === 2 ? 'one' : 'pointer'));
    expect(pads.filter((p) => p.seat === 0).map((p) => p.layout)).toEqual(['upDown', 'upDown']);
    expect(pads.filter((p) => p.seat === 2).map((p) => [p.layout, p.x, p.y])).toEqual([['one', 22, 158]]);
    expect(pads.some((p) => p.seat === 3)).toBe(false);
  });

  it('padAt은 판정 반지름 안에서 가장 가까운 버튼을 고른다', () => {
    const pads = padButtons(layoutPlayers([0, 1, 2, 3]), 'leftRight');
    expect(padAt(pads, 24, 160)).toMatchObject({ seat: 2, index: 0 });
    expect(padAt(pads, 58, 160)).toMatchObject({ seat: 2, index: 1 });
    expect(padAt(pads, 160, 90)).toBeNull();
    expect(padAt(pads, 22 + PAD_HIT_R + 1, 22, 0)?.index).toBe(0);
  });
});

describe('buildPlayers / homeDir', () => {
  it('사람 1명이면 AI 3명(2P~4P)을 채운다', () => {
    const players = buildPlayers(layoutPlayers([2]), 'hard');
    expect(players.map((p) => [p.seat, p.isAI])).toEqual([[0, false], [1, true], [2, true], [3, true]]);
    expect(players.every((p) => p.difficulty === 'hard')).toBe(true);
  });
  it('사람 2명 이상이면 AI가 없다', () => {
    expect(buildPlayers(layoutPlayers([0, 3]), 'normal').some((p) => p.isAI)).toBe(false);
    expect(buildPlayers(layoutPlayers([0, 1, 2, 3]), 'normal')).toHaveLength(4);
  });
  it('앉은 방향: 2인은 위/아래, 그 밖에는 자리 모서리', () => {
    const two = buildPlayers(layoutPlayers([0, 1]), 'normal');
    expect(homeDir(two[0], 2)).toEqual({ x: 0, y: 1 });
    expect(homeDir(two[1], 2)).toEqual({ x: 0, y: -1 });
    const four = buildPlayers(layoutPlayers([0, 1, 2, 3]), 'normal');
    expect(four.map((p) => homeDir(p, 4))).toEqual([{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }]);
  });
});

describe('화면 직접 조작(pointer)', () => {
  it('탭은 그 틱에만 보이고, 드래그는 첫 손가락 하나만 따라간다', () => {
    const c = new PlayerControls(0);
    c.pointerDown(10, 20);
    c.pointerDown(50, 60);
    expect(c.tapsThisTick).toEqual([{ x: 10, y: 20 }, { x: 50, y: 60 }]);
    c.pointerMove(30, 40);
    c.endTick(1 / 60);
    expect(c.tapsThisTick).toEqual([]);
    expect(c.drag).toEqual({ startX: 10, startY: 20, x: 30, y: 40 });
    c.pointerUp();
    expect(c.releasesThisTick).toEqual([{ startX: 10, startY: 20, x: 30, y: 40 }]);
    expect(c.drag).toBeNull();
  });

  it('AI 손도 같은 탭·드래그를 예약해서 넣는다', () => {
    const c = new PlayerControls(0);
    const hand = new AiHand(c);
    hand.drag(100, 100, 60, 120, 0.1, 0.2);
    hand.update(0.05);
    expect(c.drag).toBeNull();
    hand.update(0.06);
    expect(c.drag).toMatchObject({ startX: 100, startY: 100 });
    hand.update(0.25);
    expect(c.releasesThisTick).toEqual([{ startX: 100, startY: 100, x: 60, y: 120 }]);
    c.endTick(1 / 60);
    hand.tapAt(5, 6);
    hand.update(0);
    expect(c.tapsThisTick).toEqual([{ x: 5, y: 6 }]);
  });

  it('구역 방식은 자기 구역, 차례 방식은 화면 전체 하나를 터치 구역으로 둔다', () => {
    const slots = layoutPlayers([0, 1, 2, 3]);
    const area = gameZones([], slots, () => 'pointer', 'area');
    expect(area.map((z) => z.id)).toEqual([0, 1, 2, 3]);
    expect(area.find((z) => z.contains(10, 170))?.id).toBe(2);
    const turn = gameZones([], slots, () => 'pointer', 'turn');
    expect(turn).toHaveLength(1);
    expect(turn[0].contains(300, 10) && turn[0].contains(5, 175)).toBe(true);
  });
});
