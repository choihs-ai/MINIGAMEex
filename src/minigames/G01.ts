import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawMarker, drawTimer } from './common';
import { homeDir } from './players';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G01 팽이 난투: 원형 경기장에서 서로 부딪혀 밖으로 밀어낸다.
// 조작(원버튼): 팽이는 저절로 앞으로 가며 한쪽으로 휘어 돈다. 누르는 순간 휘는 방향이 바뀌고, 계속 누르고 있으면 직진 돌진.

export const ARENA_X = 160;
export const ARENA_Y = 90;
export const ARENA_R = 74;
export const TOP_R = 7;
export const DURATION = 40;
/** 처음 몇 초는 가장자리에 벽이 있어 떨어지지 않는다(실패해도 손해 적게) */
export const SAFE_TIME = 3;

const START_DIST = 44;
const SPEED = 42;
const DASH_SPEED = 125;
const TURN_RATE = 2.4;
/** 이만큼 누르고 있어야 돌진(짧은 탭은 방향 전환만) */
export const DASH_DELAY = 0.15;
const DASH_DRAIN = 1 / 0.6;
const DASH_REGEN = 0.55;
const DASH_MIN = 0.25;
const STEER = 4;
const STEER_STUNNED = 1.2;
const STUN_TIME = 0.3;
const RESTITUTION = 0.9;
const MIN_KNOCK = 45;
const FALL_TIME = 0.5;

export interface Top {
  seat: Seat;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  turn: 1 | -1;
  energy: number;
  dashing: boolean;
  stun: number;
  alive: boolean;
  /** 떨어진 시각(경기 시작 기준 초). 살아 있으면 null */
  outAt: number | null;
  fall: number;
  trail: Array<{ x: number; y: number }>;
}

export class SpinningTopBattle implements MiniGame {
  readonly code = 'G01';
  tops: Top[] = [];
  t = 0;
  private ctx!: GameContext;
  private done = false;
  private ranking: Seat[][] = [];

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.tops = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      const len = Math.hypot(d.x, d.y) || 1;
      const x = ARENA_X + (d.x / len) * START_DIST;
      const y = ARENA_Y + (d.y / len) * START_DIST;
      return {
        seat: p.seat,
        x,
        y,
        vx: 0,
        vy: 0,
        heading: Math.atan2(ARENA_Y - y, ARENA_X - x),
        turn: p.seat === 0 || p.seat === 3 ? 1 : -1,
        energy: 1,
        dashing: false,
        stun: 0,
        alive: true,
        outAt: null,
        fall: 0,
        trail: [],
      };
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

  getRanking(): Seat[][] {
    return this.ranking;
  }

  canPress(seat: Seat): boolean {
    return !this.done && (this.tops.find((t) => t.seat === seat)?.alive ?? false);
  }

  update(dt: number): void {
    for (const top of this.tops) if (!top.alive) top.fall += dt;
    if (this.done) return;
    this.t += dt;

    for (const top of this.tops) {
      if (top.alive) this.steer(top, this.ctx.controls.get(top.seat)!, dt);
    }
    this.collide();
    for (const top of this.tops) if (top.alive) this.checkEdge(top);

    const alive = this.tops.filter((t) => t.alive);
    if (this.t >= DURATION || (this.tops.length > 1 && alive.length <= 1)) this.finish();
  }

  private steer(top: Top, c: PlayerControls, dt: number): void {
    if (c.justPressed()) {
      top.turn = top.turn === 1 ? -1 : 1;
      this.ctx.sfx.turn();
    }
    const wantDash = c.isDown() && c.heldFor() >= DASH_DELAY && (top.dashing || top.energy >= DASH_MIN);
    if (wantDash && top.energy > 0) {
      if (!top.dashing) this.ctx.sfx.dash();
      top.dashing = true;
      top.energy = Math.max(0, top.energy - DASH_DRAIN * dt);
    } else {
      top.dashing = false;
      top.energy = Math.min(1, top.energy + DASH_REGEN * dt);
    }
    if (!top.dashing) top.heading += TURN_RATE * top.turn * dt;

    const speed = top.dashing ? DASH_SPEED : SPEED;
    const k = Math.min(1, (top.stun > 0 ? STEER_STUNNED : STEER) * dt);
    top.vx += (Math.cos(top.heading) * speed - top.vx) * k;
    top.vy += (Math.sin(top.heading) * speed - top.vy) * k;
    top.stun = Math.max(0, top.stun - dt);
    top.x += top.vx * dt;
    top.y += top.vy * dt;

    if (top.dashing) top.trail.unshift({ x: top.x, y: top.y });
    else top.trail.pop();
    if (top.trail.length > 4) top.trail.length = 4;
  }

