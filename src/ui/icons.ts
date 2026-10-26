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
  // 폭탄과 불붙은 심지
  G03: (g) => {
    g.ellipse(7, 10, 5.5, 5.5, PAL.bgMid, PAL.line);
    g.rect(6, 3, 3, 2, PAL.bgMid);
    g.line(8, 2, 11, 0, PAL.yellowShadow);
    g.rect(12, 0, 2, 2, PAL.yellow);
    g.rect(4, 7, 2, 2, PAL.text);
  },
  // 옆에서 본 우주선
  G08: (g) => {
    g.rect(2, 7, 11, 3, PAL.red);
    g.rect(3, 10, 9, 1, PAL.redShadow);
    g.rect(13, 8, 2, 1, PAL.red);
    g.rect(7, 5, 4, 2, PAL.text);
    g.rect(3, 4, 3, 3, PAL.red);
    g.rect(3, 11, 3, 2, PAL.redShadow);
    g.rect(0, 7, 2, 1, PAL.yellow);
    g.rect(0, 9, 2, 1, PAL.yellow);
    g.rect(13, 12, 2, 1, PAL.blue);
  },
  // 구멍에서 나온 두더지
  G11: (g) => {
    g.ellipse(8, 8, 5.5, 6.5, PAL.redShadow, PAL.line);
    g.ellipse(8, 8, 2.5, 1.5, PAL.text);
    g.rect(7, 6, 2, 1, PAL.red);
    g.rect(5, 4, 1, 2, PAL.line);
    g.rect(10, 4, 1, 2, PAL.line);
    g.rect(1, 13, 14, 3, PAL.greenShadow);
  },
  // 네 가지 색 칸
  G21: (g) => {
    g.rect(1, 1, 7, 7, PAL.red);
    g.rect(8, 1, 7, 7, PAL.blue);
    g.rect(1, 8, 7, 7, PAL.yellow);
    g.rect(8, 8, 7, 7, PAL.green);
    g.rect(5, 5, 6, 6, PAL.line);
    g.rect(6, 7, 1, 3, PAL.text);
    g.rect(9, 7, 1, 3, PAL.text);
    g.rect(7, 9, 2, 1, PAL.text);
  },
  // 풍선 두 개
  G23: (g) => {
    g.ellipse(5.5, 5.5, 4, 4.5, PAL.red, PAL.redShadow);
    g.ellipse(11, 7, 3.5, 4, PAL.blue, PAL.blueShadow);
    g.line(5, 10, 7, 15, PAL.bgMid);
    g.line(11, 11, 9, 15, PAL.bgMid);
    g.rect(4, 3, 1, 1, PAL.text);
  },
  // 구슬 셋
  G24: (g) => {
    g.ellipse(5, 10, 3.5, 3.5, PAL.red, PAL.redShadow);
    g.ellipse(11, 11, 3.5, 3.5, PAL.green, PAL.greenShadow);
    g.ellipse(9, 4, 3.5, 3.5, PAL.blue, PAL.blueShadow);
    g.rect(4, 9, 1, 1, PAL.text);
    g.rect(8, 3, 1, 1, PAL.text);
  },
  // 컬링 돌
  G25: (g) => {
    g.ellipse(8, 10, 7, 4.5, PAL.bgMid, PAL.line);
    g.ellipse(8, 9, 4, 2.5, PAL.yellow, PAL.yellowShadow);
    g.rect(7, 4, 2, 4, PAL.yellow);
    g.rect(7, 3, 6, 2, PAL.yellow);
  },
  // 꺾여 가는 뱀 꼬리
  G26: (g) => {
    g.rect(1, 13, 8, 2, PAL.greenShadow);
    g.rect(7, 6, 2, 8, PAL.greenShadow);
    g.rect(7, 5, 7, 2, PAL.green);
    g.rect(12, 1, 2, 5, PAL.green);
    g.rect(11, 0, 4, 2, PAL.green);
    g.rect(12, 0, 1, 1, PAL.line);
  },
  // 위에서 본 탱크
  G27: (g) => {
    g.rect(2, 3, 12, 2, PAL.bgMid);
    g.rect(2, 11, 12, 2, PAL.bgMid);
    g.rect(3, 5, 10, 6, PAL.green);
    g.rect(3, 9, 10, 2, PAL.greenShadow);
    g.ellipse(7, 8, 2.5, 2.5, PAL.greenShadow);
    g.rect(8, 7, 8, 2, PAL.text);
  },
  // 체크무늬 깃발
  G29: (g) => {
    g.rect(2, 1, 1, 15, PAL.bgMid);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) g.rect(3 + x * 2, 1 + y * 2, 2, 2, (x + y) % 2 === 0 ? PAL.text : PAL.line);
  },
  // 쇼핑 봉투
  G54: (g) => {
    g.rect(2, 5, 12, 10, PAL.yellow);
    g.rect(2, 13, 12, 2, PAL.yellowShadow);
    g.rect(5, 1, 1, 5, PAL.bgMid);
    g.rect(10, 1, 1, 5, PAL.bgMid);
    g.rect(5, 1, 6, 1, PAL.bgMid);
    g.rect(4, 3, 3, 3, PAL.red);
    g.rect(9, 2, 3, 4, PAL.green);
  },
  // 좀비 손
  G57: (g) => {
    g.rect(4, 6, 8, 7, PAL.green);
    g.rect(4, 11, 8, 2, PAL.greenShadow);
    for (const x of [4, 6, 8, 10]) g.rect(x, x === 4 || x === 10 ? 3 : 1, 2, 5, PAL.green);
    g.rect(1, 8, 3, 2, PAL.green);
    g.rect(5, 13, 6, 3, PAL.bgMid);
    g.rect(7, 8, 1, 1, PAL.redShadow);
  },
  // 칠한 바닥과 붓
  G04: (g) => {
    g.rect(0, 9, 8, 7, PAL.red);
    g.rect(8, 9, 8, 7, PAL.blue);
    g.rect(0, 2, 8, 7, PAL.yellow);
    g.line(9, 7, 14, 1, PAL.yellowShadow, 2);
    g.rect(7, 6, 3, 3, PAL.text);
  },
  // 물음표 폭탄
  G06: (g) => {
    g.ellipse(7, 10, 5.5, 5.5, PAL.bgMid, PAL.line);
    g.line(8, 3, 11, 0, PAL.yellowShadow);
    g.rect(12, 0, 2, 2, PAL.red);
    g.rect(5, 7, 4, 1, PAL.yellow);
    g.rect(8, 8, 1, 2, PAL.yellow);
    g.rect(6, 10, 2, 1, PAL.yellow);
    g.rect(6, 12, 2, 1, PAL.yellow);
  },
  // 경매 망치와 보석
  G07: (g) => {
    g.rect(2, 2, 8, 4, PAL.yellowShadow);
    g.line(6, 6, 12, 12, PAL.yellowShadow, 2);
    g.ellipse(4, 12, 3, 2.5, PAL.green, PAL.greenShadow);
  },
  // 말렛과 퍽
  G12: (g) => {
    g.ellipse(6, 9, 5, 5, PAL.red, PAL.redShadow);
    g.ellipse(6, 9, 2, 2, PAL.text);
    g.ellipse(13, 4, 2, 2, PAL.text);
    g.rect(0, 15, 16, 1, PAL.blue);
  },
  // 흩어진 도형과 물음표
  G16: (g) => {
    g.ellipse(3, 3, 2, 2, PAL.red);
    g.rect(9, 2, 4, 4, PAL.blue);
    g.ellipse(4, 11, 2, 2, PAL.red);
    g.rect(10, 9, 3, 1, PAL.yellow);
    g.rect(12, 10, 1, 2, PAL.yellow);
    g.rect(11, 12, 1, 1, PAL.yellow);
    g.rect(11, 14, 1, 1, PAL.yellow);
  },
  // 네 칸 램프
  G18: (g) => {
    g.rect(1, 1, 6, 6, PAL.red);
    g.rect(9, 1, 6, 6, PAL.blueShadow);
    g.rect(1, 9, 6, 6, PAL.yellowShadow);
    g.rect(9, 9, 6, 6, PAL.green);
  },
  // 삽과 보물 상자
  G31: (g) => {
    g.rect(1, 9, 9, 6, PAL.redShadow);
    g.rect(1, 7, 9, 3, PAL.red);
    g.rect(5, 9, 1, 2, PAL.yellow);
    g.line(14, 0, 10, 8, PAL.yellowShadow);
    g.rect(9, 8, 3, 3, PAL.bgMid);
  },
  // 상자 셋 중 하나가 펑
  G32: (g) => {
    g.rect(0, 8, 5, 6, PAL.yellow);
    g.rect(11, 8, 5, 6, PAL.yellow);
    g.ellipse(8, 7, 4, 4, PAL.red, PAL.redShadow);
    g.ellipse(8, 7, 2, 2, PAL.yellow);
  },
  // 나눌까 가질까: 동전 둘
  G33: (g) => {
    g.ellipse(4.5, 8, 3.5, 3.5, PAL.yellow, PAL.yellowShadow);
    g.ellipse(11.5, 8, 3.5, 3.5, PAL.yellow, PAL.yellowShadow);
    g.rect(7, 2, 2, 12, PAL.red);
  },
  // 뒤집힌 카드 둘
  G35: (g) => {
    g.rect(1, 2, 6, 10, PAL.blue);
    g.rect(2, 3, 4, 8, PAL.blueShadow);
    g.rect(9, 4, 6, 10, PAL.text);
    g.ellipse(12, 9, 2, 2, PAL.red);
  },
  // 물건 사이 빈칸 물음표
  G36: (g) => {
    g.rect(1, 3, 4, 4, PAL.green);
    g.rect(11, 3, 4, 4, PAL.red);
    g.rect(1, 10, 4, 4, PAL.blue);
    g.rect(10, 9, 4, 1, PAL.yellow);
    g.rect(13, 10, 1, 2, PAL.yellow);
    g.rect(11, 12, 2, 1, PAL.yellow);
    g.rect(11, 14, 1, 1, PAL.yellow);
  },
  // 미로
  G37: (g) => {
    g.rect(0, 0, 16, 1, PAL.text);
    g.rect(0, 15, 16, 1, PAL.text);
    g.rect(0, 0, 1, 16, PAL.text);
    g.rect(15, 0, 1, 16, PAL.text);
    g.rect(4, 0, 1, 10, PAL.text);
    g.rect(8, 5, 1, 11, PAL.text);
    g.rect(12, 0, 1, 10, PAL.text);
    g.rect(2, 12, 2, 2, PAL.yellow);
  },
  // 쟁반 위 구슬
  G39: (g) => {
    g.ellipse(8, 11, 7.5, 3, PAL.bgMid, PAL.line);
    g.ellipse(9, 7, 2.5, 2.5, PAL.text);
  },
  // 마이크
  G40: (g) => {
    g.ellipse(8, 5, 4, 4.5, PAL.bgMid, PAL.line);
    g.rect(7, 9, 2, 5, PAL.text);
    g.rect(4, 14, 8, 1, PAL.text);
    g.line(13, 2, 15, 0, PAL.yellow);
    g.line(13, 6, 15, 6, PAL.yellow);
  },
  // 길이가 다른 막대 넷(순서)
  G41: (g) => {
    g.rect(1, 12, 3, 3, PAL.red);
    g.rect(5, 9, 3, 6, PAL.blue);
    g.rect(9, 6, 3, 9, PAL.yellow);
    g.rect(13, 2, 3, 13, PAL.green);
  },
  // 어둠 속 빛과 보석
  G45: (g) => {
    g.rect(0, 0, 16, 16, PAL.line);
    g.ellipse(8, 8, 6, 6, PAL.bgMid);
    g.rect(7, 5, 2, 6, PAL.yellow);
    g.rect(5, 7, 6, 2, PAL.yellow);
  },
  // 원 위의 손가락들
  G46: (g) => {
    g.ellipse(3.5, 4, 3, 3, PAL.red);
    g.ellipse(12, 4, 3, 3, PAL.blue);
    g.ellipse(4, 12, 3, 3, PAL.green);
    g.ellipse(12, 12, 3, 3, PAL.yellow);
    g.rect(11, 11, 2, 5, PAL.text);
  },
  // 잘린 판과 공
  G49: (g) => {
    g.rect(1, 1, 14, 14, PAL.bgMid);
    g.rect(1, 1, 6, 14, PAL.green);
    g.rect(7, 0, 1, 16, PAL.yellow);
    g.ellipse(11, 8, 2, 2, PAL.text);
  },
  // 꼬리 달린 우주선
  G58: (g) => {
    g.ellipse(12, 4, 3, 3, PAL.blue, PAL.blueShadow);
    g.rect(8, 7, 2, 2, PAL.text);
    g.rect(5, 10, 2, 2, PAL.text);
    g.rect(2, 13, 2, 2, PAL.text);
  },
  // 범퍼카(위에서): 몸통 + 범퍼 + 바퀴
  G62: (g) => {
    g.rect(3, 4, 10, 9, PAL.red);
    g.rect(3, 11, 10, 2, PAL.redShadow);
    g.rect(2, 2, 12, 2, PAL.bgMid);
    g.rect(2, 13, 12, 2, PAL.bgMid);
    g.rect(5, 6, 6, 3, PAL.text);
    g.rect(1, 5, 2, 3, PAL.line);
    g.rect(13, 5, 2, 3, PAL.line);
  },
  // 닭: 몸통 + 볏 + 부리
  G63: (g) => {
    g.ellipse(8, 10, 6, 5, PAL.text, PAL.bgMid);
    g.ellipse(11, 5, 3, 3, PAL.text);
    g.rect(10, 1, 3, 2, PAL.red);
    g.rect(14, 5, 2, 1, PAL.yellow);
    g.set(11, 4, PAL.line);
    g.rect(6, 15, 1, 1, PAL.yellow);
    g.rect(9, 15, 1, 1, PAL.yellow);
  },
  // 왕관
  G64: (g) => {
    g.rect(2, 8, 12, 6, PAL.yellow);
    g.rect(2, 12, 12, 2, PAL.yellowShadow);
    g.rect(2, 4, 2, 4, PAL.yellow);
    g.rect(7, 2, 2, 6, PAL.yellow);
    g.rect(12, 4, 2, 4, PAL.yellow);
    g.rect(7, 9, 2, 2, PAL.red);
  },
  // 축구공
  G65: (g) => {
    g.ellipse(8, 8, 7, 7, PAL.text, PAL.bgMid);
    g.rect(6, 6, 4, 4, PAL.line);
    g.rect(1, 6, 2, 3, PAL.line);
    g.rect(13, 6, 2, 3, PAL.line);
    g.rect(6, 1, 4, 1, PAL.line);
    g.rect(6, 14, 4, 1, PAL.line);
  },
  // 머리 + 꼬리 마디(남의 마디를 물려는 중)
  G66: (g) => {
    g.ellipse(4, 4, 3, 3, PAL.blue, PAL.blueShadow);
    g.ellipse(9, 8, 2, 2, PAL.red);
    g.ellipse(12, 11, 2, 2, PAL.red);
    g.ellipse(14, 14, 1.5, 1.5, PAL.redShadow);
  },
  // 의자
  G67: (g) => {
    g.rect(3, 1, 2, 14, PAL.yellowShadow);
    g.rect(3, 1, 9, 2, PAL.yellow);
    g.rect(3, 8, 10, 3, PAL.yellow);
    g.rect(11, 11, 2, 4, PAL.yellowShadow);
    g.rect(3, 4, 9, 1, PAL.yellowShadow);
  },
  // 불붙은 폭탄
  G68: (g) => {
    g.ellipse(7, 10, 5.5, 5.5, PAL.bgMid, PAL.bgDark);
    g.rect(4, 7, 2, 2, PAL.text);
    g.rect(10, 3, 2, 3, PAL.yellowShadow);
    g.rect(12, 1, 2, 2, PAL.yellow);
    g.set(14, 0, PAL.red);
    g.set(11, 0, PAL.red);
  },
  // 주사위 둘
  G69: (g) => {
    g.rect(0, 5, 9, 9, PAL.text);
    g.rect(2, 7, 2, 2, PAL.line);
    g.rect(5, 10, 2, 2, PAL.line);
    g.rect(8, 1, 8, 8, PAL.red);
    g.rect(11, 4, 2, 2, PAL.text);
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
