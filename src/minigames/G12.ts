import type { PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawScoreTag, drawTimer } from './common';
import { regionOf } from './G54';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G12 골 지키기(G48 선 긋기 차단 흡수): 자기 구역을 손가락으로 누르고 끌면 말렛이 따라온다.
// 퍽(2개)이 화면을 튕겨 다니고, 자기 골(2인은 자기 쪽 가장자리 가운데, 3~4인은 자기 모서리)에 들어가면 체력 -1.
// 체력 3이 다 닳으면 탈락(그 골은 벽이 된다). 탈락 역순, 끝까지 남으면 남은 체력 순.

export const DURATION = 30;
export const HP = 3;
export const MALLET_R = 9;
export const PUCK_R = 4;
const PUCKS = 2;
const SPEED_START = 75;
const SPEED_END = 150;
/** 모서리 골: 가로 변으로 이만큼, 세로 변으로 이만큼 */
const CORNER_GOAL_X = 56;
const CORNER_GOAL_Y = 40;
const GOAL_HALF = 50;

export interface Keeper {
  seat: Seat;
  region: Rect;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  outAt: number | null;
  hitAt: number;
}

export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 다시 나오기까지 남은 시간(골 뒤) */
  wait: number;
}

export class GoalKeep implements MiniGame {
  readonly code = 'G12';
  t = 0;
  keepers: Keeper[] = [];
  pucks: Puck[] = [];
  private ctx!: GameContext;
  private done = false;
  private twoPlayer = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.twoPlayer = ctx.humanCount === 2;
    this.keepers = ctx.players.map((p) => {
      const region = regionOf(p, ctx.humanCount);
      const g = this.goalPoint(region);
      return { seat: p.seat, region, x: g.x + (160 - g.x) * 0.25, y: g.y + (90 - g.y) * 0.3, vx: 0, vy: 0, hp: HP, outAt: null, hitAt: -9 };
    });
    for (let i = 0; i < PUCKS; i++) this.pucks.push(this.serve(0.6 + i * 0.8));
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
    return Object.fromEntries(this.keepers.map((k) => [k.seat, k.hp])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    const key = (k: Keeper) => (k.outAt === null ? 1000 + k.hp : k.outAt);
    const sorted = [...this.keepers].sort((a, b) => key(b) - key(a) || a.seat - b.seat);
    const groups: Seat[][] = [];
    let last: number | null = null;
    for (const k of sorted) {
      if (key(k) === last) groups[groups.length - 1].push(k.seat);
      else groups.push([k.seat]);
      last = key(k);
    }
    return groups;
  }

  /** 이 구역의 골 가운데(화면 가장자리) */
  goalPoint(region: Rect): { x: number; y: number } {
    if (this.twoPlayer) return { x: 160, y: region.y === 0 ? 0 : 180 };
    return { x: region.x === 0 ? 0 : 320, y: region.y === 0 ? 0 : 180 };
  }

  speed(): number {
    return SPEED_START + (SPEED_END - SPEED_START) * Math.min(1, this.t / DURATION);
  }

  private serve(wait: number): Puck {
    const a = this.ctx.rng.next() * Math.PI * 2;
    const s = this.speed();
    return { x: 160, y: 90, vx: Math.cos(a) * s, vy: Math.sin(a) * s, wait };
  }

  /** 화면 가장자리 (x, y)가 누구 골인가 */
  private goalOwner(x: number, y: number): Keeper | null {
    for (const k of this.keepers) {
      if (k.outAt !== null) continue;
      const g = this.goalPoint(k.region);
      if (this.twoPlayer) {
        if (Math.abs(y - g.y) < 2 && Math.abs(x - g.x) <= GOAL_HALF) return k;
      } else {
        const onH = Math.abs(y - g.y) < 2 && Math.abs(x - g.x) <= CORNER_GOAL_X;
        const onV = Math.abs(x - g.x) < 2 && Math.abs(y - g.y) <= CORNER_GOAL_Y;
        if (onH || onV) return k;
      }
    }
    return null;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    for (const k of this.keepers) {
      if (k.outAt !== null) continue;
      const d = this.ctx.controls.get(k.seat)!.drag;
      const r = k.region;
      const px = k.x;
      const py = k.y;
      if (d) {
        k.x = Math.max(r.x + MALLET_R, Math.min(r.x + r.w - MALLET_R, d.x));
        k.y = Math.max(r.y + MALLET_R, Math.min(r.y + r.h - MALLET_R, d.y));
      }
      k.vx = (k.x - px) / dt;
      k.vy = (k.y - py) / dt;
    }
    const target = this.speed();
    for (const p of this.pucks) {
      if (p.wait > 0) {
        p.wait -= dt;
        continue;
      }
      // 속도는 시간에 따라 점점 빨라진다(말렛에 맞으면 잠깐 더 빠름)
      const v = Math.hypot(p.vx, p.vy) || 1;
      const nv = v + (target - v) * Math.min(1, dt * 0.8);
      p.vx *= nv / v;
      p.vy *= nv / v;
      const sub = 3;
      for (let i = 0; i < sub && p.wait <= 0; i++) this.move(p, dt / sub);
    }
    const alive = this.keepers.filter((k) => k.outAt === null).length;
    if (this.t >= DURATION || (this.keepers.length > 1 && alive <= 1)) this.done = true;
  }

