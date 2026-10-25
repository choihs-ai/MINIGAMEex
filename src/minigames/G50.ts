import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawLaneDividers, drawMarker, drawTimer, makeLanes, TIMER_X, TIMER_Y, type Lane } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G50 박자 쌓기: 좌우로 움직이는 판을 눌러 멈춰 쌓는다. 아래 판에서 어긋난 부분은 잘려 나가 판이 좁아진다.
// 완전히 빗나가면 그 사람은 거기서 끝. 높이 순.

export const DURATION = 30;
export const SLAB_H = 6;
/** 이만큼 안으로 맞추면 잘리지 않고 딱 맞는다 */
export const PERFECT = 1;
const GROUND_Y = 172;
const WAIT = 0.2;

export interface Slab {
  x: number;
  w: number;
}

export interface Stack {
  seat: Seat;
  lane: Lane;
  /** 0번은 바닥판 */
  slabs: Slab[];
  moving: (Slab & { dir: 1 | -1 }) | null;
  state: 'move' | 'wait' | 'over';
  waitT: number;
  debris: Array<{ x: number; w: number; y: number; vy: number }>;
  perfectAt: number;
}

export class BeatStack implements MiniGame {
  readonly code = 'G50';
  stacks: Stack[] = [];
  t = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.stacks = makeLanes(ctx.players).map((lane) => {
      const st: Stack = {
        seat: lane.seat,
        lane,
        slabs: [{ x: lane.x + 3, w: lane.w - 6 }],
        moving: null,
        state: 'move',
        waitT: 0,
        debris: [],
        perfectAt: -1,
      };
      this.spawn(st);
      return st;
    });
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

  height(st: Stack): number {
    return st.slabs.length - 1;
  }

