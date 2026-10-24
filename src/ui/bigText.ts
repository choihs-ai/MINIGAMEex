import { PAL, type Color } from '../render/palette';
import type { Renderer } from '../render/renderer';

// 8px 폰트로는 크기를 못 키우므로(픽셀 크기 통일), 큰 글자는 같은 픽셀 단위로 따로 그린다.
// 숫자는 7세그먼트 방식, 영문은 굵은 직선 글리프.

const SEGMENTS: Readonly<Record<string, string>> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

export interface DigitSize {
  w: number;
  h: number;
  /** 획 두께 */
  t: number;
  /** 숫자 사이 간격 */
  gap: number;
}

export const DIGIT_SMALL: DigitSize = { w: 7, h: 11, t: 2, gap: 2 };
export const DIGIT_BIG: DigitSize = { w: 24, h: 40, t: 6, gap: 4 };

function segRects(s: string, x: number, y: number, { w, h, t }: DigitSize): Array<[number, number, number, number]> {
  const mid = y + Math.floor((h - t) / 2);
  const out: Array<[number, number, number, number]> = [];
  if (s.includes('a')) out.push([x + t, y, w - 2 * t, t]);
  if (s.includes('d')) out.push([x + t, y + h - t, w - 2 * t, t]);
  if (s.includes('g')) out.push([x + t, mid, w - 2 * t, t]);
  if (s.includes('f')) out.push([x, y, t, mid - y + t]);
  if (s.includes('b')) out.push([x + w - t, y, t, mid - y + t]);
  if (s.includes('e')) out.push([x, mid, t, y + h - mid]);
  if (s.includes('c')) out.push([x + w - t, mid, t, y + h - mid]);
  return out;
}

export function numberWidth(text: string, size: DigitSize): number {
  return text.length * size.w + (text.length - 1) * size.gap;
}

/** 7세그 숫자. shadow를 주면 오른쪽 아래 1px 그림자를 깐다. ghost면 꺼진 세그먼트를 어둡게 보여준다. */
export function drawNumber(
  r: Renderer,
  text: string,
  x: number,
  y: number,
  size: DigitSize,
  color: Color,
  opts: { shadow?: Color; ghost?: boolean; align?: 'left' | 'center' | 'right' } = {},
): void {
  const total = numberWidth(text, size);
  let left = x;
  if (opts.align === 'center') left = x - Math.floor(total / 2);
  else if (opts.align === 'right') left = x - total;
  [...text].forEach((ch, i) => {
    const dx = left + i * (size.w + size.gap);
    if (opts.ghost) for (const q of segRects('abcdefg', dx, y, size)) r.rect(...q, PAL.bgMid);
    const lit = segRects(SEGMENTS[ch] ?? '', dx, y, size);
    if (opts.shadow) for (const [qx, qy, qw, qh] of lit) r.rect(qx + 1, qy + 1, qw, qh, opts.shadow);
    for (const q of lit) r.rect(...q, color);
  });
}

type GlyphRect = readonly [number, number, number, number];
interface Glyph {
  w: number;
  rects: readonly GlyphRect[];
}

/** 높이 15, 획 3. 필요한 글자만 정의한다(WIN, GO!). */
const GLYPHS: Readonly<Record<string, Glyph>> = {
  I: { w: 9, rects: [[0, 0, 9, 3], [3, 3, 3, 9], [0, 12, 9, 3]] },
  N: { w: 11, rects: [[0, 0, 3, 15], [8, 0, 3, 15], [3, 3, 2, 3], [4, 6, 3, 3], [6, 9, 2, 3]] },
  W: { w: 15, rects: [[0, 0, 3, 15], [12, 0, 3, 15], [6, 6, 3, 9], [3, 12, 3, 3], [9, 12, 3, 3]] },
  G: { w: 11, rects: [[0, 0, 11, 3], [0, 3, 3, 9], [0, 12, 11, 3], [8, 7, 3, 5], [5, 7, 6, 3]] },
  O: { w: 11, rects: [[0, 0, 11, 3], [0, 3, 3, 9], [8, 3, 3, 9], [0, 12, 11, 3]] },
  '!': { w: 3, rects: [[0, 0, 3, 10], [0, 12, 3, 3]] },
};
export const WORD_HEIGHT = 15;
const WORD_GAP = 3;

export function wordWidth(text: string): number {
  return [...text].reduce((n, ch, i) => n + (GLYPHS[ch]?.w ?? 0) + (i > 0 ? WORD_GAP : 0), 0);
}

export function drawWord(
  r: Renderer,
  text: string,
  x: number,
  y: number,
  color: Color,
  opts: { shadow?: Color; align?: 'left' | 'center' } = {},
): void {
  let cx = opts.align === 'center' ? x - Math.floor(wordWidth(text) / 2) : x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    if (opts.shadow) for (const [gx, gy, gw, gh] of glyph.rects) r.rect(cx + gx + 1, y + gy + 1, gw, gh, opts.shadow);
    for (const [gx, gy, gw, gh] of glyph.rects) r.rect(cx + gx, y + gy, gw, gh, color);
    cx += glyph.w + WORD_GAP;
  }
}
