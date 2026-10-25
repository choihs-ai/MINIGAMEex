import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawLine, drawMarker, drawTimer, jumpHeight, TIMER_X, TIMER_Y } from './common';
import { homeDir } from './players';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G30 회전판 점프: 가운데에서 도는 레이저가 지나갈 때 눌러서(점프) 넘는다. 걸리면 탈락. 탈락 역순.
// 점점 빨라지고, 자주 도는 방향이 바뀐다(바뀌기 직전에 레이저가 노랗게 깜빡임). 점프는 짧다.

export const DURATION = 30;
export const JUMP_TIME = 0.36;
/** 처음 이 시간 동안은 걸려도 비틀거리기만 한다 */
export const GRACE = 2;
const JUMP_PEAK = 8;
const CX = 160;
const CY = 90;
const PLATFORM_R = 72;
const RING_R = 48;
const WARN = 0.45;

export interface Hopper {
  seat: Seat;
  angle: number;
  jumpT: number | null;
  outAt: number | null;
  stumbleAt: number;
}

/** 각도 차이를 -π~π로 */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class LaserHop implements MiniGame {
  readonly code = 'G30';
  hoppers: Hopper[] = [];
  beam = 0;
  dir: 1 | -1 = 1;
  nextFlip = 0;
  t = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.hoppers = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      return { seat: p.seat, angle: Math.atan2(d.y, d.x), jumpT: null, outAt: null, stumbleAt: -1 };
    });
    // 첫 레이저는 사람들 사이(가장 넓은 빈틈 가운데)에서 시작
    const angles = this.hoppers.map((h) => h.angle).sort((a, b) => a - b);
    let best = 0;
    let gap = -1;
    angles.forEach((a, i) => {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
      if (next - a > gap) {
        gap = next - a;
        best = a + gap / 2;
      }
    });
    this.beam = best;
    this.nextFlip = 5 + ctx.rng.next() * 2;
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

  omega(t = this.t): number {
    return 2.2 + 0.09 * t;
  }

  height(h: Hopper): number {
    return jumpHeight(h.jumpT, JUMP_TIME, JUMP_PEAK);
  }

  /** 점프 중이고 바닥에서 떨어져 있는가 */
  airborne(h: Hopper): boolean {
    return h.jumpT !== null && h.jumpT > JUMP_TIME * 0.04 && h.jumpT < JUMP_TIME * 0.96;
  }

  canPress(seat: Seat): boolean {
    const h = this.hoppers.find((x) => x.seat === seat);
    return !this.done && !!h && h.outAt === null && h.jumpT === null;
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.hoppers);
  }

  /** 레이저가 이 각도에 닿을 때까지 남은 시간(지금 방향·속도 기준) */
  timeToReach(angle: number): number {
    let travel = wrapAngle(angle - this.beam) * this.dir;
    if (travel < 0) travel += Math.PI * 2;
    return travel / this.omega();
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const h of this.hoppers) {
      if (h.outAt !== null) continue;
      if (h.jumpT === null && this.ctx.controls.get(h.seat)!.justPressed()) {
        h.jumpT = 0;
        this.ctx.sfx.turn();
      } else if (h.jumpT !== null) {
        h.jumpT += dt;
        if (h.jumpT >= JUMP_TIME) h.jumpT = null;
      }
    }
    if (this.t >= this.nextFlip) {
      this.dir = this.dir === 1 ? -1 : 1;
      this.nextFlip += 3 + this.ctx.rng.next() * 2;
      this.ctx.sfx.signal();
    }
    const before = this.beam;
    this.beam = wrapAngle(this.beam + this.dir * this.omega() * dt);
    for (const h of this.hoppers) {
      if (h.outAt !== null || !crossed(before, this.beam, h.angle)) continue;
      if (this.airborne(h)) continue;
      if (this.t < GRACE) {
        h.stumbleAt = this.t;
        this.ctx.sfx.buzz();
        continue;
      }
      h.outAt = this.t;
      this.ctx.sfx.lose();
      this.ctx.fx.shake(2, 0.1);
      const p = this.ctx.players.find((pl) => pl.seat === h.seat);
      const pos = this.pos(h);
      if (p) this.ctx.fx.burst(pos.x, pos.y, p.color.base, 8);
    }
    const alive = this.hoppers.filter((h) => h.outAt === null).length;
    if (this.t >= DURATION || alive === 0 || (this.hoppers.length > 1 && alive <= 1)) this.done = true;
  }

  pos(h: Hopper): { x: number; y: number } {
    return { x: CX + Math.cos(h.angle) * RING_R, y: CY + Math.sin(h.angle) * RING_R * 0.92 };
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.disc(CX, CY, PLATFORM_R + 2, PAL.line);
    r.disc(CX, CY, PLATFORM_R, PAL.bgMid);
    const warn = this.t >= this.nextFlip - WARN && Math.floor(this.t * 10) % 2 === 0;
    const ex = CX + Math.cos(this.beam) * PLATFORM_R;
    const ey = CY + Math.sin(this.beam) * PLATFORM_R;
    const color = warn ? PAL.yellow : PAL.text;
    drawLine(r, CX, CY, ex, ey, color);
    drawLine(r, CX + 1, CY, ex + 1, ey, color);
    drawLine(r, CX, CY + 1, ex, ey + 1, color);
    r.disc(CX, CY, 5, PAL.line);
    r.disc(CX, CY, 3, color);
    for (const h of this.hoppers) this.drawHopper(r, h);
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }

  private drawHopper(r: Renderer, h: Hopper): void {
    const p = this.ctx.players.find((pl) => pl.seat === h.seat)!;
    const { x, y } = this.pos(h);
    if (h.outAt !== null) {
      drawLine(r, x - 4, y - 4, x + 4, y + 4, p.color.shadow);
      drawLine(r, x + 4, y - 4, x - 4, y + 4, p.color.shadow);
      return;
    }
    const lift = Math.round(this.height(h));
    r.rect(x - 4, y + 4, 9, 2, PAL.line);
    r.disc(x, y - lift, 6, PAL.line);
    r.disc(x, y - lift, 5, p.color.shadow);
    r.disc(x - 1, y - lift - 1, 3, p.color.base);
    drawMarker(r, x, y - lift - 9, p.color.base);
    if (this.t - h.stumbleAt < 0.5) r.text('!', x + 8, y - lift - 6, PAL.yellow);
  }
}

