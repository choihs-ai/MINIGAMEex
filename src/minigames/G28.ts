import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawLine, drawMarker, drawTimer, jumpHeight, TIMER_X, TIMER_Y } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G28 줄넘기 생존: 가운데에서 도는 줄을 눌러서(점프) 넘는다. 줄은 점점 빨라지고, 걸리면 탈락. 탈락 역순.

export const DURATION = 30;
export const JUMP_TIME = 0.42;
const JUMP_PEAK = 14;
/** 줄이 발밑을 지나갈 때 이만큼은 떠 있어야 안 걸린다 */
export const CLEAR_H = 2;
/** 처음 이만큼 지나가는 줄에는 걸려도 비틀거리기만 한다(손해 적게) */
export const GRACE_PASSES = 1;
const GROUND_Y = 150;
const PIVOT_Y = 118;
const ROPE_R = GROUND_Y - PIVOT_Y;
const LEFT_X = 70;
const RIGHT_X = 250;

/** 줄 한 바퀴 시간: 1.6초에서 시작해 점점 빨라진다(끝날 무렵 0.65초) */
export function ropePeriod(t: number): number {
  return Math.max(0.65, 1.6 - t * 0.033);
}

export interface Jumper {
  seat: Seat;
  x: number;
  jumpT: number | null;
  outAt: number | null;
  stumbleAt: number;
}

export class JumpRope implements MiniGame {
  readonly code = 'G28';
  jumpers: Jumper[] = [];
  /** 줄의 위상: 정수 + 0.5일 때 줄이 바닥(발밑)을 지난다 */
  phase = -0.5;
  passes = 0;
  t = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const ordered = [...ctx.players].sort((a, b) => a.seat - b.seat);
    this.jumpers = ordered.map((p, i) => ({
      seat: p.seat,
      x: Math.round(100 + (120 * (i + 0.5)) / ordered.length),
      jumpT: null,
      outAt: null,
      stumbleAt: -1,
    }));
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

  height(j: Jumper): number {
    return jumpHeight(j.jumpT, JUMP_TIME, JUMP_PEAK);
  }

