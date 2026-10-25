import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawMarker, drawRing, facing } from './common';
import { anyMoving, drawAim, flickVelocity, stepDiscs, type Disc } from './flick';
import { homeDir } from './players';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G24 구슬치기(차례제): 자기 차례에 내 구슬을 누른 채 뒤로 당겼다 놓으면 반대쪽으로 튕겨 나간다.
// 상대 구슬을 판 밖으로 쳐내고, 내 구슬은 남긴다. 순위는 남은 구슬 수.

export const BOARD_X = 160;
export const BOARD_Y = 90;
export const BOARD_R = 70;
export const MARBLE_R = 5;
export const MARBLES_EACH = 2;
export const MAX_DRAG = 40;
export const POWER = 6.5;
const DECEL = 150;
const RESTITUTION = 0.92;
/** 이보다 짧게 당기면 쏘지 않은 것으로 본다 */
export const MIN_DRAG = 6;
/** 이 시간 안에 안 쏘면 차례를 넘긴다 */
export const TURN_TIME = 7;
/** 구슬을 잡을 때 이만큼 떨어진 곳까지 그 구슬로 본다 */
export const GRAB_R = 18;
const START_DIST = 40;

export type Phase = 'aim' | 'roll' | 'over';

export class Marbles implements MiniGame {
  readonly code = 'G24';
  t = 0;
  discs: Disc[] = [];
  order: Seat[] = [];
  /** 지금 차례인 order 번호 */
  turn = 0;
  /** 지금까지 끝난 차례 수 */
  turnsTaken = 0;
  totalTurns = 0;
  phase: Phase = 'aim';
  phaseT = 0;
  /** 조준 중인 구슬(누른 채 끄는 동안) */
  aiming: Disc | null = null;
  private ctx!: GameContext;
  private falls: Array<{ x: number; y: number; t: number; owner: Seat }> = [];

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    let id = 0;
    for (const p of ctx.players) {
      const d = homeDir(p, ctx.humanCount);
      const len = Math.hypot(d.x, d.y) || 1;
      const ux = d.x / len;
      const uy = d.y / len;
      for (let i = 0; i < MARBLES_EACH; i++) {
        const side = i === 0 ? -11 : 11;
        this.discs.push({
          id: id++,
          owner: p.seat,
          x: BOARD_X + ux * START_DIST - uy * side,
          y: BOARD_Y + uy * START_DIST + ux * side,
          vx: 0,
          vy: 0,
          r: MARBLE_R,
          out: false,
        });
      }
    }
    this.order = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    // 2인은 3바퀴, 그 밖에는 2바퀴
    this.totalTurns = this.order.length * (this.order.length === 2 ? 3 : 2);
  }

  get rng() {
    return this.ctx.rng;
  }

  get finished(): boolean {
    return this.phase === 'over';
  }

  isFinished(): boolean {
    return this.phase === 'over';
  }

  get current(): Seat {
    return this.order[this.turn];
  }

  activeSeat(): Seat | null {
    return this.phase === 'aim' ? this.current : null;
  }

  remaining(seat: Seat): number {
    return this.discs.filter((d) => d.owner === seat && !d.out).length;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.order.map((s) => [s, this.remaining(s)])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.order.map((seat) => ({ seat, score: this.remaining(seat) })));
  }

  mine(seat: Seat): Disc[] {
    return this.discs.filter((d) => d.owner === seat && !d.out);
  }

  update(dt: number): void {
    if (this.phase === 'over') return;
    this.t += dt;
    this.phaseT += dt;
    this.falls = this.falls.filter((f) => this.t - f.t < 0.5);

    if (this.phase === 'aim') this.aim();
    else if (this.phase === 'roll') this.roll(dt);
  }

  private aim(): void {
    const c = this.ctx.controls.get(this.current)!;
    const own = this.mine(this.current);
    if (c.drag && !this.aiming) {
      // 누른 곳에서 가장 가까운 내 구슬을 잡는다
      const near = own
        .map((d) => ({ d, dist: Math.hypot(d.x - c.drag!.startX, d.y - c.drag!.startY) }))
        .sort((a, b) => a.dist - b.dist)[0];
      if (near && near.dist <= GRAB_R) this.aiming = near.d;
    }
    for (const rel of c.releasesThisTick) {
      if (!this.aiming) continue;
      const v = flickVelocity(rel, MAX_DRAG, POWER);
      const disc = this.aiming;
      this.aiming = null;
      if (v.len < MIN_DRAG) continue;
      disc.vx = v.vx;
      disc.vy = v.vy;
      this.ctx.sfx.dash();
      this.phase = 'roll';
      this.phaseT = 0;
      return;
    }
    if (!c.drag) this.aiming = null;
    if (this.phaseT >= TURN_TIME) this.nextTurn();
  }

  private roll(dt: number): void {
    const sub = 4;
    for (let i = 0; i < sub; i++) {
      if (stepDiscs(this.discs, dt / sub, DECEL, RESTITUTION) > 0) this.ctx.sfx.click();
    }
    for (const d of this.discs) {
      if (d.out || Math.hypot(d.x - BOARD_X, d.y - BOARD_Y) <= BOARD_R) continue;
      d.out = true;
      this.falls.push({ x: d.x, y: d.y, t: this.t, owner: d.owner });
      this.ctx.sfx.lose();
      this.ctx.fx.shake(2, 0.1);
    }
    if (!anyMoving(this.discs, 3) || this.phaseT > 6) {
      for (const d of this.discs) {
        d.vx = 0;
        d.vy = 0;
      }
      this.nextTurn();
    }
  }

  private nextTurn(): void {
    this.turnsTaken++;
    this.aiming = null;
    const alive = this.order.filter((s) => this.remaining(s) > 0);
    if (this.turnsTaken >= this.totalTurns || alive.length <= 1) {
      this.phase = 'over';
      return;
    }
    // 구슬이 없는 사람은 건너뛴다
    for (let k = 1; k <= this.order.length; k++) {
      const next = (this.turn + k) % this.order.length;
      if (this.remaining(this.order[next]) > 0) {
        this.turn = next;
        break;
      }
    }
    this.phase = 'aim';
    this.phaseT = 0;
    this.ctx.sfx.turn();
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.disc(BOARD_X, BOARD_Y, BOARD_R + 3, PAL.line);
    r.disc(BOARD_X, BOARD_Y, BOARD_R, PAL.yellowShadow);
    drawRing(r, BOARD_X, BOARD_Y, BOARD_R - 4, PAL.bgMid);
    drawRing(r, BOARD_X, BOARD_Y, 12, PAL.bgMid);

    for (const f of this.falls) {
      const k = (this.t - f.t) / 0.5;
      const size = Math.max(1, Math.round(MARBLE_R * (1 - k)));
      r.disc(f.x, f.y, size, this.ctx.players.find((p) => p.seat === f.owner)!.color.shadow);
    }
    const blink = Math.floor(this.t * 4) % 2 === 0;
    for (const d of this.discs) {
      if (d.out) continue;
      const p = this.ctx.players.find((pl) => pl.seat === d.owner)!;
      const mineNow = this.phase === 'aim' && d.owner === this.current;
      if (mineNow && (blink || this.aiming === d)) drawRing(r, d.x, d.y, MARBLE_R + 3, PAL.text);
      r.ctx.drawImage(marbleSprite(p.color), Math.round(d.x - 6), Math.round(d.y - 6));
    }
    const c = this.ctx.controls.get(this.current);
    if (this.aiming && c?.drag) drawAim(r, this.aiming, c.drag, MAX_DRAG);

    // 사람마다 자기 쪽에 남은 구슬, 차례인 사람은 ▼ 표시
    for (const p of this.ctx.players) {
      const d = homeDir(p, this.ctx.humanCount);
      const len = Math.hypot(d.x, d.y) || 1;
      const ax = BOARD_X + (d.x / len) * (BOARD_R + 16) + (this.ctx.humanCount === 2 ? 0 : d.x * 30);
      const ay = BOARD_Y + (d.y / len) * (BOARD_R + 8);
      const x = Math.max(14, Math.min(306, ax));
      const y = Math.max(10, Math.min(170, ay));
      facing(r, p, x, y, () => {
        for (let i = 0; i < MARBLES_EACH; i++) {
          const filled = i < this.remaining(p.seat);
          r.disc(x - 6 + i * 12, y, 4, PAL.line);
          r.disc(x - 6 + i * 12, y, 3, filled ? p.color.base : PAL.bgMid);
        }
        if (this.phase === 'aim' && p.seat === this.current) {
          drawMarker(r, x, y - 8, p.color.base);
          const left = Math.max(0, Math.ceil(TURN_TIME - this.phaseT));
          if (left <= 3) r.text(String(left), x + 16, y - 4, PAL.text);
        }
      });
    }
    // 몇 번째 차례인지(판 밖 왼쪽 빈자리)
    r.rect(10, 84, 28, 11, PAL.line);
    r.text(`${Math.min(this.totalTurns, this.turnsTaken + 1)}/${this.totalTurns}`, 24, 85, PAL.text, 'center');
  }
}

