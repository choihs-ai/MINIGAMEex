import { createCanvas, get2d } from './canvas';
import type { Color } from './palette';

/** 픽셀 그림을 코드로 그리기 위한 작은 격자. 도형을 칠한 뒤 outline()으로 1px 외곽선을 두른다. */
export class Grid {
  private readonly cells: (Color | null)[];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = new Array<Color | null>(w * h).fill(null);
  }

  get(x: number, y: number): Color | null {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.cells[y * this.w + x];
  }

  set(x: number, y: number, c: Color | null): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y * this.w + x] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** 두 점 사이를 1px 선으로 잇는다(브레즌햄). thickness>1이면 가로로 두껍게. */
  line(x0: number, y0: number, x1: number, y1: number, c: Color, thickness = 1): void {
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
      for (let t = 0; t < thickness; t++) this.set(x0 + t, y0, c);
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

  /**
   * 타원을 칠한다. 색은 픽셀마다 colorAt(nx, ny)로 정하고, null이면 그 픽셀은 칠하지 않는다.
   * nx, ny는 중심 기준 -1~1로 정규화한 위치(위쪽·왼쪽이 음수).
   */
  ellipseWith(cx: number, cy: number, rx: number, ry: number, colorAt: (nx: number, ny: number) => Color | null): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const c = colorAt(nx, ny);
        if (c) this.set(x, y, c);
      }
    }
  }

  /** 기본색으로 칠하고 오른쪽 아래만 그림자색(2단계 음영) */
  ellipse(cx: number, cy: number, rx: number, ry: number, base: Color, shadow: Color = base): void {
    this.ellipseWith(cx, cy, rx, ry, (nx, ny) => (ny * 0.7 + nx * 0.45 > 0.4 ? shadow : base));
  }

  /** 타원의 안쪽 가장자리만 thickness px 띠로 칠한다. */
  ellipseRing(cx: number, cy: number, rx: number, ry: number, thickness: number, c: Color): void {
    const irx = rx - thickness;
    const iry = ry - thickness;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const outer = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
        const inner = irx > 0 && iry > 0 && ((x + 0.5 - cx) / irx) ** 2 + ((y + 0.5 - cy) / iry) ** 2 <= 1;
        if (outer && !inner) this.set(x, y, c);
      }
    }
  }

  /** 색이 있는 픽셀의 상하좌우 빈 칸에 1px 외곽선을 두른다. */
  outline(c: Color): void {
    const edge: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) edge.push(y * this.w + x);
      }
    }
    for (const i of edge) this.cells[i] = c;
  }

  toCanvas(): HTMLCanvasElement {
    const canvas = createCanvas(this.w, this.h);
    const ctx = get2d(canvas);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.cells[y * this.w + x];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return canvas;
  }
}
