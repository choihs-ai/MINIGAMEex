import { Grid } from '../render/grid';
import { PAL, type Color } from '../render/palette';

// 큰 버튼 가운데 새기는 작은 그림: 숫자(보기 번호·개수), 화살표 등.

/** 3×5 숫자 글꼴 */
const DIGITS: Readonly<Record<string, string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  v: ['...', '..#', '#.#', '.#.', '...'],
  x: ['#.#', '.#.', '.#.', '.#.', '#.#'],
  '?': ['###', '..#', '.##', '...', '.#.'],
};

const cache = new Map<string, HTMLCanvasElement>();

/** 숫자·기호 글자를 2배 크기 픽셀로(외곽선 포함) */
export function glyphIcon(text: string, color: Color = PAL.text): HTMLCanvasElement {
  const key = `${text}|${color}`;
  let c = cache.get(key);
  if (c) return c;
  const chars = [...text];
  const g = new Grid(chars.length * 8 + 2, 12);
  chars.forEach((ch, k) => {
    const rows = DIGITS[ch] ?? DIGITS['-'];
    rows.forEach((row, y) =>
      [...row].forEach((v, x) => {
        if (v === '#') g.rect(1 + k * 8 + x * 2, 1 + y * 2, 2, 2, color);
      }),
    );
  });
  g.outline(PAL.line);
  c = g.toCanvas();
  cache.set(key, c);
  return c;
}
