import { Grid } from '../render/grid';
import { PAL, SEAT_COLORS, type SeatColor } from '../render/palette';
import type { Seat } from '../input/seats';

export type Pose = 'idle' | 'move' | 'win' | 'lose';
export const POSE_FRAMES: Readonly<Record<Pose, number>> = { idle: 2, move: 4, win: 4, lose: 4 };
export const CHAR_SIZE = 24;
/** 캐릭터 이름: 꾹이(빨강) 레버(파랑) 땡그랑(노랑) 캡슐(초록) */
export const CHAR_NAMES = ['꾹이', '레버', '땡그랑', '캡슐'] as const;

interface Body {
  /** 위로 뛴 만큼 음수 */
  y: number;
  /** 키가 늘면 양수, 찌그러지면 음수 */
  sq: number;
  lean: number;
}

function body(pose: Pose, f: number): Body {
  switch (pose) {
    case 'idle':
      return { y: 0, sq: f === 0 ? 0 : -1, lean: 0 };
    case 'move':
      return { y: [0, -2, 0, -1][f], sq: [0, 1, 0, 0][f], lean: [0, 1, 0, -1][f] };
    case 'win':
      return { y: [0, -4, -7, -3][f], sq: [-1, 2, 2, 0][f], lean: 0 };
    default:
      return { y: 0, sq: 0, lean: 0 };
  }
}

/** 눈 위치(왼쪽 눈 좌상단). 오른쪽 눈은 x+6. null이면 눈을 그리지 않는다. */
type Eyes = { x: number; y: number } | null;
/** 외곽선을 두른 뒤에 덧그릴 것(눈 위·바깥 장식) */
interface Drawn {
  eyes: Eyes;
  after?: (g: Grid) => void;
}
type DrawFn = (g: Grid, c: SeatColor, pose: Pose, f: number) => Drawn;

// ── 꾹이 (아케이드 버튼) ───────────────────────────────
const drawButton: DrawFn = (g, c, pose, f) => {
  if (pose === 'lose') {
    const flat = [3, 2, 1, 2][f];
    const sx = [0, 1, 0, -1][f];
    g.rect(6, 21, 2, 2, PAL.bgMid);
    g.rect(16, 21, 2, 2, PAL.bgMid);
    g.ellipse(12, 19, 10, 3.5, c.shadow);
    g.ellipse(12 + sx, 17, 8, flat, c.base, c.shadow);
    return { eyes: { x: 9 + sx, y: 16 } };
  }
  const b = body(pose, f);
  const by = 18 + b.y;
  const leg = pose === 'move' ? [0, 1, 0, 1][f] : 0;
  g.rect(6, by + 3, 2, 2 + leg, PAL.bgMid);
  g.rect(16, by + 3, 2, 3 - leg, PAL.bgMid);
  g.ellipse(12, by + 1, 9, 3, PAL.bgMid);
  g.ellipse(12, by - 1, 10, 4, c.base, c.shadow);
  g.ellipse(12, by - 2, 10, 3, c.shadow);
  const ry = 5 + b.sq;
  const cy = by - (ry - 1);
  const cx = 12 + b.lean;
  g.ellipse(cx, cy, 7, ry, c.base, c.shadow);
  g.set(cx - 5, cy - ry + 2, PAL.text);
  g.set(cx - 4, cy - ry + 1, PAL.text);
  return { eyes: { x: cx - 3, y: cy - 1 } };
};

// ── 레버 (조이스틱) ───────────────────────────────────
const drawLever: DrawFn = (g, c, pose, f) => {
  const b = body(pose, f);
  const by = 21 + Math.round(b.y * 0.5);
  let lean = b.lean * 3;
  let stick = 6 + Math.min(b.sq, 1);
  if (pose === 'win') lean = [-3, 3, -3, 3][f];
  if (pose === 'lose') {
    lean = [4, 5, 4, 3][f];
    stick = [5, 4, 4, 5][f];
  }
  g.ellipse(12, by, 8, 3, PAL.bgMid);
  g.rect(8, by - 1, 3, 1, PAL.text);
  const bx = 12 + lean;
  const ty = by - 1 - stick;
  g.line(12, by - 1, bx, ty, PAL.bgMid, 2);
  const cy = ty - 3;
  g.ellipse(bx, cy, 5, 5, c.base, c.shadow);
  g.set(bx - 3, cy - 3, PAL.text);
  return { eyes: { x: bx - 3, y: cy - 1 } };
};

// ── 땡그랑 (동전) ────────────────────────────────────
const drawCoin: DrawFn = (g, c, pose, f) => {
  const b = body(pose, f);
  if (pose === 'lose') {
    const ry = [4, 3, 3, 4][f];
    g.ellipse(12, 19, 9, ry + 1, c.shadow);
    g.ellipse(12, 18, 9, ry, c.base, c.shadow);
    g.ellipseRing(12, 18, 6, Math.max(1, ry - 1), 1, c.shadow);
    return { eyes: { x: 9, y: 17 } };
  }
  const cx = 12 + b.lean;
  const ry = pose === 'move' && b.sq > 0 ? 10 : 9;
  const cy = 21 - ry + Math.round(b.y * 0.45);
  const rx = pose === 'win' ? [9, 6, 1.5, 6][f] : 9;
  if (rx < 3) {
    // 모서리가 보이는 옆모습: 얇은 막대
    g.rect(cx - 1, cy - ry, 3, ry * 2, c.base);
    g.rect(cx + 1, cy - ry, 1, ry * 2, c.shadow);
    for (let y = cy - ry + 2; y < cy + ry - 1; y += 3) g.rect(cx - 1, y, 3, 1, c.shadow);
    return { eyes: null };
  }
  g.rect(cx - 4, cy + ry - 1, 2, 3, c.shadow);
  g.rect(cx + 2, cy + ry - 1, 2, 3, c.shadow);
  g.ellipse(cx, cy, rx, ry, c.base, c.shadow);
  g.ellipseRing(cx, cy, rx - 2, ry - 2, 1, c.shadow);
  return { eyes: rx >= 6 ? { x: cx - 3, y: cy - 1 } : null };
};

