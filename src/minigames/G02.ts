import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawLine, drawMarker, drawRing, drawTimer, TIMER_X, TIMER_Y } from './common';
import { homeDir } from './players';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G02 줄다리기 리듬: 박자에 맞춰 누르면 매듭이 내 쪽으로, 빗나가면 반대로 끌려간다.
// 3~4인은 가운데 매듭을 각자 방향(모서리)으로 당긴다. 끝났을 때 매듭에 가까운 순.

export const DURATION = 30;
/** 박자 간격(초) */
export const BEAT = 0.6;
/** 박자 앞뒤로 이만큼 안이면 성공 */
export const WINDOW = 0.13;
/** 처음 몇 초는 빗나가도 안 끌려간다 */
export const GRACE = 3;
export const PULL = 3;
export const SLIP = 2;
const CX = 160;
const CY = 90;
const REACH_X = 104;
const REACH_Y = 54;

export interface Puller {
  seat: Seat;
  /** 당기는 사람 자리(매듭이 다가갈 곳) */
  ax: number;
  ay: number;
  /** 마지막으로 성공한 박자 번호(한 박자에 한 번만) */
  lastBeat: number;
  hits: number;
  hitAt: number;
  missAt: number;
}

export class RhythmTug implements MiniGame {
  readonly code = 'G02';
  knot = { x: CX, y: CY };
  pullers: Puller[] = [];
  t = 0;
  private ctx!: GameContext;
  private done = false;
  private lastTick = 0;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.pullers = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      return { seat: p.seat, ax: CX + d.x * REACH_X, ay: CY + d.y * REACH_Y, lastBeat: -1, hits: 0, hitAt: -1, missAt: -1 };
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

  /** 가장 가까운 박자 번호와 그 박자에서 얼마나 어긋났는지 */
  nearestBeat(t = this.t): { k: number; off: number } {
    const k = Math.round(t / BEAT);
    return { k, off: t - k * BEAT };
  }

  canPress(seat: Seat): boolean {
    const { k, off } = this.nearestBeat();
    const p = this.pullers.find((pl) => pl.seat === seat);
    return !this.done && k >= 1 && Math.abs(off) <= WINDOW && p?.lastBeat !== k;
  }

  distance(seat: Seat): number {
    const p = this.pullers.find((pl) => pl.seat === seat)!;
    return Math.hypot(this.knot.x - p.ax, this.knot.y - p.ay);
  }

  getRanking(): Seat[][] {
    return rankByScore(this.pullers.map((p) => ({ seat: p.seat, score: -Math.round(this.distance(p.seat)) })));
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const tick = Math.floor(this.t / BEAT);
    if (tick > this.lastTick) {
      this.lastTick = tick;
      this.ctx.sfx.turn();
    }
    for (const p of this.pullers) {
      if (!this.ctx.controls.get(p.seat)!.justPressed()) continue;
      const { k, off } = this.nearestBeat();
      if (k >= 1 && Math.abs(off) <= WINDOW && p.lastBeat !== k) {
        p.lastBeat = k;
        p.hits++;
        p.hitAt = this.t;
        this.pull(p, PULL);
        this.ctx.sfx.drum(p.seat);
      } else {
        p.missAt = this.t;
        if (this.t >= GRACE) this.pull(p, -SLIP);
      }
    }
    if (this.t >= DURATION) this.done = true;
  }

  /** 매듭을 이 사람 쪽(amount > 0) 또는 반대쪽으로 옮긴다 */
  private pull(p: Puller, amount: number): void {
    const dx = p.ax - this.knot.x;
    const dy = p.ay - this.knot.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    // 사람 바로 앞(6px)에서는 더 끌려오지 않는다
    const step = amount > 0 ? Math.max(0, Math.min(amount, len - 6)) : amount;
    this.knot.x = clamp(this.knot.x + (dx / len) * step, CX - REACH_X + 6, CX + REACH_X - 6);
    this.knot.y = clamp(this.knot.y + (dy / len) * step, CY - REACH_Y + 6, CY + REACH_Y - 6);
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(CX - 2, CY, 5, 1, PAL.bgMid);
    r.rect(CX, CY - 2, 1, 5, PAL.bgMid);

    // 줄: 그림자 위에 밝은 줄
    for (const p of this.pullers) drawLine(r, p.ax + 1, p.ay + 1, this.knot.x + 1, this.knot.y + 1, PAL.line);
    for (const p of this.pullers) drawLine(r, p.ax, p.ay, this.knot.x, this.knot.y, PAL.text);

    // 박자 고리: 다음 박자로 갈수록 매듭 쪽으로 줄어든다(2px씩 끊어서)
    const phase = (this.t % BEAT) / BEAT;
    const { off } = this.nearestBeat();
    const ringR = 6 + 2 * Math.floor(7 * (1 - phase));
    drawRing(r, this.knot.x, this.knot.y, ringR, Math.abs(off) <= WINDOW ? PAL.yellow : PAL.bgMid);
    r.disc(this.knot.x, this.knot.y, 5, PAL.line);
    r.disc(this.knot.x, this.knot.y, 4, Math.abs(off) < 0.06 ? PAL.yellow : PAL.text);

    for (const p of this.pullers) {
      const pl = this.ctx.players.find((x) => x.seat === p.seat)!;
      // 성공하면 잠깐 바깥쪽으로 젖혀진다
      const jerk = this.t - p.hitAt < 0.1 ? 2 : 0;
      const len = Math.hypot(p.ax - CX, p.ay - CY) || 1;
      const x = p.ax + ((p.ax - CX) / len) * jerk;
      const y = p.ay + ((p.ay - CY) / len) * jerk;
      r.disc(x, y, 7, PAL.line);
      r.disc(x, y, 6, pl.color.shadow);
      r.disc(x - 1, y - 1, 4, pl.color.base);
      drawMarker(r, x, y - 10, pl.color.base);
      if (this.t - p.missAt < 0.3) {
        drawLine(r, x + 6, y - 4, x + 10, y, PAL.red);
        drawLine(r, x + 10, y - 4, x + 6, y, PAL.red);
      }
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 박자마다 난이도별 확률(60/75/90%)로 맞춰 누르고, 아니면 어긋나게 누른다. */
class RhythmTugAI implements AiController {
  private readonly hand: AiHand;
  private planned = -1;
  private readonly accuracy: number;

  constructor(
    private readonly game: RhythmTug,
    player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.accuracy = byDifficulty(player.difficulty, { easy: 0.6, normal: 0.75, hard: 0.9 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    if (this.game.finished) return;
    const next = (Math.floor(this.game.t / BEAT) + 1) * BEAT;
    const k = Math.round(next / BEAT);
    if (k === this.planned || next - this.game.t > 0.4) return;
    this.planned = k;
    const rng = this.game.rng;
    const err = rng.next() < this.accuracy ? jitter(rng, 0.03) : (rng.next() < 0.5 ? -1 : 1) * (0.18 + rng.next() * 0.1);
    this.hand.tap(0, next - this.game.t + err);
  }
}

export const G02 = defineGame({
  code: 'G02',
  controls: 'one',
  create: () => new RhythmTug(),
  createAI: (game, player, controls) => new RhythmTugAI(game, player, controls),
});
