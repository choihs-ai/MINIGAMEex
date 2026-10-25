import type { Rect } from '../input/seats';
import { rectZone, type Touch, type Zone } from '../input/touch';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { gameIcon, ICON_SIZE } from './icons';
import { drawLine } from '../minigames/common';

export const TILE = 28;
const TILE_GAP = 5;
const COLS = 9;
const PITCH = TILE + TILE_GAP;
/** 손가락이 이만큼 움직이면 누르기가 아니라 끌어 넘기기 */
const DRAG_SLOP = 5;

/** 게임 아이콘 칸(가운데 정렬 9열 그리드). gridY는 첫 줄 위쪽. */
export function tileRect(i: number, gridY: number): Rect {
  const x0 = Math.floor((320 - (COLS * TILE + (COLS - 1) * TILE_GAP)) / 2);
  return { x: x0 + (i % COLS) * PITCH, y: gridY + Math.floor(i / COLS) * PITCH, w: TILE, h: TILE };
}

/**
 * 위아래로 끌어 넘기는 아이콘 격자. 화면에서 view 안만 보인다.
 * 짧게 눌렀다 떼면 그 칸을 고르고, 위아래로 끌면 넘긴다(넘기는 중에는 아무 칸도 안 고른다).
 */
export class ScrollGrid {
  scroll = 0;
  /** 지금 누르고 있는 칸(끌기 시작하면 -1) */
  pressed = -1;
  private finger: { id: number; startY: number; startScroll: number; dragging: boolean } | null = null;

  constructor(
    readonly view: Rect,
    private readonly count: () => number,
    private readonly zoneId: number,
  ) {}

  get maxScroll(): number {
    const rows = Math.ceil(this.count() / COLS);
    return Math.max(0, rows * PITCH - TILE_GAP - this.view.h + 4);
  }

  zone(): Zone {
    return rectZone(this.zoneId, this.view);
  }

  rect(i: number): Rect {
    return tileRect(i, this.view.y + 2 - Math.round(this.scroll));
  }

  /** 화면 (x, y)에 있는 칸 번호(없으면 -1) */
  indexAt(x: number, y: number): number {
    if (y < this.view.y || y >= this.view.y + this.view.h) return -1;
    for (let i = 0; i < this.count(); i++) {
      const t = this.rect(i);
      if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return i;
    }
    return -1;
  }

  down(t: Touch): void {
    if (this.finger) return;
    this.finger = { id: t.id, startY: t.y, startScroll: this.scroll, dragging: false };
    this.pressed = this.indexAt(t.x, t.y);
  }

  move(t: Touch): void {
    const f = this.finger;
    if (!f || f.id !== t.id) return;
    const dy = t.y - f.startY;
    if (!f.dragging && Math.abs(dy) >= DRAG_SLOP && this.maxScroll > 0) {
      f.dragging = true;
      this.pressed = -1;
    }
    if (f.dragging) this.scroll = Math.max(0, Math.min(this.maxScroll, f.startScroll - dy));
  }

  /** 뗐을 때 고른 칸(끌어 넘겼거나 다른 칸에서 뗐으면 -1) */
  up(t: Touch): number {
    const f = this.finger;
    if (!f || f.id !== t.id) return -1;
    this.finger = null;
    const picked = !f.dragging && this.pressed >= 0 && this.indexAt(t.x, t.y) === this.pressed ? this.pressed : -1;
    this.pressed = -1;
    return picked;
  }

  render(r: Renderer, draw: (i: number, rect: Rect, pressed: boolean) => void): void {
    const { ctx } = r;
    const v = this.view;
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.x, v.y, v.w, v.h);
    ctx.clip();
    for (let i = 0; i < this.count(); i++) {
      const t = this.rect(i);
      if (t.y + t.h + 2 < v.y || t.y > v.y + v.h) continue;
      draw(i, t, this.pressed === i);
    }
    ctx.restore();
    // 넘길 게 있으면 오른쪽에 위치 막대
    const max = this.maxScroll;
    if (max > 0) {
      const barH = Math.max(8, Math.round((v.h * v.h) / (v.h + max)));
      const y = v.y + Math.round(((v.h - barH) * this.scroll) / max);
      r.rect(v.x + v.w - 3, v.y, 2, v.h, PAL.bgMid);
      r.rect(v.x + v.w - 3, y, 2, barH, PAL.text);
    }
  }
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
