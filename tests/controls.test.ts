import { describe, expect, it } from 'vitest';
import { PlayerControls } from '../src/input/controls';
import { PAD_HIT_R, padAt, padButtons } from '../src/input/padButtons';
import { layoutPlayers } from '../src/input/seats';
import { buildPlayers, homeDir } from '../src/minigames/players';

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
      for (const layout of ['one', 'leftRight'] as const) {
        const pads = padButtons(layoutPlayers([0, 1, 2, 3].slice(0, n) as never), layout);
        for (const p of pads) expect(p.x - 17 >= 0 && p.x + 17 <= 320 && p.y - 17 >= 0 && p.y + 19 <= 180).toBe(true);
        for (const a of pads) for (const b of pads) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(34);
      }
    }
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
