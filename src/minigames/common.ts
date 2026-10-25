import type { ControlLayout, PlayerControls } from '../input/controls';
import type { PadButton } from '../input/padButtons';
import type { Seat } from '../input/seats';
import { PAL, type Color } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawArcadeButton, type PadArrow } from '../ui/arcadeButton';
import { DIGIT_SMALL, drawNumber } from '../ui/bigText';
import { homeDir } from './players';
import type { PadStyle, PlayerInfo } from './types';

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

/** 사람 플레이어의 가장자리 큰 버튼. 누르면 눌리고, canPress면 테두리가 깜빡인다. style로 색·그림을 바꿀 수 있다. */
export function drawPadButtons(
  r: Renderer,
  buttons: readonly PadButton[],
  players: readonly PlayerInfo[],
  controls: ReadonlyMap<Seat, PlayerControls> | null,
  time: number,
  opts: {
    canPress?: (seat: Seat) => boolean;
    style?: (seat: Seat, index: number, layout: ControlLayout) => PadStyle | null;
  } = {},
): void {
  const blink = Math.floor(time * 6) % 2 === 0;
  for (const b of buttons) {
    const p = players.find((pl) => pl.seat === b.seat);
    if (!p) continue;
    const pressed = controls?.get(b.seat)?.isDown(b.index) ?? false;
    const glow = blink && (opts.canPress?.(b.seat) ?? false);
    const style = opts.style?.(b.seat, b.index, b.layout) ?? null;
    drawArcadeButton(r, b, style?.color ?? p.color, {
      pressed,
      glow,
      radius: b.r,
      arrow: style?.icon ? undefined : padArrow(b),
      icon: style?.icon,
    });
  }
}

/** 좌우 버튼은 그 사람 기준 ◀▶, 위/아래 버튼은 화면 기준 ▲▼ */
function padArrow(b: PadButton): PadArrow | undefined {
  if (b.layout === 'leftRight') return b.index === 0 ? 'left' : 'right';
  if (b.layout === 'upDown') return b.index === 0 ? 'up' : 'down';
  return undefined;
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

/** 이 플레이어 쪽(자기 구역 가운데쯤)의 기준점. 모서리 버튼을 피한다. 2인은 위/아래 가운데. */
export function anchorOf(p: PlayerInfo, humanCount: number, dx = 80, dy = 45): { x: number; y: number } {
  const d = homeDir(p, humanCount);
  return { x: 160 + d.x * dx, y: 90 + d.y * dy };
}

/** fn에서 그리는 것을 위쪽에 앉은 사람이면 (cx, cy)를 중심으로 180도 돌려 그린다 */
export function facing(r: Renderer, p: Pick<PlayerInfo, 'flipped'>, cx: number, cy: number, fn: () => void): void {
  if (p.flipped) r.rotated180(Math.round(cx), Math.round(cy), 0, 0, fn);
  else fn();
}

/** 진영 표식(▼) + 점수. (x, y)는 숫자 가운데 위쪽. 위쪽 사람은 돌려서 그린다. */
export function drawScoreTag(r: Renderer, p: PlayerInfo, x: number, y: number, score: number | string): void {
  facing(r, p, x, y + 4, () => {
    const text = String(score);
    const w = r.textWidth(text) + 4;
    r.rect(x - Math.ceil(w / 2), y - 1, w, 10, PAL.line);
    r.text(text, x, y, p.color.base, 'center');
    drawMarker(r, x, y - 3, p.color.base);
  });
}

/** 기준점 a에서 "그 사람 기준"으로 오른쪽 ox, 아래 oy만큼 떨어진 화면 위치(위쪽 사람은 반대로) */
export function localOffset(p: Pick<PlayerInfo, 'flipped'>, a: { x: number; y: number }, ox: number, oy: number): { x: number; y: number } {
  return p.flipped ? { x: a.x - ox, y: a.y - oy } : { x: a.x + ox, y: a.y + oy };
}