  canPress(seat: Seat): boolean {
    const j = this.jumpers.find((x) => x.seat === seat);
    return !this.done && !!j && j.outAt === null && j.jumpT === null;
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.jumpers);
  }

  /** 다음에 줄이 발밑을 지날 때까지 남은 시간(지금 속도 기준) */
  timeToNextPass(): number {
    const next = Math.floor(this.phase - 0.5) + 1.5;
    return (next - this.phase) * ropePeriod(this.t);
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const j of this.jumpers) {
      if (j.outAt !== null) continue;
      if (j.jumpT === null && this.ctx.controls.get(j.seat)!.justPressed()) {
        j.jumpT = 0;
        this.ctx.sfx.turn();
      } else if (j.jumpT !== null) {
        j.jumpT += dt;
        if (j.jumpT >= JUMP_TIME) j.jumpT = null;
      }
    }

    const before = this.phase;
    this.phase += dt / ropePeriod(this.t);
    if (Math.floor(this.phase - 0.5) > Math.floor(before - 0.5)) this.ropePass();

    const alive = this.jumpers.filter((j) => j.outAt === null).length;
    if (this.t >= DURATION || alive === 0 || (this.jumpers.length > 1 && alive <= 1)) this.done = true;
  }

  private ropePass(): void {
    this.passes++;
    this.ctx.sfx.tap();
    for (const j of this.jumpers) {
      if (j.outAt !== null || this.height(j) >= CLEAR_H) continue;
      if (this.passes <= GRACE_PASSES) {
        j.stumbleAt = this.t;
        this.ctx.sfx.buzz();
        continue;
      }
      j.outAt = this.t;
      this.ctx.sfx.lose();
      this.ctx.fx.shake(2, 0.1);
      const p = this.ctx.players.find((pl) => pl.seat === j.seat);
      if (p) this.ctx.fx.burst(j.x, GROUND_Y - 6, p.color.base, 8);
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(LEFT_X - 6, GROUND_Y + 1, RIGHT_X - LEFT_X + 12, 2, PAL.bgMid);
    // 줄 돌리는 기둥
    for (const x of [LEFT_X, RIGHT_X]) {
      r.rect(x - 2, PIVOT_Y - 2, 4, GROUND_Y - PIVOT_Y + 3, PAL.line);
      r.rect(x - 1, PIVOT_Y - 1, 2, GROUND_Y - PIVOT_Y + 2, PAL.bgMid);
    }
    const front = Math.sin(this.phase * Math.PI * 2) > 0;
    if (!front) this.drawRope(r);
    for (const j of this.jumpers) this.drawJumper(r, j);
    if (front) this.drawRope(r);
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }

  private drawRope(r: Renderer): void {
    const swing = Math.cos(this.phase * Math.PI * 2);
    let px = LEFT_X;
    let py = PIVOT_Y;
    for (let x = LEFT_X + 4; x <= RIGHT_X; x += 4) {
      const s = Math.sin((Math.PI * (x - LEFT_X)) / (RIGHT_X - LEFT_X));
      const y = Math.round(PIVOT_Y - ROPE_R * swing * s);
      drawLine(r, px, py, x, y, PAL.text);
      px = x;
      py = y;
    }
  }

  private drawJumper(r: Renderer, j: Jumper): void {
    const p = this.ctx.players.find((pl) => pl.seat === j.seat)!;
    const { base, shadow } = p.color;
    if (j.outAt !== null) {
      // 걸려 넘어진 모습
      r.rect(j.x - 7, GROUND_Y - 5, 14, 6, PAL.line);
      r.rect(j.x - 6, GROUND_Y - 4, 12, 4, shadow);
      return;
    }
    const h = Math.round(this.height(j));
    const y = GROUND_Y - h;
    if (h > 0) r.rect(j.x - 4, GROUND_Y, 8, 1, PAL.line);
    const legs = h > 0 ? 2 : 4;
    r.rect(j.x - 4, y - legs - 1, 3, legs + 1, PAL.line);
    r.rect(j.x + 1, y - legs - 1, 3, legs + 1, PAL.line);
    r.rect(j.x - 3, y - legs, 1, legs, shadow);
    r.rect(j.x + 2, y - legs, 1, legs, shadow);
    const bodyY = y - legs - 11;
    r.rect(j.x - 6, bodyY - 1, 12, 13, PAL.line);
    r.rect(j.x - 5, bodyY, 10, 11, base);
    r.rect(j.x - 5, bodyY + 8, 10, 3, shadow);
    r.rect(j.x - 3, bodyY + 2, 2, 1, PAL.text);
    drawMarker(r, j.x, bodyY - 4, base);
    if (this.t - j.stumbleAt < 0.5) r.text('!', j.x + 8, bodyY, PAL.yellow);
  }
}

/** 줄이 발밑을 지나기 조금 전에 뛴다(난이도별 오차). */
class JumpRopeAI implements AiController {
  private readonly hand: AiHand;
  private plannedPass = -1;
  private readonly sigma: number;

  constructor(
    private readonly game: JumpRope,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.sigma = byDifficulty(player.difficulty, { easy: 0.15, normal: 0.1, hard: 0.05 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const me = this.game.jumpers.find((j) => j.seat === this.player.seat)!;
    if (this.game.finished || me.outAt !== null) return;
    const pass = this.game.passes + 1;
    const tc = this.game.timeToNextPass();
    if (pass === this.plannedPass || tc > 0.6) return;
    this.plannedPass = pass;
    this.hand.tap(0, Math.max(0, tc - 0.21 + jitter(this.game.rng, this.sigma)));
  }
}

export const G28 = defineGame({
  code: 'G28',
  controls: 'one',
  create: () => new JumpRope(),
  createAI: (game, player, controls) => new JumpRopeAI(game, player, controls),
});
