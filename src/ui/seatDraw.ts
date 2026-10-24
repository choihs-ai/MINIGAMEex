import type { PlayerSlot } from '../input/seats';
import type { Renderer } from '../render/renderer';

/** 플레이어 구역 안에 그리는 UI. 위쪽에 앉은 플레이어는 구역 기준 180도 돌려 그린다. */
export function inSeat(r: Renderer, slot: PlayerSlot, draw: () => void): void {
  if (slot.flipped) r.rotated180(slot.zone.x, slot.zone.y, slot.zone.w, slot.zone.h, draw);
  else draw();
}
