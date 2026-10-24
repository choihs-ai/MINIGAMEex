import type { Rect } from './seats';

export interface Zone {
  id: number;
  contains(x: number, y: number): boolean;
}

export const rectZone = (id: number, r: Rect): Zone => ({
  id,
  contains: (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
});

export const circleZone = (id: number, cx: number, cy: number, radius: number): Zone => ({
  id,
  contains: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2,
});

export interface Touch {
  /** pointerId */
  id: number;
  /** 시작 위치가 속한 구역. 손가락이 구역 밖으로 나가도 바뀌지 않는다. */
  zone: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

export interface InputEvent {
  type: 'down' | 'move' | 'up';
  touch: Touch;
}

/** 손가락(pointerId)별로 추적하고, 각 터치를 시작 위치의 구역에 귀속시킨다. DOM과 무관해 테스트할 수 있다. */
export class TouchTracker {
  private zones: Zone[] = [];
  private readonly active = new Map<number, Touch>();
  private events: InputEvent[] = [];

  /** 구역을 바꾸면 누르고 있던 손가락은 모두 놓은 것으로 친다(새 화면에서 다시 눌러야 함). */
  setZones(zones: Zone[]): void {
    this.zones = zones;
    this.reset();
  }

  reset(): void {
    this.active.clear();
    this.events = [];
  }

  down(id: number, x: number, y: number, now: number): Touch | null {
    const zone = this.zones.find((z) => z.contains(x, y));
    if (!zone) return null;
    const touch: Touch = { id, zone: zone.id, x, y, startX: x, startY: y, startTime: now };
    this.active.set(id, touch);
    this.events.push({ type: 'down', touch: { ...touch } });
    return touch;
  }

  move(id: number, x: number, y: number): void {
    const touch = this.active.get(id);
    if (!touch) return;
    touch.x = x;
    touch.y = y;
    this.events.push({ type: 'move', touch: { ...touch } });
  }

  up(id: number): void {
    const touch = this.active.get(id);
    if (!touch) return;
    this.active.delete(id);
    this.events.push({ type: 'up', touch: { ...touch } });
  }

  touchesIn(zone: number): Touch[] {
    return [...this.active.values()].filter((t) => t.zone === zone);
  }

  count(zone: number): number {
    let n = 0;
    for (const t of this.active.values()) if (t.zone === zone) n++;
    return n;
  }

  all(): Touch[] {
    return [...this.active.values()];
  }

  /** 마지막 호출 이후 쌓인 이벤트를 비우며 돌려준다. */
  drain(): InputEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
