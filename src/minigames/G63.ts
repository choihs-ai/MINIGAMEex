import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawRing, drawTimer } from './common';
import { aimHeld, drawMover, makeMover, type Mover } from './mover';
import { homeDir } from './players';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G63 닭싸움: 원버튼. 떼고 있으면 제자리에서 빙글 돌고, 꾹 눌러 힘을 모았다가 떼면 바라보는 쪽으로 깡충 뛴다.
// 뛰어든 닭이 땅에 선 닭을 들이받으면 상대만 크게 밀려난다(둘 다 뛰고 있으면 둘 다). 동그란 모래판이 점점 줄고,
// 땅에 내려앉았을 때 판 밖이면 탈락. 탈락 역순.

export const DURATION = 30;
export const CX = 160;
export const CY = 94;
export const R_START = 80;
export const R_END = 40;
const SHRINK_FROM = 10;
export const MAX_CHARGE = 0.7;
export const AIR_TIME = 0.36;
const HOP_MIN = 70;
const HOP_MAX = 240;
const TURN = 3.2;
/** 땅에 선 닭이 받히면 밀려나는 속도 */
export const KNOCK = 160;
const GROUND_FRICTION = 7;

export interface Chicken extends Mover {
  /** 남은 공중 시간(0이면 땅) */
  air: number;
  /** 모은 힘(초) */
  charge: number;
  charging: boolean;
}

export class ChickenFight implements MiniGame {
  readonly code = 'G63';
  t = 0;
  chickens: Chicken[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.chickens = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      const len = Math.hypot(d.x, d.y) || 1;
      const m = makeMover(p.seat, CX + (d.x / len) * 48, CY + (d.y / len) * 40, CX, CY, 7);
      return { ...m, air: 0, charge: 0, charging: false };
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

  /** 지금 판 반지름 */
  get radius(): number {
    const k = Math.max(0, Math.min(1, (this.t - SHRINK_FROM) / (DURATION - SHRINK_FROM - 4)));
    return R_START + (R_END - R_START) * k;
  }

  canPress(seat: Seat): boolean {
    const c = this.chickens.find((ch) => ch.seat === seat);
    return !this.done && !!c?.alive && c.air <= 0;
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.chickens.map((c) => ({ seat: c.seat, outAt: c.outAt })));
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const c of this.chickens) if (c.alive) this.move(c, dt);
    this.collide();
    const R = this.radius;
    for (const c of this.chickens) {
      if (!c.alive || c.air > 0) continue;
      if (Math.hypot(c.x - CX, c.y - CY) <= R + 2) continue;
      c.alive = false;
      c.outAt = this.t;
      this.ctx.sfx.lose();
      this.ctx.fx.burst(c.x, c.y, PAL.text, 12);
    }
    if (this.t >= DURATION || this.chickens.filter((c) => c.alive).length <= 1) this.done = true;
  }

  private move(c: Chicken, dt: number): void {
    const down = this.ctx.controls.get(c.seat)!.isDown();
    c.stun = Math.max(0, c.stun - dt);
    if (c.air > 0) {
      c.air = Math.max(0, c.air - dt);
      if (c.air === 0) {
        // 착지하면 거의 멈춘다
        c.vx *= 0.35;
        c.vy *= 0.35;
      }
    } else {
      const k = Math.exp(-GROUND_FRICTION * dt);
      c.vx *= k;
      c.vy *= k;
      if (c.stun <= 0) {
        if (down) {
          c.charging = true;
          c.charge = Math.min(MAX_CHARGE, c.charge + dt);
          // 힘을 모으는 동안엔 천천히 돌아서 겨눌 수 있다
          c.heading += c.spin * TURN * 0.35 * dt;
        } else {
          if (c.charging) this.hop(c);
          else c.heading += c.spin * TURN * dt;
        }
      } else c.charging = false;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
  }

  private hop(c: Chicken): void {
    const p = HOP_MIN + (HOP_MAX - HOP_MIN) * (c.charge / MAX_CHARGE);
    c.vx = Math.cos(c.heading) * p;
    c.vy = Math.sin(c.heading) * p;
    c.air = AIR_TIME;
    c.charge = 0;
    c.charging = false;
    this.ctx.sfx.dash();
  }

  private collide(): void {
    const list = this.chickens.filter((c) => c.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= a.r + b.r || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (a.r + b.r - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing <= 5) continue;
        const aJump = a.air > 0;
        const bJump = b.air > 0;
        if (aJump === bJump) {
          // 같은 처지끼리는 서로 튕긴다(뛰다 맞부딪히면 세게)
          const k = aJump ? KNOCK * 0.7 : Math.max(30, closing * 0.8);
          this.knock(a, -nx, -ny, k);
          this.knock(b, nx, ny, k);
        } else {
          // 뛰어든 쪽이 이긴다
          const [hitter, hit, sx] = aJump ? [a, b, 1] : [b, a, -1];
          this.knock(hit, nx * sx, ny * sx, KNOCK);
          hitter.vx *= 0.15;
          hitter.vy *= 0.15;
        }
        this.ctx.sfx.hit();
        this.ctx.fx.shake(aJump || bJump ? 3 : 1, 0.1);
      }
    }
  }

  private knock(c: Chicken, nx: number, ny: number, k: number): void {
    c.vx = nx * k;
    c.vy = ny * k;
    c.stun = 0.3;
    c.charge = 0;
    c.charging = false;
    // 받혀서 살짝 붕 뜬다(뜬 동안엔 떨어지지 않는다)
    c.air = Math.max(c.air, 0.12);
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const R = this.radius;
    r.disc(CX, CY, Math.round(R) + 3, PAL.yellowShadow);
    r.disc(CX, CY, Math.round(R), PAL.yellow);
    r.disc(CX, CY, Math.round(R) - 6, PAL.yellowShadow);
    r.disc(CX, CY, Math.round(R) - 7, PAL.yellow);
    if (R > R_END + 1 && this.t > SHRINK_FROM - 2) drawRing(r, CX, CY, Math.round(R) + 1, Math.floor(this.t * 6) % 2 ? PAL.red : PAL.redShadow);
    const order = [...this.chickens].sort((a, b) => a.y - b.y);
    for (const c of order) {
      const p = this.ctx.players.find((pl) => pl.seat === c.seat)!;
      if (!c.alive) {
        const k = Math.min(1, (this.t - (c.outAt ?? 0)) / 0.5);
        if (k < 1) r.disc(c.x, c.y + k * 8, Math.max(1, Math.round(c.r * (1 - k))), p.color.shadow);
        continue;
      }
      const h = c.air > 0 ? Math.sin((c.air / AIR_TIME) * Math.PI) * 9 : 0;
      r.disc(c.x, c.y + 2, c.r - 1, PAL.yellowShadow);
      drawMover(r, { ...c, y: c.y - h }, p.color, { flash: c.stun > 0.15 });
      // 볏(빨간 머리)
      r.rect(Math.round(c.x) - 1, Math.round(c.y - h - c.r) - 1, 3, 2, PAL.red);
      if (c.charging) {
        // 모은 힘 막대
        const w = Math.round((c.charge / MAX_CHARGE) * 12);
        r.rect(Math.round(c.x) - 6, Math.round(c.y) + c.r + 3, 12, 2, PAL.line);
        r.rect(Math.round(c.x) - 6, Math.round(c.y) + c.r + 3, w, 2, w >= 12 ? PAL.red : PAL.text);
      }
    }
    drawTimer(r, DURATION - this.t, 24, 82);
  }
}

