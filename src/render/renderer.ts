import type { PixelFont } from './font';
import type { Color } from './palette';
import type { Screen } from './screen';

export type TextAlign = 'left' | 'center' | 'right';

/**
 * 기준 해상도 버퍼에 그리는 도구 모음. 좌표는 모두 기준 픽셀이고 정수로 맞춰 찍는다.
 * 색은 팔레트 타입(Color)만 받는다.
 */
export class Renderer {
  constructor(
    private readonly screen: Screen,
    private readonly font: PixelFont,
  ) {}

  get width(): number {
    return this.screen.width;
  }

  get height(): number {
    return this.screen.height;
  }

  get ctx(): CanvasRenderingContext2D {
    return this.screen.bufferCtx;
  }

  clear(color: Color): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  rect(x: number, y: number, w: number, h: number, color: Color): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  /** 채운 원. 반지름은 정수 픽셀, 중심은 (cx, cy) 픽셀 칸의 가운데 */
  disc(cx: number, cy: number, radius: number, color: Color): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    for (let dy = -radius; dy <= radius; dy++) {
      const dx = Math.floor(Math.sqrt(radius * radius + radius - dy * dy + 0.25));
      this.rect(cx - dx, cy + dy, dx * 2 + 1, 1, color);
    }
  }

  /** fn 안에서 그리는 것을 (x, y, w, h) 영역 기준 180도 돌려 그린다(위쪽 플레이어용). 정수 픽셀 격자가 유지된다. */
  rotated180(x: number, y: number, w: number, h: number, fn: () => void): void {
    this.ctx.save();
    this.ctx.transform(-1, 0, 0, -1, Math.round(2 * x + w), Math.round(2 * y + h));
    fn();
    this.ctx.restore();
  }

  /** 1px 테두리만 있는 사각형 */
  frame(x: number, y: number, w: number, h: number, color: Color): void {
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    this.rect(x, y, w, 1, color);
    this.rect(x, y + h - 1, w, 1, color);
    this.rect(x, y + 1, 1, h - 2, color);
    this.rect(x + w - 1, y + 1, 1, h - 2, color);
  }

  /** (x, y)는 정렬 기준점의 위쪽. align='center'면 x가 글자 가운데. */
  text(str: string, x: number, y: number, color: Color, align: TextAlign = 'left'): void {
    let left = x;
    if (align !== 'left') {
      const w = this.font.measure(str);
      left = align === 'center' ? x - Math.floor(w / 2) : x - w;
    }
    this.font.draw(this.ctx, str, left, y, color);
  }

  textWidth(str: string): number {
    return this.font.measure(str);
  }
}
