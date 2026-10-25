import type { Drag } from '../input/controls';
import type { Seat } from '../input/seats';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';

// 당겨서 튕기는 차례제 게임(G24 구슬치기, G25 컬링)의 공통: 원판 물리와 당기기 조준.

export interface Disc {
  id: number;
  owner: Seat;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 판 밖으로 나갔다 */
  out: boolean;
}

/** 원판을 굴린다: 일정한 마찰 감속 + 같은 무게의 반발 충돌. 부딪힌 횟수를 돌려준다. */
export function stepDiscs(discs: Disc[], dt: number, decel: number, restitution: number): number {
  const live = discs.filter((d) => !d.out);
  for (const d of live) {
    const v = Math.hypot(d.vx, d.vy);
    if (v === 0) continue;
    const nv = Math.max(0, v - decel * dt);
    d.vx *= nv / v;
    d.vy *= nv / v;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
  }
  let hits = 0;
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (dist >= min || dist === 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = min - dist;
      a.x -= (nx * overlap) / 2;
      a.y -= (ny * overlap) / 2;
      b.x += (nx * overlap) / 2;
      b.y += (ny * overlap) / 2;
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing <= 0) continue;
      const imp = ((1 + restitution) * closing) / 2;
      a.vx -= nx * imp;
      a.vy -= ny * imp;
      b.vx += nx * imp;
      b.vy += ny * imp;
      hits++;
    }
  }
  return hits;
}

export function anyMoving(discs: readonly Disc[], threshold = 2): boolean {
  return discs.some((d) => !d.out && Math.hypot(d.vx, d.vy) > threshold);
}

/** 당긴 손가락 → 튕길 속도(당긴 반대 방향). maxDrag보다 길게 당겨도 그 이상은 세지지 않는다. */
export function flickVelocity(drag: Drag, maxDrag: number, power: number): { vx: number; vy: number; len: number } {
  const dx = drag.startX - drag.x;
  const dy = drag.startY - drag.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { vx: 0, vy: 0, len: 0 };
  const k = Math.min(len, maxDrag);
  return { vx: (dx / len) * k * power, vy: (dy / len) * k * power, len: k };
}

/** 조준선: 원판에서 튕겨 갈 방향으로 세기만큼 점을 찍는다 */
export function drawAim(r: Renderer, disc: Disc, drag: Drag, maxDrag: number): void {
  const dx = drag.startX - drag.x;
  const dy = drag.startY - drag.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const k = Math.min(len, maxDrag) / maxDrag;
  const ux = dx / len;
  const uy = dy / len;
  const dots = 2 + Math.round(k * 8);
  for (let i = 1; i <= dots; i++) {
    const x = disc.x + ux * (disc.r + i * 5);
    const y = disc.y + uy * (disc.r + i * 5);
    r.rect(x - 1, y - 1, 3, 3, PAL.line);
    r.rect(x, y, 1, 1, k > 0.85 ? PAL.red : PAL.text);
  }
  // 당기는 쪽 고무줄
  const bx = disc.x - ux * Math.min(len, maxDrag) * 0.6;
  const by = disc.y - uy * Math.min(len, maxDrag) * 0.6;
  r.rect(bx - 1, by - 1, 3, 3, PAL.bgMid);
}
