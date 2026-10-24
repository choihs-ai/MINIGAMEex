import type { Rect } from '../input/seats';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { gameIcon, ICON_SIZE } from './icons';
import { drawLine } from '../minigames/common';

export const TILE = 30;
const TILE_GAP = 6;
const COLS = 8;

/** 게임 아이콘 칸(가운데 정렬 8열 그리드) */
export function tileRect(i: number, gridY: number): Rect {
  const x0 = Math.floor((320 - (COLS * TILE + (COLS - 1) * TILE_GAP)) / 2);
  return { x: x0 + (i % COLS) * (TILE + TILE_GAP), y: gridY + Math.floor(i / COLS) * (TILE + TILE_GAP), w: TILE, h: TILE };
}

/** 토너먼트 설정에서의 표시: 랜덤 후보 / 확정(노랑) / 밴(빨간 X) */
export type TileMark = 'none' | 'fixed' | 'banned';

export function drawGameTile(r: Renderer, t: Rect, code: string, opts: { pressed?: boolean; mark?: TileMark } = {}): void {
  const dy = opts.pressed ? 2 : 0;
  const mark = opts.mark ?? 'none';
  r.rect(t.x, t.y + 2, t.w, t.h, PAL.line);
  r.rect(t.x, t.y + dy, t.w, t.h, PAL.line);
  r.rect(t.x + 1, t.y + 1 + dy, t.w - 2, t.h - 2, mark === 'banned' ? PAL.bgDark : PAL.bgMid);
  if (mark === 'fixed') {
    r.frame(t.x, t.y + dy, t.w, t.h, PAL.yellow);
    r.frame(t.x + 1, t.y + 1 + dy, t.w - 2, t.h - 2, PAL.yellow);
  }
  r.ctx.drawImage(gameIcon(code), t.x + (t.w - ICON_SIZE) / 2, t.y + (t.h - ICON_SIZE) / 2 + dy);
  if (mark === 'banned') {
    for (let k = 0; k < 2; k++) {
      drawLine(r, t.x + 4 + k, t.y + 4 + dy, t.x + t.w - 5 + k, t.y + t.h - 5 + dy, PAL.red);
      drawLine(r, t.x + t.w - 5 + k, t.y + 4 + dy, t.x + 4 + k, t.y + t.h - 5 + dy, PAL.red);
    }
  }
}
