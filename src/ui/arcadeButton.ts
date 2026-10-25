import type { PadButton } from '../input/padButtons';
import { PAD_R } from '../input/padButtons';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';

/**
 * left/right: 그 사람 기준 ◀/▶(위쪽 사람 버튼이면 180도 돌린다)
 * up/down: 화면 기준 ▲/▼(누가 봐도 화면 위·아래. 위/아래 버튼은 말이 화면에서 움직이는 방향 그대로)
 */
export type PadArrow = 'left' | 'right' | 'up' | 'down';

/**
 * 진영색 큰 아케이드 버튼. 누르면 2px 눌려 들어간다.
 * glow면 바깥 테두리가 깜빡이며 "지금 누르세요"를 알린다. arrow·icon이 있으면 가운데에 새긴다.
 */
export function drawArcadeButton(
  r: Renderer,
  b: Pick<PadButton, 'x' | 'y' | 'flipped'>,
  color: SeatColor,
  opts: { pressed?: boolean; glow?: boolean; arrow?: PadArrow; icon?: HTMLCanvasElement; radius?: number } = {},
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

  const cy = y + dy;
  const { arrow, icon } = opts;
  if (arrow === 'left' || arrow === 'right') {
    const draw = () => {
      for (let i = 0; i < 6; i++) {
        const len = 1 + i * 2;
        const col = arrow === 'left' ? x - 3 + i : x + 2 - i;
        r.rect(col, cy - i, 1, len, color.shadow);
      }
    };
    if (b.flipped) r.rotated180(x - 8, cy - 8, 17, 17, draw);
    else draw();
  } else if (arrow === 'up' || arrow === 'down') {
    for (let i = 0; i < 6; i++) {
      const len = 1 + i * 2;
      const row = arrow === 'up' ? cy - 3 + i : cy + 2 - i;
      r.rect(x - i, row, len, 1, color.shadow);
    }
  }
  if (icon) {
    const ix = Math.round(x - icon.width / 2);
    const iy = Math.round(cy - icon.height / 2);
    if (b.flipped) r.rotated180(ix, iy, icon.width, icon.height, () => r.ctx.drawImage(icon, ix, iy));
    else r.ctx.drawImage(icon, ix, iy);
  }
}
