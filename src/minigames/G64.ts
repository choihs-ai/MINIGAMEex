import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL, type Color } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawScoreTag, drawTimer, anchorOf } from './common';
import { bounceIn, collideMovers, DEFAULT_DRIVE, drawMover, drive, makeMover, MoverAI, type DriveOpts, type Mover } from './mover';
import { homeDir } from './players';
import { defineGame, type GameContext, type MiniGame } from './types';

// G64 왕관 뺏기: 원버튼(떼면 제자리 회전, 누르면 돌진). 가운데 왕관을 먼저 줍고, 왕관 쓴 사람에게 부딪히면 빼앗는다.
// 왕관을 쓰면 조금 느려진다. 빼앗은 직후 잠깐은 다시 못 뺏는다. 왕관을 오래 쓴 순.

export const DURATION = 30;
export const ARENA = { x0: 14, y0: 20, x1: 306, y1: 172 };
/** 빼앗은 뒤 다시 못 뺏는 시간 */
export const GUARD = 1;
const HOLDER_DRIVE: DriveOpts = { ...DEFAULT_DRIVE, maxSpeed: DEFAULT_DRIVE.maxSpeed * 0.85, thrust: DEFAULT_DRIVE.thrust * 0.9 };

export class CrownSteal implements MiniGame {
  readonly code = 'G64';
  t = 0;
  movers: Mover[] = [];
  holder: Seat | null = null;
  /** 바닥에 떨어진 왕관 자리(누가 쓰고 있으면 무시) */
  crown = { x: 160, y: 96 };
  guardUntil = 0;
  readonly held = new Map<Seat, number>();
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.movers = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      return makeMover(p.seat, 160 + d.x * 110, 96 + d.y * 52, 160, 96, 7);
    });
    for (const p of ctx.players) this.held.set(p.seat, 0);
    // 왕관 자리는 가운데 근처 아무 데나(누가 먼저 닿을지 매번 다르게)
    this.crown = { x: 160 + (ctx.rng.next() - 0.5) * 70, y: 96 + (ctx.rng.next() - 0.5) * 40 };
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

  /** 지금 왕관이 있는 곳 */
  get crownPos(): { x: number; y: number } {
    if (this.holder === null) return this.crown;
    return this.movers.find((m) => m.seat === this.holder)!;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries([...this.held].map(([s, v]) => [s, Math.floor(v)])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.held].map(([seat, v]) => ({ seat, score: Math.round(v * 20) })));
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const m of this.movers) {
      drive(m, this.ctx.controls.get(m.seat)!.isDown(), dt, m.seat === this.holder ? HOLDER_DRIVE : DEFAULT_DRIVE);
      bounceIn(m, ARENA.x0, ARENA.y0, ARENA.x1, ARENA.y1);
    }
    for (const [a, b] of collideMovers(this.movers)) {
      this.ctx.sfx.hit();
      if (this.holder === null || this.t < this.guardUntil) continue;
      if (a.seat === this.holder) this.give(b.seat);
      else if (b.seat === this.holder) this.give(a.seat);
    }
    if (this.holder === null) {
      const m = this.movers.find((mv) => Math.hypot(mv.x - this.crown.x, mv.y - this.crown.y) < mv.r + 4);
      if (m) this.give(m.seat);
    } else this.held.set(this.holder, this.held.get(this.holder)! + dt);
    if (this.t >= DURATION) this.done = true;
  }

  private give(seat: Seat): void {
    this.holder = seat;
    this.guardUntil = this.t + GUARD;
    this.ctx.sfx.coin();
    const m = this.movers.find((mv) => mv.seat === seat)!;
    this.ctx.fx.burst(m.x, m.y - 8, PAL.yellow, 8);
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(ARENA.x0 - 2, ARENA.y0 - 2, ARENA.x1 - ARENA.x0 + 4, ARENA.y1 - ARENA.y0 + 4, PAL.line);
    r.rect(ARENA.x0, ARENA.y0, ARENA.x1 - ARENA.x0, ARENA.y1 - ARENA.y0, PAL.bgMid);
    for (const m of this.movers) {
      const p = this.ctx.players.find((pl) => pl.seat === m.seat)!;
      drawMover(r, m, p.color, { marker: m.seat !== this.holder, flash: m.stun > 0.15 });
    }
    const c = this.crownPos;
    const guard = this.holder !== null && this.t < this.guardUntil && Math.floor(this.t * 10) % 2 === 0;
    drawCrown(r, Math.round(c.x), Math.round(c.y) - (this.holder === null ? 0 : 13), guard ? PAL.text : PAL.yellow);
    for (const p of this.ctx.players) {
      const a = anchorOf(p, this.ctx.humanCount, 128, 82);
      drawScoreTag(r, p, a.x, a.y - 4, Math.floor(this.held.get(p.seat)!));
    }
    drawTimer(r, DURATION - this.t, 160, 4);
  }
}

/** 9×6 왕관 */
export function drawCrown(r: Renderer, cx: number, cy: number, color: Color = PAL.yellow): void {
  r.rect(cx - 5, cy - 4, 11, 8, PAL.line);
  r.rect(cx - 4, cy - 1, 9, 4, color);
  for (const dx of [-4, 0, 4]) r.rect(cx + dx, cy - 3, 1, 2, color);
  r.rect(cx - 1, cy, 2, 2, PAL.red);
}

export const G64 = defineGame({
  code: 'G64',
  controls: 'one',
  create: () => new CrownSteal(),
  createAI: (game, player, controls) => {
    const me = () => game.movers.find((m) => m.seat === player.seat)!;
    return new MoverAI(
      me,
      () => {
        const m = me();
        if (game.holder !== m.seat) return game.crownPos;
        // 왕관을 쓰면 가장 가까운 추격자 반대쪽으로 도망(벽에 몰리면 벽을 따라)
        const chaser = game.movers
          .filter((o) => o !== m)
          .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
        if (!chaser) return null;
        const d = Math.hypot(m.x - chaser.x, m.y - chaser.y) || 1;
        const ax = ARENA;
        const x = Math.max(ax.x0 + 20, Math.min(ax.x1 - 20, m.x + ((m.x - chaser.x) / d) * 60));
        const y = Math.max(ax.y0 + 20, Math.min(ax.y1 - 20, m.y + ((m.y - chaser.y) / d) * 60));
        if (Math.hypot(x - m.x, y - m.y) < 25) return { x: 160 + (160 - m.x) * 0.5, y: 96 + (96 - m.y) * 0.5 };
        return { x, y };
      },
      player.difficulty,
      controls,
      game,
    );
  },
});
