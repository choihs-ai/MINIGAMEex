import { describe, expect, it } from 'vitest';
import { layoutPlayers } from '../src/input/seats';

describe('layoutPlayers', () => {
  it('1인은 화면 전체를 1P가 쓴다', () => {
    const [p] = layoutPlayers([3]);
    expect(p.seat).toBe(0);
    expect(p.zone).toEqual({ x: 0, y: 0, w: 320, h: 180 });
    expect(p.flipped).toBe(false);
  });

  it('2인은 참가 순서대로 1P 아래, 2P 위(회전)로 마주 본다', () => {
    const [a, b] = layoutPlayers([3, 1]);
    expect(a).toMatchObject({ seat: 0, flipped: false, zone: { y: 90, h: 90 } });
    expect(b).toMatchObject({ seat: 1, flipped: true, zone: { y: 0, h: 90 } });
  });

  it('3~4인은 모서리를 고정하고 위쪽 둘만 회전한다', () => {
    const slots = layoutPlayers([3, 0, 2, 1]);
    expect(slots.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
    expect(slots.map((s) => s.flipped)).toEqual([true, true, false, false]);
    expect(slots[3].zone).toEqual({ x: 160, y: 90, w: 160, h: 90 });
    expect(layoutPlayers([2, 0, 3]).map((s) => s.seat)).toEqual([0, 2, 3]);
  });

  it('구역은 겹치지 않고 화면을 빈틈없이 나눈다(4인)', () => {
    const area = layoutPlayers([0, 1, 2, 3]).reduce((n, s) => n + s.zone.w * s.zone.h, 0);
    expect(area).toBe(320 * 180);
  });
});
