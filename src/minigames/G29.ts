import { BTN_LEFT, BTN_RIGHT, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { createCanvas, get2d } from '../render/canvas';
import { Grid } from '../render/grid';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawMarker, drawTimer } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G29 카트 레이스: 위에서 보는 타원 트랙을 시계 반대 방향으로 3바퀴. 카트는 저절로 달리고 좌우 버튼은 "카트 기준" 핸들.
// 트랙 밖(잔디)은 느려진다. 도착순, 시간이 다 되면 많이 간 순.

export const LAPS = 3;
/** 이 시간이 지나면 끝(못 들어온 사람은 간 거리 순) */
export const DURATION = 30;
/** 1등이 들어온 뒤 나머지를 기다리는 시간 */
export const FINISH_WAIT = 4;
export const CX = 160;
export const CY = 90;
/** 트랙 가운데 선(타원) */
export const MID_RX = 113;
export const MID_RY = 59;
export const OUTER = { rx: 127, ry: 73 };
export const INNER = { rx: 99, ry: 45 };
export const MAX_SPEED = 88;
export const GRASS_SPEED = 20;
const ACCEL = 90;
export const STEER_RATE = 3.6;
export const KART_R = 4;

export interface Kart {
  seat: Seat;
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** 시작선부터 간 바퀴 수(소수) */
  progress: number;
  lastAngle: number;
  finishAt: number | null;
  steer: -1 | 0 | 1;
}

/** 타원 위 각도(화면 기준, 아래쪽이 +π/2) */
export function trackAngle(x: number, y: number): number {
  return Math.atan2((y - CY) / MID_RY, (x - CX) / MID_RX);
}