/** 이전 각도 → 지금 각도 사이에 target을 지났는가 */
export function crossed(before: number, after: number, target: number): boolean {
  const d0 = wrapAngle(before - target);
  const d1 = wrapAngle(after - target);
  if (Math.abs(d0) > 1 || Math.abs(d1) > 1) return false;
  return d1 === 0 || Math.sign(d0) !== Math.sign(d1);
}

/** 레이저가 닿기 조금 전에 뛴다. 도는 방향이 바뀌면 다시 계산한다. */
class LaserHopAI implements AiController {
  private readonly hand: AiHand;
  private plannedFor = -1;
  private plannedDir: 1 | -1 = 1;
  private readonly sigma: number;

  constructor(
    private readonly game: LaserHop,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.sigma = byDifficulty(player.difficulty, { easy: 0.13, normal: 0.085, hard: 0.045 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const me = this.game.hoppers.find((h) => h.seat === this.player.seat)!;
    if (this.game.finished || me.outAt !== null) return;
    if (this.game.dir !== this.plannedDir) {
      this.plannedDir = this.game.dir;
      this.plannedFor = -1;
      this.hand.reset();
    }
    const tc = this.game.timeToReach(me.angle);
    const when = Math.round((this.game.t + tc) * 20);
    if (tc > 0.6 || Math.abs(when - this.plannedFor) <= 2) return;
    this.plannedFor = when;
    this.hand.tap(0, Math.max(0, tc - JUMP_TIME / 2 + jitter(this.game.rng, this.sigma)));
  }
}

export const G30 = defineGame({
  code: 'G30',
  controls: 'one',
  create: () => new LaserHop(),
  createAI: (game, player, controls) => new LaserHopAI(game, player, controls),
});
