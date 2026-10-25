import type { PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawScoreTag, drawTimer, TIMER_X, TIMER_Y } from './common';
import { regionOf } from './G54';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G49 영역 잘라내기: 자기 구역의 판 안에서 공이 튄다. 판 위를 가로(또는 세로)로 쓱 그으면 그 자리에서 선이 양쪽으로 자란다.
// 선이 다 자라면 공이 없는 쪽이 잘려 나가고 그 넓이(처음 판 대비 %)만큼 점수. 자라는 선에 공이 닿으면 선이 끊기고 3점 감점.

export const DURATION = 25;
const BALL_R = 3;
const BALL_START = 55;
const BALL_END = 95;
const GROW = 150;
export const FAIL_PENALTY = 3;
/** 이보다 짧게 그으면 무시 */
const MIN_SWIPE = 10;

export interface Cut {
  horizontal: boolean;
  /** 선 위치(가로선이면 y, 세로선이면 x) */
  at: number;
  /** 자라는 선의 양 끝(가로선이면 x, 세로선이면 y) */
  a: number;
  b: number;
  origin: number;
}

export interface Board {
  seat: Seat;
  rect: Rect;
  area0: number;
  ball: { x: number; y: number; vx: number; vy: number };
  cut: Cut | null;
  score: number;
  failAt: number;
}

