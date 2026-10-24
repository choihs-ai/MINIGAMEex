import { describe, expect, it } from 'vitest';
import { cornerRect, layoutPlayers, type Seat } from '../src/input/seats';
import { circleZone, rectZone, TouchTracker } from '../src/input/touch';

const corners = () => ([0, 1, 2, 3] as Seat[]).map((s) => rectZone(s, cornerRect(s)));

describe('TouchTracker', () => {
  it('4명이 동시에 눌러도 각자 자기 구역에 귀속된다', () => {
    const t = new TouchTracker();
    t.setZones(corners());
    t.down(1, 20, 20, 0);
    t.down(2, 300, 20, 0);
    t.down(3, 20, 170, 0);
    t.down(4, 300, 170, 0);
    expect([0, 1, 2, 3].map((z) => t.count(z))).toEqual([1, 1, 1, 1]);
  });

  it('4명 × 2손가락을 모두 구분한다', () => {
    const t = new TouchTracker();
    t.setZones(corners());
    let id = 1;
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const r = cornerRect(seat);
      t.down(id++, r.x + 10, r.y + 10, 0);
      t.down(id++, r.x + 50, r.y + 40, 0);
    }
    expect([0, 1, 2, 3].map((z) => t.count(z))).toEqual([2, 2, 2, 2]);
    expect(t.all()).toHaveLength(8);
  });

  it('손가락이 다른 구역으로 끌려가도 시작 구역에 남는다', () => {
    const t = new TouchTracker();
    t.setZones(corners());
    t.down(1, 20, 20, 0);
    t.move(1, 300, 170);
    expect(t.touchesIn(0)[0]).toMatchObject({ x: 300, y: 170, startX: 20 });
    expect(t.count(3)).toBe(0);
  });

  it('up에서 해당 손가락만 사라지고 이벤트가 순서대로 쌓인다', () => {
    const t = new TouchTracker();
    t.setZones(corners());
    t.down(1, 20, 20, 0);
    t.down(2, 25, 25, 0);
    t.up(1);
    expect(t.count(0)).toBe(1);
    expect(t.drain().map((e) => `${e.type}${e.touch.id}`)).toEqual(['down1', 'down2', 'up1']);
    expect(t.drain()).toEqual([]);
  });

  it('구역 밖 터치는 무시하고, 먼저 등록한 구역이 우선한다', () => {
    const t = new TouchTracker();
    t.setZones([circleZone(4, 160, 90, 22), ...corners()]);
    expect(t.down(1, 160, 90, 0)?.zone).toBe(4);
    expect(t.down(2, 20, 20, 0)?.zone).toBe(0);
    t.setZones([rectZone(0, { x: 0, y: 0, w: 10, h: 10 })]);
    expect(t.down(3, 50, 50, 0)).toBeNull();
  });

  it('구역을 바꾸면 누르고 있던 터치가 초기화된다', () => {
    const t = new TouchTracker();
    t.setZones(corners());
    t.down(1, 20, 20, 0);
    t.setZones(corners());
    expect(t.all()).toHaveLength(0);
    t.up(1);
    expect(t.drain()).toEqual([]);
  });

  it('2인 배치에서는 위/아래 반쪽이 각자의 구역이다', () => {
    const t = new TouchTracker();
    t.setZones(layoutPlayers([0, 1]).map((p) => rectZone(p.seat, p.zone)));
    expect(t.down(1, 5, 170, 0)?.zone).toBe(0);
    expect(t.down(2, 315, 10, 0)?.zone).toBe(1);
  });
});
