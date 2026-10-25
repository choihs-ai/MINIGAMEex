import type { PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { byDifficulty } from './ai';
import { drawRing, drawTimer, TIMER_X, TIMER_Y } from './common';
import { regionOf } from './G54';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G46 손가락 트위스터: 자기 구역에 원이 하나씩 늘어난다(최대 4개, 그 뒤로는 가장 오래된 원이 다른 자리로 옮겨 간다).
// 새 원에는 정해진 시간 안에 손가락을 올리고, 이미 올린 원에서는 손가락을 떼면 안 된다. 떼거나 늦으면 탈락. 탈락 역순.

export const DURATION = 30;
export const CIRCLE_R = 9;
const MAX_CIRCLES = 4;
/** 새 원이 나오는 간격(점점 짧아진다) */
const EVERY_START = 2.6;
const EVERY_END = 1.6;
/** 새 원에 손가락을 올려야 하는 시간 */
export const REACH_TIME = 2;
/** 손가락이 잠깐 미끄러져도 봐주는 시간 */
const SLIP_GRACE = 0.3;

export interface Spot {
  x: number;
  y: number;
  born: number;
  /** 한 번이라도 손가락이 올라갔는가 */
  held: boolean;
  /** 손가락이 떨어진 시각(올라가 있으면 null) */
  offSince: number | null;
}

export interface Twister {
  seat: Seat;
  region: Rect;
  spots: Spot[];
  outAt: number | null;
}

export class FingerTwister implements MiniGame {
  readonly code = 'G46';
  t = 0;
  players: Twister[] = [];
  private nextAt = 0.6;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.players = ctx.players.map((p) => ({ seat: p.seat, region: regionOf(p, ctx.humanCount), spots: [], outAt: null }));
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
    return rankByElimination(this.players.map((p) => ({ seat: p.seat, outAt: p.outAt })));
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.players.map((p) => [p.seat, p.spots.filter((s) => s.held).length])) as Partial<Record<Seat, number>>;
  }

  private place(tw: Twister): { x: number; y: number } {
    const r = tw.region;
    const rng = this.ctx.rng;
    for (let k = 0; k < 60; k++) {
      const x = r.x + 16 + rng.next() * (r.w - 32);
      const y = r.y + 16 + rng.next() * (r.h - 32);
      if (tw.spots.every((s) => Math.hypot(s.x - x, s.y - y) > 26)) return { x, y };
    }
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    if (this.t >= this.nextAt) {
      const k = Math.min(1, this.t / DURATION);
      this.nextAt = this.t + EVERY_START + (EVERY_END - EVERY_START) * k;
      for (const tw of this.players) {
        if (tw.outAt !== null) continue;
        // 4개가 다 차면 가장 오래된 원을 없애고 새 자리에
        if (tw.spots.length >= MAX_CIRCLES) tw.spots.shift();
        tw.spots.push({ ...this.place(tw), born: this.t, held: false, offSince: null });
      }
      this.ctx.sfx.beep();
    }
    for (const tw of this.players) {
      if (tw.outAt !== null) continue;
      const fingers = this.ctx.controls.get(tw.seat)!.touching;
      for (const s of tw.spots) {
        const on = fingers.some((f) => Math.hypot(f.x - s.x, f.y - s.y) <= CIRCLE_R + 3);
        if (on) {
          if (!s.held) this.ctx.sfx.tap();
          s.held = true;
          s.offSince = null;
        } else if (s.held) {
          s.offSince ??= this.t;
        }
        const late = !s.held && this.t - s.born > REACH_TIME;
        const slipped = s.held && s.offSince !== null && this.t - s.offSince > SLIP_GRACE;
        if (late || slipped) {
          tw.outAt = this.t;
          this.ctx.sfx.lose();
          this.ctx.fx.shake(3, 0.2);
          break;
        }
      }
    }
    const alive = this.players.filter((p) => p.outAt === null).length;
    if (this.t >= DURATION || (this.players.length > 1 && alive <= 1)) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (const tw of this.players) {
      const p = this.ctx.players.find((pl) => pl.seat === tw.seat)!;
      const out = tw.outAt !== null;
      r.frame(tw.region.x + 1, tw.region.y + 1, tw.region.w - 2, tw.region.h - 2, out ? PAL.bgMid : p.color.shadow);
      for (const s of tw.spots) {
        const urgent = !s.held && this.t - s.born > REACH_TIME * 0.6 && Math.floor(this.t * 10) % 2 === 0;
        r.disc(s.x, s.y, CIRCLE_R + 1, PAL.line);
        r.disc(s.x, s.y, CIRCLE_R, out ? PAL.bgMid : s.held ? p.color.base : p.color.shadow);
        if (!s.held && !out) {
          // 남은 시간만큼 줄어드는 고리
          const k = Math.max(0, 1 - (this.t - s.born) / REACH_TIME);
          drawRing(r, s.x, s.y, CIRCLE_R + 2 + Math.round(k * 6), urgent ? PAL.red : PAL.text);
        }
      }
      if (out) r.text('탈락', tw.region.x + tw.region.w / 2, tw.region.y + tw.region.h / 2 - 4, PAL.text, 'center');
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }
}

/** 새 원이 보이면 반응 시간 뒤 손가락(가상)을 올린다. 원이 많아질수록 가끔 손가락이 미끄러진다. */
class TwisterAI implements AiController {
  private readonly seen = new Set<Spot>();
  private readonly reach: readonly [number, number];
  private readonly slip: number;
  private pending: Array<{ spot: Spot; at: number }> = [];
  private t = 0;
  private readonly ids = new Map<Spot, number>();
  private nextId = 100;

  constructor(
    private readonly game: FingerTwister,
    private readonly player: PlayerInfo,
    private readonly controls: PlayerControls,
  ) {
    this.reach = byDifficulty(player.difficulty, { easy: [0.9, 2.3], normal: [0.6, 1.7], hard: [0.4, 1.1] });
    this.slip = byDifficulty(player.difficulty, { easy: 0.07, normal: 0.04, hard: 0.015 });
  }

  think(dt: number): void {
    this.t += dt;
    const g = this.game;
    const me = g.players.find((p) => p.seat === this.player.seat)!;
    if (g.finished || me.outAt !== null) return;
    const rng = g.rng;
    // 사라진 원에서는 손가락을 뗀다
    for (const [spot, id] of this.ids) {
      if (!me.spots.includes(spot)) {
        this.controls.pointerUp(id);
        this.ids.delete(spot);
      }
    }
    for (const s of me.spots) {
      if (this.seen.has(s)) continue;
      this.seen.add(s);
      this.pending.push({ spot: s, at: this.t + this.reach[0] + rng.next() * (this.reach[1] - this.reach[0]) });
      // 손가락이 많을수록 새로 뻗다가 다른 손가락이 미끄러질 수 있다
      if (this.ids.size >= 2 && rng.next() < this.slip * this.ids.size) {
        const [spot, id] = [...this.ids][0];
        this.controls.pointerUp(id);
        this.ids.delete(spot);
      }
    }
    this.pending = this.pending.filter((p) => {
      if (p.at > this.t) return true;
      if (me.spots.includes(p.spot)) {
        const id = this.nextId++;
        this.controls.pointerDown(p.spot.x, p.spot.y, id);
        this.ids.set(p.spot, id);
      }
      return false;
    });
  }
}

export const G46 = defineGame({
  code: 'G46',
  controls: 'pointer',
  pointer: 'area',
  create: () => new FingerTwister(),
  createAI: (game, player, controls) => new TwisterAI(game, player, controls),
});