  /** 팽이끼리 부딪힘: 질량이 같은 반발 충돌. 돌진 중이면 무거워서 더 세게 민다. */
  private collide(): void {
    const alive = this.tops.filter((t) => t.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= TOP_R * 2 || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        // 겹친 만큼 떼어 놓는다
        const overlap = TOP_R * 2 - dist;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;

        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing <= 0) continue;
        const ma = a.dashing ? 2 : 1;
        const mb = b.dashing ? 2 : 1;
        const j0 = ((1 + RESTITUTION) * closing) / (1 / ma + 1 / mb);
        const ka = Math.max(j0 / ma, MIN_KNOCK);
        const kb = Math.max(j0 / mb, MIN_KNOCK);
        a.vx -= nx * ka;
        a.vy -= ny * ka;
        b.vx += nx * kb;
        b.vy += ny * kb;
        a.stun = STUN_TIME;
        b.stun = STUN_TIME;
        this.ctx.sfx.hit();
        this.ctx.fx.shake(2, 0.08);
      }
    }
  }

  private checkEdge(top: Top): void {
    const dx = top.x - ARENA_X;
    const dy = top.y - ARENA_Y;
    const dist = Math.hypot(dx, dy);
    if (this.t < SAFE_TIME) {
      // 보호 시간: 가장자리 벽에 튕긴다
      const limit = ARENA_R - TOP_R;
      if (dist > limit) {
        const nx = dx / dist;
        const ny = dy / dist;
        top.x = ARENA_X + nx * limit;
        top.y = ARENA_Y + ny * limit;
        const out = top.vx * nx + top.vy * ny;
        if (out > 0) {
          top.vx -= 2 * out * nx;
          top.vy -= 2 * out * ny;
        }
      }
      return;
    }
    if (dist > ARENA_R) {
      top.alive = false;
      top.outAt = this.t;
      top.dashing = false;
      this.ctx.sfx.lose();
      const p = this.ctx.players.find((pl) => pl.seat === top.seat);
      if (p) this.ctx.fx.burst(top.x, top.y, p.color.base, 10);
    }
  }

  private finish(): void {
    this.done = true;
    const survivors = this.tops.filter((t) => t.alive).map((t) => t.seat);
    const out = this.tops.filter((t) => !t.alive).sort((a, b) => b.outAt! - a.outAt!);
    const groups: Seat[][] = survivors.length > 0 ? [survivors] : [];
    let last: number | null = null;
    for (const t of out) {
      if (t.outAt === last) groups[groups.length - 1].push(t.seat);
      else groups.push([t.seat]);
      last = t.outAt;
    }
    this.ranking = groups;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 경기장: 보호 시간에는 가장자리가 노랗게(벽) 깜빡인다
    const safe = this.t < SAFE_TIME && !this.done;
    const edge = safe && Math.floor(this.t * 4) % 2 === 0 ? PAL.yellow : PAL.text;
    r.disc(ARENA_X, ARENA_Y, ARENA_R + 3, PAL.line);
    r.disc(ARENA_X, ARENA_Y, ARENA_R + 1, edge);
    r.disc(ARENA_X, ARENA_Y, ARENA_R - 1, PAL.bgMid);
    r.rect(ARENA_X - 2, ARENA_Y, 5, 1, PAL.bgDark);
    r.rect(ARENA_X, ARENA_Y - 2, 1, 5, PAL.bgDark);

    // 떨어지는 팽이(작아지며 사라짐)를 먼저, 살아 있는 팽이를 위에
    for (const top of this.tops) if (!top.alive && top.fall < FALL_TIME) this.drawTop(r, top);
    for (const top of this.tops) if (top.alive) this.drawTop(r, top);
    // 경기장 밖 왼쪽 빈자리에 남은 시간
    drawTimer(r, DURATION - this.t, 24, 82);
  }

  private drawTop(r: Renderer, top: Top): void {
    const p = this.ctx.players.find((pl) => pl.seat === top.seat)!;
    const { base, shadow } = p.color;
    const x = Math.round(top.x);
    const y = Math.round(top.y);
    if (!top.alive) {
      // 3단계로 작아진다
      const size = [5, 3, 1][Math.min(2, Math.floor((top.fall / FALL_TIME) * 3))];
      r.disc(x, y, size + 1, PAL.line);
      r.disc(x, y, size, shadow);
      return;
    }
    for (const [i, t] of top.trail.entries()) {
      if (i === 0) continue;
      r.rect(t.x - 1, t.y - 1, 3, 3, shadow);
    }
    r.disc(x, y, TOP_R, PAL.line);
    r.disc(x, y, TOP_R - 1, shadow);
    r.disc(x - 1, y - 1, TOP_R - 2, base);
    // 회전 무늬: 8단계로 끊어서 돈다
    const spin = (Math.floor(this.t * 14) % 8) * (Math.PI / 8) * top.turn;
    for (let k = 2; k <= 4; k++) {
      r.rect(x + Math.round(Math.cos(spin) * k), y + Math.round(Math.sin(spin) * k), 1, 1, shadow);
      r.rect(x - Math.round(Math.cos(spin) * k), y - Math.round(Math.sin(spin) * k), 1, 1, shadow);
    }
    r.rect(x - 1, y - 1, 2, 2, PAL.text);
    // 진행 방향 점 + 휘는 방향 점
    const hx = x + Math.round(Math.cos(top.heading) * 11);
    const hy = y + Math.round(Math.sin(top.heading) * 11);
    r.rect(hx - 1, hy - 1, 2, 2, PAL.text);
    if (!top.dashing) {
      const a = top.heading + top.turn * 0.55;
      r.rect(x + Math.round(Math.cos(a) * 15), y + Math.round(Math.sin(a) * 15), 1, 1, PAL.text);
    }
    // 돌진 게이지(가득 차 있으면 숨김)
    if (top.energy < 1) {
      r.rect(x - 6, y + 9, 13, 3, PAL.line);
      r.rect(x - 5, y + 10, Math.round(11 * top.energy), 1, top.energy >= DASH_MIN ? base : PAL.bgDark);
    }
    drawMarker(r, x, y - TOP_R - 3, base);
  }
}