  canPress(seat: Seat): boolean {
    return !this.done && this.stacks.find((s) => s.seat === seat)?.state === 'move';
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.stacks.map((s) => [s.seat, this.height(s)])) as Partial<Record<Seat, number>>;
  }

  /** 높이 순, 같은 높이면 맨 위 판이 넓게 남은 사람이 위 */
  getRanking(): Seat[][] {
    return rankByScore(
      this.stacks.map((s) => ({ seat: s.seat, score: this.height(s) * 1000 + Math.round(s.slabs[s.slabs.length - 1].w * 10) })),
    );
  }

  speed(st: Stack): number {
    return Math.min(150, 60 + 6 * this.height(st));
  }

  /** 움직일 수 있는 범위(레인 안) */
  bounds(st: Stack, w: number): [number, number] {
    return [st.lane.x + 2, st.lane.x + st.lane.w - 2 - w];
  }

  private spawn(st: Stack): void {
    const top = st.slabs[st.slabs.length - 1];
    const w = st.slabs.length === 1 ? Math.min(40, st.lane.w - 12) : top.w;
    const fromLeft = st.slabs.length % 2 === 1;
    const [lo, hi] = this.bounds(st, w);
    st.moving = { x: fromLeft ? lo : hi, w, dir: fromLeft ? 1 : -1 };
    st.state = 'move';
  }

  /** 움직이는 판을 dt만큼 옮긴다(벽에서 튕김). AI 예측에도 쓴다. */
  advance(st: Stack, m: Slab & { dir: 1 | -1 }, dt: number): void {
    const [lo, hi] = this.bounds(st, m.w);
    m.x += m.dir * this.speed(st) * dt;
    if (m.x <= lo) {
      m.x = lo + (lo - m.x);
      m.dir = 1;
    } else if (m.x >= hi) {
      m.x = hi - (m.x - hi);
      m.dir = -1;
    }
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const st of this.stacks) {
      for (const d of st.debris) {
        d.vy += 300 * dt;
        d.y -= d.vy * dt;
      }
      st.debris = st.debris.filter((d) => d.y > -120);
      if (st.state === 'wait') {
        st.waitT -= dt;
        if (st.waitT <= 0) this.spawn(st);
      } else if (st.state === 'move' && st.moving) {
        this.advance(st, st.moving, dt);
        if (this.ctx.controls.get(st.seat)!.justPressed()) this.place(st);
      }
    }
    if (this.t >= DURATION || this.stacks.every((s) => s.state === 'over')) this.done = true;
  }

  private place(st: Stack): void {
    const m = st.moving!;
    const prev = st.slabs[st.slabs.length - 1];
    const level = st.slabs.length * SLAB_H;
    st.moving = null;
    const left = Math.max(m.x, prev.x);
    const right = Math.min(m.x + m.w, prev.x + prev.w);
    if (right - left <= 0) {
      st.state = 'over';
      st.debris.push({ x: m.x, w: m.w, y: level, vy: 0 });
      this.ctx.sfx.lose();
      return;
    }
    if (Math.abs(m.x - prev.x) <= PERFECT && m.w <= prev.w) {
      st.slabs.push({ x: prev.x, w: m.w });
      st.perfectAt = this.t;
      this.ctx.sfx.catchStar();
    } else {
      st.slabs.push({ x: left, w: right - left });
      // 잘려 나간 부분은 떨어진다
      if (m.x < left) st.debris.push({ x: m.x, w: left - m.x, y: level, vy: 0 });
      if (m.x + m.w > right) st.debris.push({ x: right, w: m.x + m.w - right, y: level, vy: 0 });
      this.ctx.sfx.tap();
    }
    st.state = 'wait';
    st.waitT = WAIT;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    drawLaneDividers(r, this.stacks.map((s) => s.lane));
    for (const st of this.stacks) this.drawStack(r, st);
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }

  private drawStack(r: Renderer, st: Stack): void {
    const p = this.ctx.players.find((pl) => pl.seat === st.seat)!;
    const { base, shadow } = p.color;
    const level = st.slabs.length * SLAB_H;
    const camera = Math.max(0, level + SLAB_H - (GROUND_Y - 60));
    const sy = (worldY: number) => GROUND_Y - worldY + camera;
    const slab = (s: Slab, worldY: number, fill: typeof base) => {
      const y = Math.round(sy(worldY + SLAB_H));
      r.rect(Math.round(s.x) - 1, y - 1, Math.round(s.w) + 2, SLAB_H + 2, PAL.line);
      r.rect(Math.round(s.x), y, Math.round(s.w), SLAB_H, fill);
      r.rect(Math.round(s.x), y + SLAB_H - 1, Math.round(s.w), 1, shadow);
    };
    st.slabs.forEach((s, i) => slab(s, i * SLAB_H, i === 0 ? PAL.bgMid : i % 2 === 0 ? base : shadow));
    for (const d of st.debris) slab(d, d.y, shadow);
    if (st.moving) {
      slab(st.moving, level, base);
      drawMarker(r, st.moving.x + st.moving.w / 2, sy(level + SLAB_H) - 3, base);
    }
    const perfect = this.t - st.perfectAt < 0.4;
    r.text(String(this.height(st)), st.lane.cx, 4, perfect ? PAL.yellow : st.state === 'over' ? shadow : base, 'center');
  }
}

/** 움직이는 판이 아래 판과 딱 겹치는 순간을 계산해 누른다(난이도별 오차). */
class BeatStackAI implements AiController {
  private readonly hand: AiHand;
  private planned = false;
  private readonly sigma: number;

  constructor(
    private readonly game: BeatStack,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.sigma = byDifficulty(player.difficulty, { easy: 0.08, normal: 0.04, hard: 0.015 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const st = this.game.stacks.find((s) => s.seat === this.player.seat)!;
    if (this.game.finished || st.state !== 'move' || !st.moving) {
      this.planned = false;
      return;
    }
    if (this.planned) return;
    this.planned = true;
    const target = st.slabs[st.slabs.length - 1].x;
    const sim = { ...st.moving };
    const step = 1 / 240;
    let best = 0.2;
    let bestErr = Infinity;
    for (let tau = 0; tau < 3; tau += step) {
      if (tau >= 0.15 && Math.abs(sim.x - target) < bestErr) {
        bestErr = Math.abs(sim.x - target);
        best = tau;
        if (bestErr < 0.5) break;
      }
      this.game.advance(st, sim, step);
    }
    this.hand.tap(0, Math.max(0, best + jitter(this.game.rng, this.sigma)));
  }
}

export const G50 = defineGame({
  code: 'G50',
  controls: 'one',
  create: () => new BeatStack(),
  createAI: (game, player, controls) => new BeatStackAI(game, player, controls),
});