const marbleCache = new Map<string, HTMLCanvasElement>();

function marbleSprite(color: SeatColor): HTMLCanvasElement {
  let c = marbleCache.get(color.base);
  if (!c) {
    const g = new Grid(13, 13);
    g.ellipse(6.5, 6.5, MARBLE_R + 0.5, MARBLE_R + 0.5, color.base, color.shadow);
    g.rect(4, 4, 2, 2, PAL.text);
    g.outline(PAL.line);
    c = g.toCanvas();
    marbleCache.set(color.base, c);
  }
  return c;
}

/**
 * 내 구슬 하나로 상대 구슬 하나를 맞혀 바깥으로 밀어낼 수 있는 조합을 고른다.
 * 맞힌 뒤 내 구슬이 따라 나가지 않을 만큼의 힘으로, 난이도만큼 조준이 흔들린다.
 */
class MarblesAI implements AiController {
  private readonly hand: AiHand;
  private planned = -1;
  private readonly aimError: number;
  private readonly powerError: number;
  private readonly think0: readonly [number, number];

  constructor(
    private readonly game: Marbles,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.aimError = byDifficulty(player.difficulty, { easy: 0.11, normal: 0.055, hard: 0.025 });
    this.powerError = byDifficulty(player.difficulty, { easy: 0.25, normal: 0.13, hard: 0.06 });
    this.think0 = byDifficulty(player.difficulty, { easy: [1.0, 1.6], normal: [0.7, 1.2], hard: [0.5, 0.9] });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.phase !== 'aim' || g.current !== this.player.seat) return;
    if (this.planned === g.turnsTaken) return;
    this.planned = g.turnsTaken;
    const rng = g.rng;
    const own = g.mine(this.player.seat);
    const enemies = g.discs.filter((d) => !d.out && d.owner !== this.player.seat);
    let best: { from: Disc; ang: number; speed: number; score: number } | null = null;
    for (const m of own) {
      for (const e of enemies) {
        const dx = e.x - m.x;
        const dy = e.y - m.y;
        const dist = Math.hypot(dx, dy);
        const ux = dx / dist;
        const uy = dy / dist;
        // 상대 구슬이 밀려날 방향(ux, uy)으로 판 끝까지 거리
        const ex = e.x - BOARD_X;
        const ey = e.y - BOARD_Y;
        const b = ex * ux + ey * uy;
        const toEdge = -b + Math.sqrt(Math.max(0, b * b - (ex * ex + ey * ey - BOARD_R * BOARD_R)));
        // 길 위에 다른 구슬이 있으면 감점
        const blocked = g.discs.some((o) => {
          if (o === m || o === e || o.out) return false;
          const t = (o.x - m.x) * ux + (o.y - m.y) * uy;
          if (t <= 0 || t >= dist) return false;
          return Math.abs((o.x - m.x) * uy - (o.y - m.y) * ux) < MARBLE_R * 2;
        });
        // 맞는 순간 속도 v1 → 상대는 약 v1 만큼 받는다. 판 밖까지 + 여유
        const v1 = Math.sqrt(2 * DECEL * (toEdge + 14));
        const speed = Math.sqrt(v1 * v1 + 2 * DECEL * Math.max(0, dist - MARBLE_R * 2));
        const score = -toEdge - dist * 0.3 - (blocked ? 80 : 0) - (speed > MAX_DRAG * POWER ? 60 : 0);
        if (!best || score > best.score) best = { from: m, ang: Math.atan2(dy, dx), speed, score };
      }
    }
    if (!best) return;
    const ang = best.ang + jitter(rng, this.aimError);
    const speed = Math.min(MAX_DRAG * POWER, best.speed * (1 + jitter(rng, this.powerError)));
    const pull = Math.max(MIN_DRAG + 1, speed / POWER);
    const { x, y } = best.from;
    const [lo, hi] = this.think0;
    this.hand.drag(x, y, x - Math.cos(ang) * pull, y - Math.sin(ang) * pull, lo + rng.next() * (hi - lo), 0.35);
  }
}

export const G24 = defineGame({
  code: 'G24',
  controls: 'pointer',
  pointer: 'turn',
  create: () => new Marbles(),
  createAI: (game, player, controls) => new MarblesAI(game, player, controls),
});
