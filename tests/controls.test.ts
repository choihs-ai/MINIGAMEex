import { describe, expect, it } from 'vitest';
import { buttonAt, PlayerControls } from '../src/input/controls';
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

describe('buttonAt', () => {
  const zone = { x: 0, y: 90, w: 320, h: 90 };
  it('원버튼은 구역 어디든 0번', () => {
    expect(buttonAt('one', zone, false, 300)).toBe(0);
  });
  it('좌우 버튼: 아래쪽 사람은 화면 왼쪽이 왼쪽', () => {
    expect(buttonAt('leftRight', zone, false, 10)).toBe(0);
    expect(buttonAt('leftRight', zone, false, 310)).toBe(1);
  });
  it('좌우 버튼: 위쪽(회전) 사람은 화면 오른쪽이 자기 왼쪽', () => {
    const top = { x: 160, y: 0, w: 160, h: 90 };
    expect(buttonAt('leftRight', top, true, 310)).toBe(0);
    expect(buttonAt('leftRight', top, true, 170)).toBe(1);
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
