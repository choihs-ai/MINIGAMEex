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
  // 밧줄: 꼬인 줄과 가운데 매듭
  G02: (g) => {
    for (let x = 0; x < 16; x++) {
      g.set(x, 7, x % 3 === 0 ? PAL.yellowShadow : PAL.yellow);
      g.set(x, 8, x % 3 === 1 ? PAL.yellowShadow : PAL.yellow);
    }
    g.ellipse(8, 8, 3, 3, PAL.red, PAL.redShadow);
  },
  // 블록 셋을 어긋나게 쌓은 탑
  G14: (g) => {
    g.rect(2, 11, 11, 4, PAL.red);
    g.rect(2, 14, 11, 1, PAL.redShadow);
    g.rect(4, 7, 11, 4, PAL.blue);
    g.rect(4, 10, 11, 1, PAL.blueShadow);
    g.rect(1, 3, 11, 4, PAL.yellow);
    g.rect(1, 6, 11, 1, PAL.yellowShadow);
  },
  // 줄넘기: 손잡이 둘과 아래로 처진 줄
  G28: (g) => {
    for (let x = 3; x <= 12; x++) {
      const y = Math.round(4 + 10 * Math.sin((Math.PI * (x - 3)) / 9));
      g.set(x, Math.min(14, y), PAL.text);
    }
    g.rect(1, 2, 2, 5, PAL.red);
    g.rect(13, 2, 2, 5, PAL.red);
  },
  // 회전판과 레이저
  G30: (g) => {
    g.ellipse(8, 8, 7, 7, PAL.bgMid);
    g.line(8, 8, 14, 3, PAL.text);
    g.line(8, 9, 14, 4, PAL.text);
    g.rect(7, 7, 2, 2, PAL.text);
    g.rect(3, 10, 2, 2, PAL.red);
  },
  // 위로 갈수록 좁아지는 판 더미
  G50: (g) => {
    g.rect(1, 12, 14, 3, PAL.green);
    g.rect(1, 14, 14, 1, PAL.greenShadow);
    g.rect(3, 8, 11, 3, PAL.yellow);
    g.rect(3, 10, 11, 1, PAL.yellowShadow);
    g.rect(4, 4, 8, 3, PAL.green);
    g.rect(4, 6, 8, 1, PAL.greenShadow);
    g.rect(5, 1, 5, 2, PAL.yellow);
  },
  // 북과 북채
  G51: (g) => {
    g.rect(2, 7, 12, 7, PAL.red);
    g.rect(2, 12, 12, 2, PAL.redShadow);
    for (let x = 3; x < 14; x += 3) g.rect(x, 8, 1, 5, PAL.yellow);
    g.ellipse(8, 6.5, 6, 2, PAL.text);
    g.line(2, 0, 7, 5, PAL.yellowShadow);
    g.line(13, 0, 9, 5, PAL.yellowShadow);
  },
  // 스톱워치
  G52: (g) => {
    g.rect(7, 0, 2, 2, PAL.bgMid);
    g.ellipse(8, 9, 6.5, 6.5, PAL.text, PAL.bgMid);
    g.line(8, 9, 8, 5, PAL.red);
    g.line(8, 9, 11, 9, PAL.line);
  },
  // 낚싯대, 줄, 찌, 물결
  G53: (g) => {
    g.line(1, 1, 10, 5, PAL.yellowShadow);
    g.line(10, 5, 10, 10, PAL.text);
    g.rect(9, 10, 3, 2, PAL.red);
    g.rect(9, 12, 3, 1, PAL.text);
    for (let x = 0; x < 16; x += 4) g.rect(x, 14, 2, 1, PAL.blue);
  },
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
