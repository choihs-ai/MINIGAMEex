import type { PadButton } from '../input/padButtons';
import { PAD_R } from '../input/padButtons';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';

/**
 * 진영색 큰 아케이드 버튼. 누르면 2px 눌려 들어간다.
 * glow면 바깥 테두리가 깜빡이며 "지금 누르세요"를 알린다. arrow가 있으면 그 사람 기준 ◀/▶를 새긴다.
 */
export function drawArcadeButton(
  r: Renderer,
  b: Pick<PadButton, 'x' | 'y' | 'flipped'>,
  color: SeatColor,
  opts: { pressed?: boolean; glow?: boolean; arrow?: -1 | 1; radius?: number } = {},
): void {
  const radius = opts.radius ?? PAD_R;
  const { x, y } = b;
  if (opts.glow) r.disc(x, y + 1, radius + 4, PAL.text);
  r.disc(x, y + 2, radius + 2, PAL.line);
  r.disc(x, y + 2, radius, color.shadow);
  const dy = opts.pressed ? 2 : 0;
  r.disc(x, y + dy, radius, color.base);
  // 하이라이트(왼쪽 위)
  const h = Math.floor(radius / 2);
  r.rect(x - h - 1, y + dy - h, 4, 1, PAL.text);
  r.rect(x - h - 1, y + dy - h + 1, 1, 2, PAL.text);

  if (opts.arrow) {
    const dir = opts.arrow;
    const draw = () => {
      for (let i = 0; i < 6; i++) {
        const len = 1 + i * 2;
        const col = dir < 0 ? x - 3 + i : x + 2 - i;
        r.rect(col, y + dy - i, 1, len, color.shadow);
      }
    };
    if (b.flipped) r.rotated180(x - 8, y + dy - 8, 17, 17, draw);
    else draw();
  }
}