  private move(p: Puck, dt: number): void {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // 말렛과 부딪힘
    for (const k of this.keepers) {
      if (k.outAt !== null) continue;
      const dx = p.x - k.x;
      const dy = p.y - k.y;
      const d = Math.hypot(dx, dy);
      if (d >= MALLET_R + PUCK_R || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      p.x = k.x + nx * (MALLET_R + PUCK_R);
      p.y = k.y + ny * (MALLET_R + PUCK_R);
      const rel = (p.vx - k.vx) * nx + (p.vy - k.vy) * ny;
      if (rel < 0) {
        p.vx -= 2 * rel * nx;
        p.vy -= 2 * rel * ny;
        const v = Math.hypot(p.vx, p.vy);
        const cap = this.speed() * 1.8;
        if (v > cap) {
          p.vx *= cap / v;
          p.vy *= cap / v;
        }
        k.hitAt = this.t;
        this.ctx.sfx.click();
      }
    }
    // 가장자리: 골이면 실점, 아니면 튕김
    const hitWall = (cx: number, cy: number) => {
      const owner = this.goalOwner(cx, cy);
      if (!owner) return false;
      owner.hp--;
      this.ctx.sfx.buzz();
      this.ctx.fx.shake(3, 0.2);
      this.ctx.fx.burst(cx, cy, this.ctx.players.find((pl) => pl.seat === owner.seat)!.color.base, 10);
      if (owner.hp <= 0) {
        owner.outAt = this.t;
        this.ctx.sfx.lose();
      }
      Object.assign(p, this.serve(0.6));
      return true;
    };
    if (p.x < PUCK_R) {
      if (hitWall(0, p.y)) return;
      p.x = PUCK_R;
      p.vx = Math.abs(p.vx);
    } else if (p.x > 320 - PUCK_R) {
      if (hitWall(320, p.y)) return;
      p.x = 320 - PUCK_R;
      p.vx = -Math.abs(p.vx);
    }
    if (p.y < PUCK_R) {
      if (hitWall(p.x, 0)) return;
      p.y = PUCK_R;
      p.vy = Math.abs(p.vy);
    } else if (p.y > 180 - PUCK_R) {
      if (hitWall(p.x, 180)) return;
      p.y = 180 - PUCK_R;
      p.vy = -Math.abs(p.vy);
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(160, 0, 1, 180, PAL.bgMid);
    r.rect(0, 90, 320, 1, PAL.bgMid);
    for (const k of this.keepers) {
      const c = this.ctx.players.find((p) => p.seat === k.seat)!.color;
      const g = this.goalPoint(k.region);
      const col = k.outAt === null ? c.base : PAL.bgMid;
      // 골 표시(가장자리 굵은 띠)
      if (this.twoPlayer) r.rect(g.x - GOAL_HALF, g.y === 0 ? 0 : 177, GOAL_HALF * 2, 3, col);
      else {
        r.rect(g.x === 0 ? 0 : 320 - CORNER_GOAL_X, g.y === 0 ? 0 : 177, CORNER_GOAL_X, 3, col);
        r.rect(g.x === 0 ? 0 : 317, g.y === 0 ? 0 : 180 - CORNER_GOAL_Y, 3, CORNER_GOAL_Y, col);
      }
      if (k.outAt !== null) continue;
      r.disc(k.x, k.y, MALLET_R + 1, PAL.line);
      r.disc(k.x, k.y, MALLET_R, this.t - k.hitAt < 0.08 ? PAL.text : c.shadow);
      r.disc(k.x, k.y, MALLET_R - 3, c.base);
      const tx = g.x === 0 ? 24 : g.x === 320 ? 296 : g.x;
      const ty = g.y === 0 ? 10 : 160;
      drawScoreTag(r, this.ctx.players.find((p) => p.seat === k.seat)!, tx, ty, k.hp);
    }
    for (const p of this.pucks) {
      if (p.wait > 0) {
        if (Math.floor(p.wait * 8) % 2 === 0) r.disc(160, 90, PUCK_R, PAL.bgMid);
        continue;
      }
      r.disc(p.x, p.y, PUCK_R + 1, PAL.line);
      r.disc(p.x, p.y, PUCK_R, PAL.text);
    }
    drawTimer(r, DURATION - this.t, 160, 98);
  }
}

/** 자기 골로 오는 퍽 앞을 막아선다. 난이도가 낮으면 늦게 반응하고 빗나간다. */
class KeeperAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private readonly interval: number;
  private readonly slop: number;

  constructor(
    private readonly game: GoalKeep,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.22, normal: 0.12, hard: 0.06 });
    this.slop = byDifficulty(player.difficulty, { easy: 9, normal: 5, hard: 2.5 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    const me = g.keepers.find((k) => k.seat === this.player.seat)!;
    if (g.finished || me.outAt !== null) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;
    const goal = g.goalPoint(me.region);
    // 가장 위험한 퍽: 내 골 쪽으로 오면서 가까운 것
    let best: { x: number; y: number; score: number } | null = null;
    for (const p of g.pucks) {
      if (p.wait > 0) continue;
      const toGoal = (goal.x - p.x) * p.vx + (goal.y - p.y) * p.vy;
      const d = Math.hypot(goal.x - p.x, goal.y - p.y);
      const score = d - (toGoal > 0 ? 80 : 0);
      if (!best || score < best.score) best = { x: p.x + p.vx * 0.15, y: p.y + p.vy * 0.15, score };
    }
    // 퍽과 골 사이, 골 가까이에 선다
    const tx = best ? goal.x + (best.x - goal.x) * 0.45 : goal.x + (160 - goal.x) * 0.25;
    const ty = best ? goal.y + (best.y - goal.y) * 0.45 : goal.y + (90 - goal.y) * 0.3;
    const rng = g.rng;
    this.hand.pointTo(tx + jitter(rng, this.slop), ty + jitter(rng, this.slop));
  }
}

export const G12 = defineGame({
  code: 'G12',
  controls: 'pointer',
  pointer: 'area',
  create: () => new GoalKeep(),
  createAI: (game, player, controls) => new KeeperAI(game, player, controls),
});
