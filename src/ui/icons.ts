import { Grid } from '../render/grid';
import { PAL } from '../render/palette';

// 미니게임 아이콘 16×16. 이모지·아이콘 폰트 대신 코드로 직접 찍는다.
type IconDraw = (g: Grid) => void;

/** 5각 별: 픽셀 중심이 별 다각형 안에 있으면 칠한다 */
function star(g: Grid, cx: number, cy: number, outer: number, inner: number): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? outer : inner;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) g.set(x, y, (px - cx) * 0.45 + (py - cy) * 0.7 > 1.6 ? PAL.yellowShadow : PAL.yellow);
    }
  }
}

const ICONS: Readonly<Record<string, IconDraw>> = {
  // 팽이(옆모습): 손잡이 + 넓은 몸통 + 뾰족한 아래
  G01: (g) => {
    g.rect(7, 1, 2, 3, PAL.bgMid);
    g.ellipse(8, 6.5, 7, 3, PAL.red, PAL.redShadow);
    g.rect(1, 6, 14, 1, PAL.yellow);
    for (let y = 9; y <= 14; y++) {
      const half = Math.max(0, Math.round((6 * (14 - y)) / 5));
      g.rect(8 - half, y, half * 2, 1, y > 11 ? PAL.redShadow : PAL.red);
    }
    g.set(7, 15, PAL.bgMid);
    g.set(8, 15, PAL.bgMid);
  },
  // 교차한 칼
  G19: (g) => {
    g.line(2, 1, 11, 10, PAL.text);
    g.line(13, 1, 4, 10, PAL.text);
    g.line(9, 13, 13, 9, PAL.yellow);
    g.line(2, 9, 6, 13, PAL.yellow);
    g.line(12, 12, 14, 14, PAL.bgMid);
    g.line(3, 12, 1, 14, PAL.bgMid);
  },
  // 별
  G22: (g) => star(g, 8, 8.6, 7.6, 3.2),
};

const cache = new Map<string, HTMLCanvasElement>();

export const ICON_SIZE = 16;

export function gameIcon(code: string): HTMLCanvasElement {
  let icon = cache.get(code);
  if (!icon) {
    const g = new Grid(ICON_SIZE, ICON_SIZE);
    ICONS[code]?.(g);
    g.outline(PAL.line);
    icon = g.toCanvas();
    cache.set(code, icon);
  }
  return icon;
}
