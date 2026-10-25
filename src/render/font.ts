import { hexToRgb, type Color } from './palette';
import { createCanvas, get2d } from './canvas';

const FAMILY = 'Galmuri7';
/** Galmuri7은 8px 격자로 설계된 폰트라 8px에서 글자 획이 기준 픽셀에 정확히 맞는다. */
export const FONT_SIZE = 8;
/** 줄 간격(어센트 8 + 디센트 1 + 여백 1) */
export const LINE_HEIGHT = 10;
// 일부 글리프가 em 상자 밖으로 나가도 잘리지 않게 두는 여백
const PAD = 2;
/** bitmap()이 글자 칸 바깥에 두는 여백 */
export const FONT_PAD = PAD;
const CACHE_LIMIT = 256;

/**
 * 안티앨리어싱으로 생긴 반투명 픽셀을 없앤다: 알파 50% 이상은 지정 색 불투명, 나머지는 투명.
 * 결과에는 팔레트 색 한 가지와 투명만 남는다.
 */
export function binarizeAlpha(data: Uint8ClampedArray, rgb: readonly [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 128) {
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    } else {
      data[i + 3] = 0;
    }
  }
}

/** 한글 픽셀 폰트. 문자열·색 조합마다 한 번 래스터화해 캐시한 뒤 그대로 찍는다. */
export class PixelFont {
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private readonly measureCtx = get2d(createCanvas(1, 1));

  /** 폰트를 내려받는다. 실패해도 게임은 계속 동작해야 하므로 예외를 던지지 않는다. */
  async load(url: string): Promise<void> {
    try {
      const face = new FontFace(FAMILY, `url(${url})`);
      await face.load();
      document.fonts.add(face);
    } catch (err) {
      console.warn('픽셀 폰트를 불러오지 못했습니다', err);
    }
    this.cache.clear();
  }

  measure(text: string): number {
    this.measureCtx.font = `${FONT_SIZE}px ${FAMILY}`;
    return Math.ceil(this.measureCtx.measureText(text).width);
  }

  /** (x, y)는 글자 칸의 왼쪽 위. y에서 FONT_SIZE 아래가 기준선이다. */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: Color): void {
    if (!text) return;
    const bitmap = this.bitmap(text, color);
    ctx.drawImage(bitmap, Math.round(x) - PAD, Math.round(y) - PAD);
  }

  /** 글자 그림(둘레에 FONT_PAD 여백). 한 번 그린 것은 캐시한다. */
  bitmap(text: string, color: Color): HTMLCanvasElement {
    const key = `${color}|${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const canvas = createCanvas(this.measure(text) + PAD * 2, LINE_HEIGHT + PAD * 2);
    const ctx = get2d(canvas);
    ctx.font = `${FONT_SIZE}px ${FAMILY}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, PAD, PAD + FONT_SIZE);

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    binarizeAlpha(img.data, hexToRgb(color));
    ctx.putImageData(img, 0, 0);

    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, canvas);
    return canvas;
  }
}
