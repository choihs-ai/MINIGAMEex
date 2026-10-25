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

/** 모서리 버튼을 피한 왼쪽 가운데 빈자리(남은 시간 표시용) */
export const TIMER_X = 24;
export const TIMER_Y = 82;

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

/** 원 둘레만 1px로(중점 원 알고리즘) */
export function drawRing(r: Renderer, cx: number, cy: number, radius: number, color: Color): void {
  cx = Math.round(cx);
  cy = Math.round(cy);
  let x = 0;
  let y = Math.round(radius);
  let d = 1 - y;
  while (x <= y) {
    for (const [px, py] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]) {
      r.rect(cx + px, cy + py, 1, 1, color);
    }
    x++;
    if (d < 0) d += 2 * x + 1;
    else {
      y--;
      d += 2 * (x - y) + 1;
    }
  }
}

/** 모서리 버튼 사이 가운데 띠: 사람마다 세로 칸(레인)을 하나씩 나눠 준다 */
export const LANE_FIELD = { x: 64, w: 192 } as const;

export interface Lane {
  seat: Seat;
  x: number;
  w: number;
  /** 가운데 x */
  cx: number;
}

/** 1P부터 왼쪽→오른쪽으로 레인을 나눈다(위쪽에 앉은 사람도 같은 방향으로 본다) */
export function makeLanes(players: readonly PlayerInfo[]): Lane[] {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const w = Math.floor(LANE_FIELD.w / ordered.length);
  const x0 = LANE_FIELD.x + Math.floor((LANE_FIELD.w - w * ordered.length) / 2);
  return ordered.map((p, i) => ({ seat: p.seat, x: x0 + i * w, w, cx: x0 + i * w + w / 2 }));
}

/** 레인 사이 구분선(점선) */
export function drawLaneDividers(r: Renderer, lanes: readonly Lane[]): void {
  const first = lanes[0];
  const last = lanes[lanes.length - 1];
  if (!first || !last) return;
  for (let y = 0; y < 180; y += 4) {
    r.rect(first.x - 1, y, 1, 2, PAL.bgMid);
    for (const lane of lanes) r.rect(lane.x + lane.w, y, 1, 2, PAL.bgMid);
  }
}

/** 점프 높이(포물선). jumpT는 뛴 뒤 지난 시간(안 뛰고 있으면 null) */
export function jumpHeight(jumpT: number | null, duration: number, peak: number): number {
  if (jumpT === null) return 0;
  const s = Math.min(1, Math.max(0, jumpT / duration));
  return 4 * peak * s * (1 - s);
}