/** 가장 가까운 상대를 쫓고, 가장자리에 가까우면 가운데로 피한다. */
class TopAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private readonly reaction: number;
  private readonly edgeFrac: number;

  constructor(
    private readonly game: SpinningTopBattle,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.reaction = byDifficulty(player.difficulty, { easy: 0.45, normal: 0.25, hard: 0.12 });
    this.edgeFrac = byDifficulty(player.difficulty, { easy: 0.86, normal: 0.72, hard: 0.62 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const me = this.game.tops.find((t) => t.seat === this.player.seat);
    if (!me || !me.alive || this.game.finished) return;
    this.wait -= dt;
    if (this.wait > 0 || this.hand.busy) return;
    this.wait = this.reaction;

    const fromCenter = Math.hypot(me.x - ARENA_X, me.y - ARENA_Y);
    let tx = ARENA_X;
    let ty = ARENA_Y;
    let chasing = false;
    if (fromCenter < ARENA_R * this.edgeFrac) {
      const others = this.game.tops.filter((t) => t.alive && t !== me);
      const target = others.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
      if (target) {
        tx = target.x;
        ty = target.y;
        chasing = true;
      }
    }
    const want = Math.atan2(ty - me.y, tx - me.x);
    let diff = want - me.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const dist = Math.hypot(tx - me.x, ty - me.y);

    if (chasing && Math.abs(diff) < 0.3 && dist < 70 && me.energy > 0.6 && fromCenter < ARENA_R * 0.6) {
      // 누르는 순간 방향이 바뀌지만 돌진하는 동안은 직진하므로 그대로 꾹 누른다
      this.hand.tap(0, 0, 0.3 + this.game.rng.next() * 0.2);
    } else if (Math.sign(diff) !== me.turn && Math.abs(diff) > 0.35) {
      this.hand.tap(0, 0, 0.05);
    }
  }
}

export const G01 = defineGame({
  code: 'G01',
  controls: 'one',
  create: () => new SpinningTopBattle(),
  createAI: (game, player, controls) => new TopAI(game, player, controls),
});
