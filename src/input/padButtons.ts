import type { ControlLayout } from './controls';
import type { PlayerSlot, Seat } from './seats';

/** 화면에 그리는 버튼 반지름(기준 픽셀). 아이폰에서 약 70pt. */
export const PAD_R = 17;
/** 터치 판정 반지름(그림보다 넉넉하게) */
export const PAD_HIT_R = 25;

const M = 22;
const GAP = 38;
const W = 320;
const H = 180;

export interface PadButton {
  seat: Seat;
  /** 버튼 번호(원버튼 0, 좌우 버튼은 플레이어 기준 왼쪽 0 · 오른쪽 1) */
  index: number;
  x: number;
  y: number;
  /** 위쪽 사람 버튼이라 글자·화살표를 180도 돌려 그린다 */
  flipped: boolean;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNER_OF_SEAT: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];

function cornerPoint(corner: Corner, inset: number): { x: number; y: number } {
  return {
    x: corner === 'tl' || corner === 'bl' ? inset : W - inset,
    y: corner === 'tl' || corner === 'tr' ? M : H - M,
  };
}

/**
 * 사람마다 자기 모서리에 큰 버튼을 둔다(앱 "1 2 3 4 Player Games"와 같은 배치).
 * - 1인: 원버튼은 오른쪽 아래, 좌우 버튼은 아래 양 끝
 * - 2인: 1P는 아래(원버튼 오른쪽 아래), 2P는 위(그 사람 기준 오른쪽 아래 = 화면 왼쪽 위)
 * - 3~4인: 각자 자기 모서리. 좌우 버튼은 모서리에 둘을 나란히
 * 일부만 참가하는 판(서든데스)은 원래 배치의 자리를 그대로 쓴다.
 */
export function padButtons(slots: readonly PlayerSlot[], layout: ControlLayout): PadButton[] {
  const out: PadButton[] = [];
  const add = (seat: Seat, index: number, p: { x: number; y: number }, flipped: boolean) =>
    out.push({ seat, index, x: p.x, y: p.y, flipped });

  // 1~2인 배치(구역이 화면 너비 전체)인지, 3~4인 모서리 배치인지. 서든데스처럼 일부만 뛰어도 원래 배치를 따른다.
  const cornerStyle = slots.some((s) => s.zone.w < W);
  for (const slot of slots) {
    const { seat, flipped } = slot;
    if (!cornerStyle) {
      // 아래쪽 사람 기준으로 정하고, 위쪽 사람은 화면을 180도 돌린 자리
      const own = (corner: Corner): Corner => (flipped ? ({ tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' } as const)[corner] : corner);
      if (layout === 'one') add(seat, 0, cornerPoint(own('br'), M), flipped);
      else {
        add(seat, 0, cornerPoint(own('bl'), M), flipped);
        add(seat, 1, cornerPoint(own('br'), M), flipped);
      }
      continue;
    }
    const corner = CORNER_OF_SEAT[seat];
    if (layout === 'one') {
      add(seat, 0, cornerPoint(corner, M), flipped);
      continue;
    }
    const outer = cornerPoint(corner, M);
    const inner = cornerPoint(corner, M + GAP);
    const left = corner === 'bl' || corner === 'tr' ? outer : inner;
    const right = left === outer ? inner : outer;
    add(seat, 0, left, flipped);
    add(seat, 1, right, flipped);
  }
  return out;
}

/** 이 위치에서 가장 가까운, 판정 반지름 안의 버튼 */
export function padAt(buttons: readonly PadButton[], x: number, y: number, seat?: Seat): PadButton | null {
  let best: PadButton | null = null;
  let bestD = PAD_HIT_R * PAD_HIT_R;
  for (const b of buttons) {
    if (seat !== undefined && b.seat !== seat) continue;
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d <= bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}
