import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';

/** 아케이드 버튼. 누르면 2px 눌려 들어간다. */
export function drawArcadeButton(r: Renderer, cx: number, cy: number, radius: number, color: SeatColor, pressed: boolean): void {
  r.disc(cx, cy + 2, radius + 1, PAL.line);
  r.disc(cx, cy + 2, radius, color.shadow);
  const dy = pressed ? 2 : 0;
  r.disc(cx, cy + dy, radius, color.base);
  r.rect(cx - Math.floor(radius / 2) - 1, cy + dy - Math.floor(radius / 2), 3, 1, PAL.text);
  r.rect(cx - Math.floor(radius / 2), cy + dy - Math.floor(radius / 2) + 1, 1, 2, PAL.text);
}

/** 버튼 둘레에 차오르는 게이지(12시 방향에서 시계 방향). progress는 0~1. */
export function drawRingGauge(r: Renderer, cx: number, cy: number, radius: number, progress: number): void {
  const steps = Math.round(radius * 7);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.round(Math.cos(a) * radius);
    const y = cy + Math.round(Math.sin(a) * radius);
    r.rect(x - 1, y - 1, 2, 2, i / steps < progress ? PAL.text : PAL.bgMid);
  }
}
