import type { Scene } from '../core/scene';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';

// 프레임별 표시 시간(초): 세로 폰 → 가로 폰(진영 4색이 켜짐)
const FRAME_TIMES = [1.0, 0.8];
const ARC_RADIUS = 26;

/** 폰을 세로로 들었을 때 보여주는 "가로로 돌려주세요" 화면. 버퍼는 180×320(세로)이다. */
export class RotateNotice implements Scene {
  private t = 0;

  update(dt: number): void {
    this.t = (this.t + dt) % (FRAME_TIMES[0] + FRAME_TIMES[1]);
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const cx = Math.floor(r.width / 2);
    const cy = Math.floor(r.height / 2) - 14;

    if (this.t < FRAME_TIMES[0]) {
      drawPhone(r, cx, cy, false);
      drawTurnArrow(r, cx, cy);
    } else {
      drawPhone(r, cx, cy, true);
    }
    r.text('가로로 돌려주세요', cx, cy + ARC_RADIUS + 20, PAL.text, 'center');
  }
}

/** 폰 그림. 가로일 때는 화면에 진영 4색(좌상 빨강·우상 파랑·좌하 노랑·우하 초록)이 켜진다. */
function drawPhone(r: Renderer, cx: number, cy: number, landscape: boolean): void {
  // 가로 기준 39×21, 화면 31×15(진영 칸 15×7 네 개 + 1px 구분선)
  const w = landscape ? 39 : 21;
  const h = landscape ? 21 : 39;
  const x = cx - Math.floor(w / 2);
  const y = cy - Math.floor(h / 2);

  r.rect(x, y, w, h, PAL.line);
  r.rect(x + 1, y + 1, w - 2, h - 2, PAL.bgMid);
  r.rect(x + 1, y + h - 2, w - 2, 1, PAL.line); // 아래쪽 그림자

  const sx = x + (landscape ? 4 : 3);
  const sy = y + (landscape ? 3 : 4);
  const sw = landscape ? 31 : 15;
  const sh = landscape ? 15 : 31;
  r.rect(sx, sy, sw, sh, PAL.line);
  // 스피커 구멍
  if (landscape) r.rect(x + 2, cy - 2, 1, 5, PAL.bgDark);
  else r.rect(cx - 2, y + 2, 5, 1, PAL.bgDark);

  if (!landscape) {
    r.rect(sx, sy, sw, sh, PAL.bgDark);
    return;
  }
  for (let seat = 0; seat < 4; seat++) {
    const qx = sx + (seat % 2) * 16;
    const qy = sy + Math.floor(seat / 2) * 8;
    const { base, shadow } = SEAT_COLORS[seat];
    r.rect(qx, qy, 15, 7, base);
    r.rect(qx, qy + 6, 15, 1, shadow);
  }
}

/** 폰 위에서 오른쪽으로 도는 1/4 원 화살표(시계 방향). 중점 원 알고리즘으로 찍는다. */
function drawTurnArrow(r: Renderer, cx: number, cy: number): void {
  let x = 0;
  let y = ARC_RADIUS;
  let d = 1 - ARC_RADIUS;
  while (x <= y) {
    // 12시~3시 사이 두 옥탄트
    r.rect(cx + x, cy - y, 1, 1, PAL.text);
    r.rect(cx + y, cy - x, 1, 1, PAL.text);
    x++;
    if (d < 0) {
      d += 2 * x + 1;
    } else {
      y--;
      d += 2 * (x - y) + 1;
    }
  }
  // 3시 방향 끝의 아래쪽 화살촉
  const ax = cx + ARC_RADIUS;
  r.rect(ax - 2, cy, 5, 1, PAL.text);
  r.rect(ax - 1, cy + 1, 3, 1, PAL.text);
  r.rect(ax, cy + 2, 1, 1, PAL.text);
}
