import type { ControlLayout, PlayerControls } from '../input/controls';
import type { PadButton } from '../input/padButtons';
import type { Seat } from '../input/seats';
import { PAL, type Color } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawArcadeButton } from '../ui/arcadeButton';
import { DIGIT_SMALL, drawNumber } from '../ui/bigText';
import type { PlayerInfo } from './types';

/** 말 위에 띄우는 작은 진영 표식(▼). (x, y)는 꼭짓점(아래 끝). */
export function drawMarker(r: Renderer, x: number, y: number, color: Color): void {
  x = Math.round(x);
  y = Math.round(y);
  r.rect(x - 3, y - 4, 7, 2, PAL.line);
  r.rect(x - 2, y - 2, 5, 1, PAL.line);
  r.rect(x - 1, y - 1, 3, 1, PAL.line);
  r.rect(x, y, 1, 1, PAL.line);
  r.rect(x - 2, y - 3, 5, 1, color);
  r.rect(x - 1, y - 2, 3, 1, color);
  r.rect(x, y - 1, 1, 1, color);
}

/** 남은 시간(초)을 작은 7세그 숫자로 */
export function drawTimer(r: Renderer, seconds: number, x: number, y: number): void {
  const text = String(Math.max(0, Math.ceil(seconds)));
  const w = text.length * (DIGIT_SMALL.w + DIGIT_SMALL.gap) + 4;
  r.rect(x - Math.ceil(w / 2), y, w, DIGIT_SMALL.h + 4, PAL.line);
  drawNumber(r, text, x, y + 2, DIGIT_SMALL, PAL.text, { align: 'center' });
}

/** 픽셀 단위 선(브레즌햄)을 renderer로 찍는다 */
export function drawLine(r: Renderer, x0: number, y0: number, x1: number, y1: number, color: Color): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    r.rect(x0, y0, 1, 1, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** 사람 플레이어의 가장자리 큰 버튼. 누르면 눌리고, canPress면 테두리가 깜빡인다. */
export function drawPadButtons(
  r: Renderer,
  buttons: readonly PadButton[],
  players: readonly PlayerInfo[],
  controls: ReadonlyMap<Seat, PlayerControls> | null,
  layout: ControlLayout,
  time: number,
  canPress?: (seat: Seat) => boolean,
): void {
  const blink = Math.floor(time * 6) % 2 === 0;
  for (const b of buttons) {
    const p = players.find((pl) => pl.seat === b.seat);
    if (!p) continue;
    const pressed = controls?.get(b.seat)?.isDown(b.index) ?? false;
    const glow = blink && (canPress?.(b.seat) ?? false);
    drawArcadeButton(r, b, p.color, { pressed, glow, arrow: layout === 'leftRight' ? (b.index === 0 ? -1 : 1) : undefined });
  }
}