/**
 * 땅에 있을 때: 판 끝이면 가운데를 겨눠 살짝 뛰고, 아니면 가장 가까운 상대를 겨눠 거리만큼 힘을 모아 뛴다.
 * 상대가 힘을 모으고 있으면 가끔 먼저 뛴다. 난이도가 낮으면 조준이 무디고 힘 조절이 부정확하다.
 */
class ChickenAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0.4;
  private chargeFor = 0;
  private readonly tolerance: number;
  private readonly slop: number;
  private readonly react: number;

  constructor(
    private readonly game: ChickenFight,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.tolerance = byDifficulty(player.difficulty, { easy: 0.55, normal: 0.38, hard: 0.25 });
    this.slop = byDifficulty(player.difficulty, { easy: 0.35, normal: 0.2, hard: 0.1 });
    this.react = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.18, hard: 0.08 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    const me = g.chickens.find((c) => c.seat === this.player.seat)!;
    if (g.finished || !me.alive) {
      this.hand.reset();
      return;
    }
    if (me.charging) {
      this.chargeFor -= dt;
      if (this.chargeFor <= 0) this.hand.releaseIn(0);
      return;
    }
    this.wait -= dt;
    if (this.wait > 0 || me.air > 0 || me.stun > 0) return;
    const rng = g.rng;
    const fromCenter = Math.hypot(me.x - CX, me.y - CY);
    let target: { x: number; y: number };
    let dist: number;
    if (fromCenter > g.radius - 16) {
      target = { x: CX, y: CY };
      dist = 26;
    } else {
      const near = g.chickens
        .filter((c) => c !== me && c.alive)
        .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
      if (!near) return;
      target = near;
      dist = Math.hypot(near.x - me.x, near.y - me.y);
      if (dist > 110) {
        target = { x: (near.x + CX) / 2, y: (near.y + CY) / 2 };
        dist = Math.hypot(target.x - me.x, target.y - me.y) * 0.6;
      }
    }
    if (!aimHeld(me, target.x, target.y, this.tolerance)) return;
    // 뛰는 거리 ≈ 힘에 비례: 필요한 거리만큼 모은다(+오차)
    const need = Math.max(0, Math.min(1, (dist * 2.2 - HOP_MIN * AIR_TIME * 2.2) / ((HOP_MAX - HOP_MIN) * AIR_TIME * 2.2)));
    this.chargeFor = Math.max(0.03, need * MAX_CHARGE * (1 + (rng.next() - 0.5) * 2 * this.slop) * 0.85);
    this.hand.pressIn(0);
    this.wait = this.react + rng.next() * this.react;
  }
}

export const G63 = defineGame({
  code: 'G63',
  controls: 'one',
  create: () => new ChickenFight(),
  createAI: (game, player, controls) => new ChickenAI(game, player, controls),
});