export class SliceArea implements MiniGame {
  readonly code = 'G49';
  t = 0;
  boards: Board[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.boards = ctx.players.map((p) => {
      const reg = regionOf(p, ctx.humanCount);
      const rect = { x: reg.x + 10, y: reg.y + 10, w: reg.w - 20, h: reg.h - 26 };
      if (reg.y === 0) rect.y += 16;
      const a = ctx.rng.next() * Math.PI * 2;
      return {
        seat: p.seat,
        rect,
        area0: rect.w * rect.h,
        ball: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, vx: Math.cos(a) * BALL_START, vy: Math.sin(a) * BALL_START },
        cut: null,
        score: 0,
        failAt: -9,
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

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.boards.map((b) => [b.seat, Math.round(b.score)])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.boards.map((b) => ({ seat: b.seat, score: Math.round(b.score * 10) })));
  }

  /** 이 판에서 (x, y)에 선을 시작할 수 있는가 */
  inside(b: Board, x: number, y: number): boolean {
    const r = b.rect;
    return x > r.x + 2 && x < r.x + r.w - 2 && y > r.y + 2 && y < r.y + r.h - 2;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    const speed = BALL_START + (BALL_END - BALL_START) * Math.min(1, this.t / DURATION);
    for (const b of this.boards) {
      // 그은 손가락 → 새 선
      for (const rel of this.ctx.controls.get(b.seat)!.releasesThisTick) {
        const dx = rel.x - rel.startX;
        const dy = rel.y - rel.startY;
        if (b.cut || Math.hypot(dx, dy) < MIN_SWIPE || !this.inside(b, rel.startX, rel.startY)) continue;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const at = horizontal ? rel.startY : rel.startX;
        const origin = horizontal ? rel.startX : rel.startY;
        b.cut = { horizontal, at, a: origin, b: origin, origin };
        this.ctx.sfx.dash();
      }
      this.moveBall(b, speed, dt);
      if (b.cut) this.grow(b, dt);
    }
    if (this.t >= DURATION) this.done = true;
  }

  private moveBall(b: Board, speed: number, dt: number): void {
    const ball = b.ball;
    const v = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx *= speed / v;
    ball.vy *= speed / v;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const r = b.rect;
    if (ball.x < r.x + BALL_R) {
      ball.x = r.x + BALL_R;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x > r.x + r.w - BALL_R) {
      ball.x = r.x + r.w - BALL_R;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y < r.y + BALL_R) {
      ball.y = r.y + BALL_R;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y > r.y + r.h - BALL_R) {
      ball.y = r.y + r.h - BALL_R;
      ball.vy = -Math.abs(ball.vy);
    }
  }

  private grow(b: Board, dt: number): void {
    const c = b.cut!;
    const r = b.rect;
    const lo = c.horizontal ? r.x : r.y;
    const hi = c.horizontal ? r.x + r.w : r.y + r.h;
    c.a = Math.max(lo, c.a - GROW * dt);
    c.b = Math.min(hi, c.b + GROW * dt);
    // 공이 자라는 선에 닿으면 실패
    const ball = b.ball;
    const across = c.horizontal ? ball.y : ball.x;
    const along = c.horizontal ? ball.x : ball.y;
    if (Math.abs(across - c.at) <= BALL_R + 1 && along >= c.a - BALL_R && along <= c.b + BALL_R) {
      b.cut = null;
      b.score -= FAIL_PENALTY;
      b.failAt = this.t;
      this.ctx.sfx.buzz();
      this.ctx.fx.shake(2, 0.12);
      return;
    }
    if (c.a > lo || c.b < hi) return;
    // 완성: 공이 없는 쪽을 잘라 낸다
    const before = r.w * r.h;
    if (c.horizontal) {
      if (ball.y < c.at) r.h = c.at - r.y;
      else {
        r.h = r.y + r.h - c.at;
        r.y = c.at;
      }
    } else if (ball.x < c.at) r.w = c.at - r.x;
    else {
      r.w = r.x + r.w - c.at;
      r.x = c.at;
    }
    b.score += ((before - r.w * r.h) * 100) / b.area0;
    b.cut = null;
    this.ctx.sfx.coin();
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (const b of this.boards) {
      const p = this.ctx.players.find((pl) => pl.seat === b.seat)!;
      const rc = b.rect;
      r.rect(rc.x - 1, rc.y - 1, rc.w + 2, rc.h + 2, this.t - b.failAt < 0.25 ? PAL.red : p.color.base);
      r.rect(rc.x, rc.y, rc.w, rc.h, PAL.bgMid);
      if (b.cut) {
        const c = b.cut;
        if (c.horizontal) r.rect(c.a, c.at, c.b - c.a, 1, PAL.yellow);
        else r.rect(c.at, c.a, 1, c.b - c.a, PAL.yellow);
      }
      r.disc(b.ball.x, b.ball.y, BALL_R, PAL.text);
      const reg = regionOf(p, this.ctx.humanCount);
      const top = reg.y === 0;
      drawScoreTag(r, p, reg.x + reg.w / 2, top ? reg.y + 8 : reg.y + reg.h - 12, `${Math.round(b.score)}%`);
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }
}

/** 공이 멀리 있을 때, 공과 먼 쪽 판을 잘라 내는 선을 긋는다. 난이도가 낮으면 공이 가까울 때도 성급하게 긋는다. */
class SliceAI implements AiController {
  private readonly hand: AiHand;
  private wait = 1;
  private readonly margin: number;
  private readonly interval: readonly [number, number];

  constructor(
    private readonly game: SliceArea,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.margin = byDifficulty(player.difficulty, { easy: 6, normal: 10, hard: 16 });
    this.interval = byDifficulty(player.difficulty, { easy: [1.8, 3.0], normal: [1.3, 2.3], hard: [0.9, 1.6] });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    const me = g.boards.find((b) => b.seat === this.player.seat)!;
    this.wait -= dt;
    if (this.wait > 0 || me.cut || this.hand.busy) return;
    const rng = g.rng;
    const r = me.rect;
    const ball = me.ball;
    const horizontal = r.h >= r.w * 0.6 ? rng.next() < 0.6 : false;
    // 공에서 margin 이상 떨어진, 큰 쪽을 자르는 위치
    let at: number;
    if (horizontal) {
      const upper = ball.y - r.y;
      const lower = r.y + r.h - ball.y;
      at = upper > lower ? ball.y - this.margin - rng.next() * 6 : ball.y + this.margin + rng.next() * 6;
      if (at <= r.y + 3 || at >= r.y + r.h - 3) return;
      const x = r.x + 4 + rng.next() * (r.w - 8);
      this.hand.drag(x, at, x + 16, at, 0, 0.12);
    } else {
      const left = ball.x - r.x;
      const right = r.x + r.w - ball.x;
      at = left > right ? ball.x - this.margin - rng.next() * 6 : ball.x + this.margin + rng.next() * 6;
      if (at <= r.x + 3 || at >= r.x + r.w - 3) return;
      const y = r.y + 4 + rng.next() * (r.h - 8);
      this.hand.drag(at, y, at, y + 16, 0, 0.12);
    }
    this.wait = this.interval[0] + rng.next() * (this.interval[1] - this.interval[0]);
  }
}

export const G49 = defineGame({
  code: 'G49',
  controls: 'pointer',
  pointer: 'area',
  create: () => new SliceArea(),
  createAI: (game, player, controls) => new SliceAI(game, player, controls),
});
