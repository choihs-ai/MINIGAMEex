import { BASE_H, BASE_W } from '../render/layout';

/** 0=1P 빨강(좌상) 1=2P 파랑(우상) 2=3P 노랑(좌하) 3=4P 초록(우하) */
export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlayerSlot {
  seat: Seat;
  /** 이 플레이어의 터치 구역(기준 화면 좌표) */
  zone: Rect;
  /** 위쪽에 앉은 플레이어라 UI를 180도 돌려 그린다 */
  flipped: boolean;
}

const HALF_W = BASE_W / 2;
const HALF_H = BASE_H / 2;

/** 로비의 고정 모서리 구역: 좌상 · 우상 · 좌하 · 우하 */
export function cornerRect(seat: Seat): Rect {
  return { x: seat % 2 === 0 ? 0 : HALF_W, y: seat < 2 ? 0 : HALF_H, w: HALF_W, h: HALF_H };
}

/**
 * 참가한 모서리(참가 순서)로 게임 중 배치를 정한다.
 * - 1인: 화면 전체, 1P
 * - 2인: 참가 순서대로 1P 아래, 2P 위(마주 보기). 위쪽은 UI 180도 회전
 * - 3~4인: 모서리 고정(1P 좌상 · 2P 우상 · 3P 좌하 · 4P 우하), 위쪽 둘은 회전
 */
export function layoutPlayers(joined: readonly Seat[]): PlayerSlot[] {
  if (joined.length === 1) {
    return [{ seat: 0, zone: { x: 0, y: 0, w: BASE_W, h: BASE_H }, flipped: false }];
  }
  if (joined.length === 2) {
    return [
      { seat: 0, zone: { x: 0, y: HALF_H, w: BASE_W, h: HALF_H }, flipped: false },
      { seat: 1, zone: { x: 0, y: 0, w: BASE_W, h: HALF_H }, flipped: true },
    ];
  }
  return [...joined]
    .sort((a, b) => a - b)
    .map((seat) => ({ seat, zone: cornerRect(seat), flipped: seat < 2 }));
}
