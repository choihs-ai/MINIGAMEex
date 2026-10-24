import type { Scene } from '../core/scene';
import { LINE_HEIGHT } from '../render/font';
import { PAL, SEAT_COLORS, type Color } from '../render/palette';
import type { Renderer } from '../render/renderer';
import type { Screen } from '../render/screen';

const SWATCHES: readonly Color[] = Object.values(PAL);
const TRACK_X = 76;
const TRACK_W = 168;

/**
 * 1단계 확인용 화면: 진영 위치·색, 팔레트, 픽셀 폰트, 정수배 확대(1px 체크무늬),
 * 고정 간격 루프(움직이는 블록·fps)를 한눈에 본다. 2단계에서 실제 로비로 대체된다.
 */
export class RenderTestScene implements Scene {
  private ticks = 0;
  private fps = 0;
  private frames = 0;
  private fpsSince = performance.now();

  constructor(private readonly screen: Screen) {}

  update(): void {
    this.ticks++;
  }

  render(r: Renderer): void {
    this.countFps();
    r.clear(PAL.bgDark);

    for (let seat = 0; seat < 4; seat++) drawSeatPanel(r, seat);

    const cx = Math.floor(r.width / 2);
    r.text('4인용게임EX', cx, 22, PAL.text, 'center');
    r.text('1단계 · 렌더러 테스트', cx, 34, PAL.yellow, 'center');

    const samples = ['다람쥐 헌 쳇바퀴에 타고파', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz 0123456789'];
    samples.forEach((line, i) => r.text(line, cx, 52 + i * LINE_HEIGHT, PAL.text, 'center'));

    // 팔레트 12색
    SWATCHES.forEach((color, i) => {
      const x = TRACK_X + i * 14;
      r.rect(x, 88, 12, 12, PAL.line);
      r.rect(x + 1, 89, 10, 10, color);
    });

    // 1px 체크무늬·줄무늬: 확대 배율이 정수가 아니면 무늬가 고르지 않게 보인다.
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 24; x++) {
        if ((x + y) % 2 === 0) r.rect(TRACK_X + x, 108 + y, 1, 1, PAL.text);
        if (x % 2 === 0) r.rect(TRACK_X + 30 + x, 108 + y, 1, 1, PAL.text);
      }
    }
    r.text(`배율 ×${this.screen.layout.scale} · ${this.fps}fps`, TRACK_X + TRACK_W, 110, PAL.text, 'right');

    // 고정 간격(60Hz) 갱신 확인용 블록: 1틱에 1px씩 왕복
    const span = TRACK_W - 8;
    const p = this.ticks % (span * 2);
    const bx = TRACK_X + (p < span ? p : span * 2 - p);
    r.rect(TRACK_X, 136, TRACK_W, 1, PAL.bgMid);
    r.rect(bx, 128, 8, 8, PAL.line);
    r.rect(bx + 1, 129, 6, 5, PAL.red);
    r.rect(bx + 1, 134, 6, 1, PAL.redShadow);
  }

  private countFps(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.fpsSince >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsSince));
      this.frames = 0;
      this.fpsSince = now;
    }
  }
}

/** 네 모서리 진영 표시(1P 좌상 빨강, 2P 우상 파랑, 3P 좌하 노랑, 4P 우하 초록) */
function drawSeatPanel(r: Renderer, seat: number): void {
  const w = 40;
  const h = 20;
  const x = seat % 2 === 0 ? 4 : r.width - 4 - w;
  const y = seat < 2 ? 4 : r.height - 4 - h;
  const { base, shadow } = SEAT_COLORS[seat];
  r.frame(x, y, w, h, base);
  r.text(`${seat + 1}P`, x + 5, y + 6, base);
  // 기본색 + 그림자색 2단 칩
  r.rect(x + w - 15, y + 5, 10, 10, PAL.line);
  r.rect(x + w - 14, y + 6, 8, 6, base);
  r.rect(x + w - 14, y + 12, 8, 2, shadow);
}