// ── 캡슐 (뽑기 캡슐) ─────────────────────────────────
const CONFETTI: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [],
  [],
  [[6, 6, 0], [11, 3, 1], [17, 6, 2], [9, 9, 3], [14, 8, 0]],
  [[4, 8, 1], [9, 5, 2], [15, 4, 3], [19, 8, 0], [12, 9, 1]],
];

const drawCapsule: DrawFn = (g, c, pose, f) => {
  if (pose === 'lose') {
    const w = [0, 1, 0, -1][f];
    g.ellipseWith(7 + w, 19, 5, 5, (nx, ny) => (ny + nx * 0.4 > 0.5 ? PAL.bgMid : PAL.text));
    g.ellipseWith(17 - w, 20, 5, 4, (nx, ny) => (ny + nx * 0.4 > 0.4 ? c.shadow : c.base));
    return { eyes: { x: 14 - w, y: 19 } };
  }
  const b = body(pose, f);
  const ry = pose === 'move' && b.sq > 0 ? 10 : 9;
  const rx = 7;
  const cx = 12 + b.lean;
  const cy = 21 - ry + Math.round(b.y * 0.4);
  const open = pose === 'win' && f >= 2;
  g.rect(cx - 5, cy + ry - 1, 3, 3, c.shadow);
  g.rect(cx + 2, cy + ry - 1, 3, 3, c.shadow);
  const split = cy - 1;
  if (open) {
    // 윗뚜껑이 떠서 기울어진다
    const lift = f === 2 ? 3 : 2;
    g.ellipseWith(cx, cy, rx, ry, (nx, ny) => {
      if (cy + ny * ry < split + 1) return null;
      return ny * 0.7 + nx * 0.45 > 0.4 ? c.shadow : c.base;
    });
    g.ellipseWith(cx - 1, split - lift - 2, rx - 1, 4, (nx, ny) => (ny + nx * 0.4 > 0.5 ? PAL.bgMid : PAL.text));
  } else {
    g.ellipseWith(cx, cy, rx, ry, (nx, ny) => {
      const y = cy + ny * ry;
      if (y < split) return ny + nx * 0.4 > 0.55 ? PAL.bgMid : PAL.text;
      return ny * 0.7 + nx * 0.45 > 0.4 ? c.shadow : c.base;
    });
    g.set(cx - 4, cy - ry + 3, PAL.bgDark);
  }
  const confetti = CONFETTI[f] ?? [];
  const seatColors = [PAL.red, PAL.blue, PAL.yellow, PAL.green];
  return {
    eyes: { x: cx - 3, y: open ? split + 3 : split + 2 },
    after: pose === 'win' ? (gg) => confetti.forEach(([x, y, k]) => gg.set(x + b.lean, y, seatColors[k])) : undefined,
  };
};

const DRAWERS: readonly DrawFn[] = [drawButton, drawLever, drawCoin, drawCapsule];
const cache = new Map<string, HTMLCanvasElement>();

/** 캐릭터 한 프레임(24×24). 처음 요청할 때 한 번만 그려 캐시한다. */
export function characterSprite(seat: Seat, pose: Pose, frame: number): HTMLCanvasElement {
  const f = frame % POSE_FRAMES[pose];
  const key = `${seat}|${pose}|${f}`;
  let sprite = cache.get(key);
  if (!sprite) {
    const g = new Grid(CHAR_SIZE, CHAR_SIZE);
    const drawn = DRAWERS[seat](g, SEAT_COLORS[seat], pose, f);
    g.outline(PAL.line);
    if (drawn.eyes) {
      g.rect(drawn.eyes.x, drawn.eyes.y, 2, 2, PAL.text);
      g.rect(drawn.eyes.x + 6, drawn.eyes.y, 2, 2, PAL.text);
    }
    drawn.after?.(g);
    sprite = g.toCanvas();
    cache.set(key, sprite);
  }
  return sprite;
}

/** 시간(초)에서 프레임 번호. 대기는 느리게(3fps), 나머지는 8fps. 프레임 단위로 끊어 넘긴다. */
export function characterFrame(pose: Pose, time: number): number {
  const fps = pose === 'idle' ? 3 : 8;
  return Math.floor(time * fps) % POSE_FRAMES[pose];
}

export function drawCharacter(ctx: CanvasRenderingContext2D, seat: Seat, pose: Pose, time: number, x: number, y: number): void {
  ctx.drawImage(characterSprite(seat, pose, characterFrame(pose, time)), Math.round(x), Math.round(y));
}