export function onTrack(x: number, y: number): boolean {
  const dx = x - CX;
  const dy = y - CY;
  const outer = (dx / OUTER.rx) ** 2 + (dy / OUTER.ry) ** 2 <= 1;
  const inner = (dx / INNER.rx) ** 2 + (dy / INNER.ry) ** 2 < 1;
  return outer && !inner;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class KartRace implements MiniGame {
  readonly code = 'G29';
  t = 0;
  karts: Kart[] = [];
  firstFinish: number | null = null;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    // 시작선(아래 가운데) 뒤에 두 줄로. 앞줄 안쪽이 유리하니 자리는 제비뽑기.
    const ordered = [...ctx.players];
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng.next() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
    this.karts = ordered.map((p, i) => {
      const x = 150 - Math.floor(i / 2) * 14;
      const y = i % 2 === 0 ? 139 : 153;
      return { seat: p.seat, x, y, heading: 0, speed: 0, progress: 0, lastAngle: trackAngle(x, y), finishAt: null, steer: 0 };
    });
    for (const k of this.karts) k.progress = -wrap(k.lastAngle - Math.PI / 2) / (Math.PI * 2);
  }

  get rng() {
    return this.ctx.rng;
  }

  get finished(): boolean {
    return this.done;
  }

  isFinished(): boolean {
    return this.done;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.karts.map((k) => [k.seat, Math.min(LAPS, Math.max(0, Math.floor(k.progress)))])) as Partial<Record<Seat, number>>;
  }

  /** 들어온 순서, 그다음 많이 간 순 */
  getRanking(): Seat[][] {
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finishAt !== null || b.finishAt !== null) return (a.finishAt ?? Infinity) - (b.finishAt ?? Infinity);
      return b.progress - a.progress;
    });
    const groups: Seat[][] = [];
    let last: Kart | null = null;
    for (const k of sorted) {
      const same = last && (k.finishAt !== null ? k.finishAt === last.finishAt : last.finishAt === null && k.progress === last.progress);
      if (same) groups[groups.length - 1].push(k.seat);
      else groups.push([k.seat]);
      last = k;
    }
    return groups;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const k of this.karts) this.drive(k, dt);
    this.bump();
    const allIn = this.karts.every((k) => k.finishAt !== null);
    const waited = this.firstFinish !== null && this.t - this.firstFinish >= FINISH_WAIT;
    if (allIn || waited || this.t >= DURATION) this.done = true;
  }

  private drive(k: Kart, dt: number): void {
    const c = this.ctx.controls.get(k.seat)!;
    // 카트 기준 왼쪽 = 화면에서 시계 반대 방향(각도 감소)
    k.steer = ((c.isDown(BTN_RIGHT) ? 1 : 0) - (c.isDown(BTN_LEFT) ? 1 : 0)) as -1 | 0 | 1;
    if (k.finishAt === null) k.heading += k.steer * STEER_RATE * dt;
    const top = k.finishAt !== null ? 20 : onTrack(k.x, k.y) ? MAX_SPEED : GRASS_SPEED;
    if (k.speed < top) k.speed = Math.min(top, k.speed + ACCEL * dt);
    else k.speed = Math.max(top, k.speed - ACCEL * 1.5 * dt);
    k.x += Math.cos(k.heading) * k.speed * dt;
    k.y += Math.sin(k.heading) * k.speed * dt;
    k.x = Math.max(4, Math.min(316, k.x));
    k.y = Math.max(4, Math.min(176, k.y));

    const a = trackAngle(k.x, k.y);
    k.progress -= wrap(a - k.lastAngle) / (Math.PI * 2);
    k.lastAngle = a;
    if (k.finishAt === null && k.progress >= LAPS) {
      k.finishAt = this.t;
      if (this.firstFinish === null) this.firstFinish = this.t;
      this.ctx.sfx.coin();
      const p = this.ctx.players.find((pl) => pl.seat === k.seat)!;
      this.ctx.fx.burst(k.x, k.y, p.color.base, 10);
    }
  }

  private bump(): void {
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i];
        const b = this.karts[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= KART_R * 2 || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (KART_R * 2 - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        // 서로 다가오며 부딪힌 순간에만 느려진다(나란히 달리며 스치는 것은 괜찮다)
        const closing =
          (Math.cos(a.heading) * a.speed - Math.cos(b.heading) * b.speed) * nx +
          (Math.sin(a.heading) * a.speed - Math.sin(b.heading) * b.speed) * ny;
        if (closing > 12) {
          a.speed *= 0.8;
          b.speed *= 0.8;
          this.ctx.sfx.hit();
        }
      }
    }
  }

  render(r: Renderer): void {
    r.ctx.drawImage(trackCanvas(), 0, 0);
    // 앞선 순서대로 위에 그린다
    const order = [...this.karts].sort((a, b) => a.progress - b.progress);
    for (const k of order) {
      const p = this.ctx.players.find((pl) => pl.seat === k.seat)!;
      const frame = Math.round(((k.heading % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 8)) % 16;
      const sprite = kartSprite(p.color, frame);
      r.ctx.drawImage(sprite, Math.round(k.x - sprite.width / 2), Math.round(k.y - sprite.height / 2));
      drawMarker(r, k.x, k.y - 6, p.color.base);
    }
    // 가운데 잔디에 바퀴 수
    this.karts.forEach((k, i) => {
      const p = this.ctx.players.find((pl) => pl.seat === k.seat)!;
      const lap = k.finishAt !== null ? '골!' : `${Math.min(LAPS, Math.max(1, Math.floor(k.progress) + 1))}/${LAPS}`;
      const x = 160 - ((this.karts.length - 1) * 30) / 2 + i * 30;
      r.rect(x - 13, 85, 26, 11, PAL.line);
      r.rect(x - 12, 86, 3, 9, p.color.base);
      r.text(lap, x + 2, 86, PAL.text, 'center');
    });
    drawTimer(r, DURATION - this.t, 160, 66);
  }
}

let trackCache: HTMLCanvasElement | null = null;

