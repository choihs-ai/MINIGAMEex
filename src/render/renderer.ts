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

  private get ctx(): CanvasRenderingContext2D {
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
