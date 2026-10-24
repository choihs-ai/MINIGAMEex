import type { Rect } from '../input/seats';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';

/** 메뉴·결과 화면의 글자 버튼. 누르면 2px 눌린다. primary는 밝은 바탕. */
export function drawUiButton(
  r: Renderer,
  b: Rect,
  label: string,
  opts: { primary?: boolean; pressed?: boolean; disabled?: boolean } = {},
): void {
  const dy = opts.pressed ? 2 : 0;
  r.rect(b.x, b.y + 2, b.w, b.h, PAL.line);
  r.rect(b.x, b.y + dy, b.w, b.h, PAL.line);
  const fill = opts.disabled ? PAL.bgDark : opts.primary ? PAL.text : PAL.bgMid;
  r.rect(b.x + 1, b.y + 1 + dy, b.w - 2, b.h - 2, fill);
  const ink = opts.disabled ? PAL.bgMid : opts.primary ? PAL.line : PAL.text;
  r.text(label, b.x + Math.floor(b.w / 2), b.y + Math.floor((b.h - 8) / 2) - 1 + dy, ink, 'center');
}