function trackCanvas(): HTMLCanvasElement {
  if (trackCache) return trackCache;
  const canvas = createCanvas(320, 180);
  const ctx = get2d(canvas);
  ctx.fillStyle = PAL.greenShadow;
  ctx.fillRect(0, 0, 320, 180);
  for (let y = 0; y < 180; y++) {
    for (let x = 0; x < 320; x++) {
      const dx = x + 0.5 - CX;
      const dy = y + 0.5 - CY;
      const o = (dx / OUTER.rx) ** 2 + (dy / OUTER.ry) ** 2;
      const i = (dx / INNER.rx) ** 2 + (dy / INNER.ry) ** 2;
      let c: string | null = null;
      if (o <= 1 && i >= 1) {
        // 가장자리 연석(빨강·흰색 번갈아)
        const edge = o > 0.93 || i < 1.08;
        const stripe = Math.floor((Math.atan2(dy, dx) + Math.PI) * 9) % 2 === 0;
        c = edge ? (stripe ? PAL.red : PAL.text) : PAL.bgMid;
      } else if ((x * 7 + y * 13) % 23 === 0) c = PAL.green;
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // 시작·도착선(아래 가운데)
  for (let y = CY + INNER.ry; y < CY + OUTER.ry; y++) {
    ctx.fillStyle = (y >> 1) % 2 === 0 ? PAL.text : PAL.line;
    ctx.fillRect(CX + 4, y, 2, 1);
    ctx.fillStyle = (y >> 1) % 2 === 0 ? PAL.line : PAL.text;
    ctx.fillRect(CX + 6, y, 2, 1);
  }
  trackCache = canvas;
  return canvas;
}

const kartCache = new Map<string, HTMLCanvasElement>();

/** 위에서 본 카트(16방향): 몸통 + 바퀴 넷 + 앞쪽 흰 점 */
function kartSprite(color: SeatColor, frame: number): HTMLCanvasElement {
  const key = `${color.base}|${frame}`;
  const hit = kartCache.get(key);
  if (hit) return hit;
  const g = new Grid(13, 13);
  const a = (frame * Math.PI) / 8;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const at = (fwd: number, side: number) => [6.5 + c * fwd - s * side - 0.5, 6.5 + s * fwd + c * side - 0.5] as const;
  for (const [f, sd] of [[-3, -3], [-3, 3], [3, -3], [3, 3]]) {
    const [x, y] = at(f, sd);
    g.set(x, y, PAL.line);
  }
  for (let f = -3; f <= 3; f++) {
    for (let sd = -2; sd <= 2; sd++) {
      const [x, y] = at(f, sd);
      g.set(x, y, sd === 2 || f === -3 ? color.shadow : color.base);
    }
  }
  const [hx, hy] = at(1, 0);
  g.set(hx, hy, PAL.text);
  const [nx, ny] = at(4, 0);
  g.set(nx, ny, color.base);
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  kartCache.set(key, canvas);
  return canvas;
}

/** 트랙 가운데 선(자기 줄만큼 옆으로 비켜)을 앞쪽으로 보며 핸들을 꺾는다. 난이도가 낮으면 반응이 늦고 흔들린다. */
class KartAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private steer: -1 | 0 | 1 = 0;
  private readonly interval: number;
  private readonly wobble: number;
  private readonly lane: number;
  private readonly look: number;

  constructor(
    private readonly game: KartRace,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.2, normal: 0.11, hard: 0.05 });
    // 같은 난이도라도 CPU마다 운전 버릇이 조금씩 다르다
    this.wobble = byDifficulty(player.difficulty, { easy: 0.35, normal: 0.17, hard: 0.06 }) * (0.6 + game.rng.next() * 0.8);
    this.look = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.36, hard: 0.42 });
    this.lane = (game.rng.next() - 0.5) * 10;
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;
    const me = g.karts.find((k) => k.seat === this.player.seat)!;
    const a = trackAngle(me.x, me.y) - this.look;
    const tx = CX + (MID_RX + this.lane) * Math.cos(a);
    const ty = CY + (MID_RY + this.lane * 0.6) * Math.sin(a);
    const want = Math.atan2(ty - me.y, tx - me.x) + jitter(g.rng, this.wobble);
    const diff = wrap(want - me.heading);
    let steer: -1 | 0 | 1 = 0;
    if (diff > 0.08) steer = 1;
    else if (diff < -0.08) steer = -1;
    if (steer === this.steer) return;
    if (this.steer !== 0) this.hand.releaseIn(this.steer < 0 ? BTN_LEFT : BTN_RIGHT);
    if (steer !== 0) this.hand.pressIn(steer < 0 ? BTN_LEFT : BTN_RIGHT);
    this.steer = steer;
  }
}

export const G29 = defineGame({
  code: 'G29',
  controls: 'leftRight',
  create: () => new KartRace(),
  createAI: (game, player, controls) => new KartAI(game, player, controls),
});
