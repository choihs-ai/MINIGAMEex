import type { ControlLayout } from './controls';
import type { PlayerSlot, Seat } from './seats';

/** 큰 버튼 반지름(기준 픽셀). 아이폰에서 약 70pt. */
export const PAD_R = 17;
/** 터치 판정은 그림보다 이만큼 넉넉하게 */
export const PAD_HIT_EXTRA = 8;
/** 예전 이름 호환: 큰 버튼의 판정 반지름 */
export const PAD_HIT_R = PAD_R + PAD_HIT_EXTRA;

const W = 320;
const H = 180;

export interface PadButton {
  seat: Seat;
  /** 버튼 번호. 좌우·3개·4개는 그 사람 기준 왼쪽부터(4개는 윗줄 왼쪽·오른쪽, 아랫줄 왼쪽·오른쪽). 위/아래는 화면 위가 0 */
  index: number;
  x: number;
  y: number;
  r: number;
  /** 위쪽 사람 버튼이라 글자·화살표를 180도 돌려 그린다 */
  flipped: boolean;
  layout: ControlLayout;
}

type Local = { x: number; y: number; r: number };

/**
 * "아래쪽에 앉은 사람" 기준(왼쪽 아래 모서리 corner='bl' 또는 오른쪽 아래 'br')의 버튼 자리.
 * 반환 순서가 그 사람에게 왼쪽→오른쪽(4개는 윗줄 먼저).
 */
function localPads(layout: ControlLayout, corner: 'bl' | 'br', pairStyle: boolean): Local[] {
  const mirror = (pts: Local[]): Local[] =>
    corner === 'bl' ? pts : pts.map((p) => ({ ...p, x: W - p.x })).sort((a, b) => a.y - b.y || a.x - b.x);
  switch (layout) {
    case 'one':
      return mirror([{ x: 22, y: 158, r: PAD_R }]);
    case 'leftRight':
      // 1~2인은 아래 양 끝으로 넓게, 3~4인은 자기 모서리에 나란히
      return pairStyle
        ? [{ x: 22, y: 158, r: PAD_R }, { x: W - 22, y: 158, r: PAD_R }]
        : mirror([{ x: 22, y: 158, r: PAD_R }, { x: 60, y: 158, r: PAD_R }]);
    case 'upDown':
      return mirror([{ x: 22, y: 120, r: PAD_R }, { x: 22, y: 158, r: PAD_R }]);
    case 'three':
      return pairStyle
        ? [124, 160, 196].map((x) => ({ x, y: 162, r: 14 }))
        : mirror([18, 46, 74].map((x) => ({ x, y: 162, r: 12 })));
    case 'four':
      return pairStyle
        ? [106, 142, 178, 214].map((x) => ({ x, y: 162, r: 14 }))
        : mirror([
            { x: 16, y: 138, r: 11 },
            { x: 42, y: 138, r: 11 },
            { x: 16, y: 163, r: 11 },
            { x: 42, y: 163, r: 11 },
          ]);
    default:
      return [];
  }
}

/** 각 자리의 "자기 기준" 모서리: 아래쪽 사람은 그대로, 위쪽 사람은 화면을 180도 돌린 자리 */
const CORNER_LOCAL: Record<Seat, 'bl' | 'br'> = { 0: 'br', 1: 'bl', 2: 'bl', 3: 'br' };

/**
 * 사람마다 자기 모서리에 큰 버튼을 둔다(앱 "1 2 3 4 Player Games"와 같은 배치).
 * - 1~2인: 아래쪽 사람 기준 오른쪽 아래(좌우 버튼은 아래 양 끝, 3·4개는 아래 가운데), 위쪽 사람은 180도 돌린 자리
 * - 3~4인: 각자 자기 모서리
 * 일부만 참가하는 판(서든데스)은 원래 배치의 자리를 그대로 쓴다. layout은 게임 하나에 하나, 또는 사람마다 다르게.
 */
export function padButtons(
  slots: readonly PlayerSlot[],
  layout: ControlLayout | ((seat: Seat) => ControlLayout),
): PadButton[] {
  const layoutOf = typeof layout === 'function' ? layout : () => layout;
  // 1~2인 배치(구역이 화면 너비 전체)인지, 3~4인 모서리 배치인지
  const pairStyle = !slots.some((s) => s.zone.w < W);
  const out: PadButton[] = [];
  for (const slot of slots) {
    const lay = layoutOf(slot.seat);
    const corner = pairStyle ? 'br' : CORNER_LOCAL[slot.seat];
    const pts = localPads(lay, corner, pairStyle).map((p) =>
      slot.flipped ? { ...p, x: W - p.x, y: H - p.y } : p,
    );
    // 위/아래 버튼은 화면 기준: 0번이 화면 위
    if (lay === 'upDown') pts.sort((a, b) => a.y - b.y);
    pts.forEach((p, index) => out.push({ seat: slot.seat, index, x: p.x, y: p.y, r: p.r, flipped: slot.flipped, layout: lay }));
  }
  return out;
}

/** 이 위치에서 가장 가까운, 판정 반지름 안의 버튼 */
export function padAt(buttons: readonly PadButton[], x: number, y: number, seat?: Seat): PadButton | null {
  let best: PadButton | null = null;
  let bestD = Infinity;
  for (const b of buttons) {
    if (seat !== undefined && b.seat !== seat) continue;
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d <= (b.r + PAD_HIT_EXTRA) ** 2 && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}
