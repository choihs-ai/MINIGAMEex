import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { anchorOf, drawScoreTag, drawTimer } from './common';
import { bounceIn, collideMovers, drawMover, drive, makeMover, MoverAI, type Mover } from './mover';
import { homeDir } from './players';
import { defineGame, type GameContext, type MiniGame } from './types';

// G66 꼬리 뺏기: 원버튼(떼면 제자리 회전, 누르면 돌진). 모두 꼬리 3마디를 달고 시작한다.
// 남의 꼬리에 머리를 박으면 그 사람 꼬리 끝 한 마디를 떼어 내 꼬리에 붙인다. 꼬리가 긴 순.

export const DURATION = 30;
export const START_TAIL = 3;
export const ARENA = { x0: 10, y0: 18, x1: 310, y1: 174 };
/** 마디 사이 거리 */
const GAP = 7;
/** 꼬리 위치 기록 간격 */
const STEP = 1.75;
const SEG_R = 3;
/** 한 번 떼어 간 뒤 다시 뗄 수 있을 때까지 */
export const GRAB_COOLDOWN = 0.7;

export interface Snake extends Mover {
  tail: number;
  /** 머리가 지나온 길(마지막이 가장 최근) */
  trail: Array<{ x: number; y: number }>;
  grabAt: number;
  lostAt: number;
}

export class TailTag implements MiniGame {
  readonly code = 'G66';
  t = 0;
  snakes: Snake[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.snakes = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      const m = makeMover(p.seat, 160 + d.x * 100, 96 + d.y * 48, 160, 96, 6);
      const trail: Array<{ x: number; y: number }> = [];
      // 바라보는 반대쪽으로 꼬리가 늘어선 채 시작
      const back = Math.round((GAP * 10) / STEP);
      for (let i = back; i > 0; i--) trail.push({ x: m.x - Math.cos(m.heading) * i * STEP, y: m.y - Math.sin(m.heading) * i * STEP });
      return { ...m, tail: START_TAIL, trail, grabAt: -9, lostAt: -9 };
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

  /** i번째 마디(0이 머리 바로 뒤) 자리 */
  segment(s: Snake, i: number): { x: number; y: number } {
    const k = s.trail.length - 1 - Math.round(((i + 1) * GAP) / STEP);
    return s.trail[Math.max(0, k)];
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.snakes.map((s) => [s.seat, s.tail])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.snakes.map((s) => ({ seat: s.seat, score: s.tail })));
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const s of this.snakes) {
      drive(s, this.ctx.controls.get(s.seat)!.isDown(), dt);
      bounceIn(s, ARENA.x0, ARENA.y0, ARENA.x1, ARENA.y1);
      const last = s.trail[s.trail.length - 1];
      let d = Math.hypot(s.x - last.x, s.y - last.y);
      while (d >= STEP) {
        const p = s.trail[s.trail.length - 1];
        s.trail.push({ x: p.x + ((s.x - p.x) / d) * STEP, y: p.y + ((s.y - p.y) / d) * STEP });
        d -= STEP;
      }
      const keep = Math.round(((s.tail + 3) * GAP) / STEP) + 2;
      if (s.trail.length > keep) s.trail.splice(0, s.trail.length - keep);
    }
    if (collideMovers(this.snakes, 0.8, 30).length > 0) this.ctx.sfx.hit();
    for (const s of this.snakes) this.grab(s);
    if (this.t >= DURATION) this.done = true;
  }

  private grab(s: Snake): void {
    if (this.t - s.grabAt < GRAB_COOLDOWN) return;
    for (const o of this.snakes) {
      if (o === s || o.tail === 0) continue;
      for (let i = 0; i < o.tail; i++) {
        const seg = this.segment(o, i);
        if (Math.hypot(seg.x - s.x, seg.y - s.y) > s.r + SEG_R + 2) continue;
        o.tail--;
        o.lostAt = this.t;
        s.tail++;
        s.grabAt = this.t;
        this.ctx.sfx.coin();
        this.ctx.fx.burst(seg.x, seg.y, this.ctx.players.find((p) => p.seat === o.seat)!.color.base, 6);
        return;
      }
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(ARENA.x0 - 1, ARENA.y0 - 1, ARENA.x1 - ARENA.x0 + 2, ARENA.y1 - ARENA.y0 + 2, PAL.line);
    r.rect(ARENA.x0, ARENA.y0, ARENA.x1 - ARENA.x0, ARENA.y1 - ARENA.y0, PAL.bgMid);
    for (const s of this.snakes) {
      const c = this.ctx.players.find((p) => p.seat === s.seat)!.color;
      const flash = this.t - s.lostAt < 0.3 && Math.floor(this.t * 20) % 2 === 0;
      for (let i = s.tail - 1; i >= 0; i--) {
        const seg = this.segment(s, i);
        r.disc(seg.x, seg.y, SEG_R + 1, PAL.line);
        r.disc(seg.x, seg.y, SEG_R, flash ? PAL.text : i === s.tail - 1 ? c.shadow : c.base);
      }
    }
    for (const s of this.snakes) {
      const p = this.ctx.players.find((pl) => pl.seat === s.seat)!;
      drawMover(r, s, p.color, { flash: s.stun > 0.15 });
    }
    for (const p of this.ctx.players) {
      const a = anchorOf(p, this.ctx.humanCount, 134, 84);
      drawScoreTag(r, p, a.x, a.y - 4, this.snakes.find((s) => s.seat === p.seat)!.tail);
    }
    drawTimer(r, DURATION - this.t, 160, 2);
  }
}

export const G66 = defineGame({
  code: 'G66',
  controls: 'one',
  create: () => new TailTag(),
  createAI: (game, player, controls) => {
    const me = () => game.snakes.find((s) => s.seat === player.seat)!;
    return new MoverAI(
      me,
      () => {
        const m = me();
        // 가장 가까운 남의 꼬리 끝을 노린다
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const o of game.snakes) {
          if (o === m || o.tail === 0) continue;
          const seg = game.segment(o, o.tail - 1);
          const d = Math.hypot(seg.x - m.x, seg.y - m.y);
          if (d < bestD) {
            bestD = d;
            best = seg;
          }
        }
        return best;
      },
      player.difficulty,
      controls,
      game,
    );
  },
});
