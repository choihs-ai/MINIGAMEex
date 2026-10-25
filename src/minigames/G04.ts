import { stickOf, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { anchorOf, drawMarker, drawScoreTag, drawTimer } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G04 땅따먹기 페인트(G34 영토 전쟁 흡수): 가상 조이스틱(자기 구역을 누른 채 끌기)으로 돌아다니면 지나간 바닥이 내 색.
// 남의 색도 덮어쓸 수 있고, 내 색으로 빙 둘러싼 칸은 통째로 내 것이 된다. 칠한 넓이 순.

export const CELL = 8;
export const COLS = 40;
export const ROWS = 22;
const TOP = 2;
export const DURATION = 25;
export const SPEED = 62;
const ENCLOSE_EVERY = 0.4;

export interface Painter {
  seat: Seat;
  x: number;
  y: number;
}

export class PaintLand implements MiniGame {
  readonly code = 'G04';
  t = 0;
  painters: Painter[] = [];
  /** 칸마다 주인(-1 없음) */
  readonly grid = new Int8Array(COLS * ROWS).fill(-1);
  private ctx!: GameContext;
  private done = false;
  private encloseClock = ENCLOSE_EVERY;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.painters = ctx.players.map((p) => {
      const a = anchorOf(p, ctx.humanCount, 96, 52);
      return { seat: p.seat, x: a.x, y: a.y };
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

  area(seat: Seat): number {
    let n = 0;
    for (const v of this.grid) if (v === seat) n++;
    return n;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.painters.map((p) => [p.seat, Math.round((this.area(p.seat) * 100) / (COLS * ROWS))])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.painters.map((p) => ({ seat: p.seat, score: this.area(p.seat) })));
  }

  cellOf(x: number, y: number): number {
    const cx = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
    const cy = Math.min(ROWS - 1, Math.max(0, Math.floor((y - TOP) / CELL)));
    return cy * COLS + cx;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    for (const p of this.painters) {
      const s = stickOf(this.ctx.controls.get(p.seat)!);
      p.x = Math.max(3, Math.min(317, p.x + s.x * SPEED * dt));
      p.y = Math.max(TOP + 3, Math.min(TOP + ROWS * CELL - 3, p.y + s.y * SPEED * dt));
      this.grid[this.cellOf(p.x, p.y)] = p.seat;
    }
    this.encloseClock -= dt;
    if (this.encloseClock <= 0) {
      this.encloseClock += ENCLOSE_EVERY;
      for (const p of this.painters) this.enclose(p.seat);
    }
    if (this.t >= DURATION) this.done = true;
  }

  /** 가장자리에서 내 칸을 밟지 않고 갈 수 없는 칸은 모두 내 것 */
  private enclose(seat: Seat): void {
    const seen = new Uint8Array(COLS * ROWS);
    const queue: number[] = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = i % COLS;
      const y = Math.floor(i / COLS);
      const edge = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      if (edge && this.grid[i] !== seat) {
        seen[i] = 1;
        queue.push(i);
      }
    }
    while (queue.length > 0) {
      const i = queue.pop()!;
      const x = i % COLS;
      const y = Math.floor(i / COLS);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const j = ny * COLS + nx;
        if (seen[j] || this.grid[j] === seat) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    let gained = 0;
    for (let i = 0; i < COLS * ROWS; i++) {
      if (!seen[i] && this.grid[i] !== seat) {
        this.grid[i] = seat;
        gained++;
      }
    }
    if (gained >= 4) this.ctx.sfx.coin();
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (let i = 0; i < COLS * ROWS; i++) {
      const owner = this.grid[i];
      const x = (i % COLS) * CELL;
      const y = TOP + Math.floor(i / COLS) * CELL;
      if (owner < 0) {
        r.rect(x + 3, y + 3, 1, 1, PAL.bgMid);
        continue;
      }
      const c = this.ctx.players.find((p) => p.seat === owner)!.color;
      r.rect(x, y, CELL, CELL, c.shadow);
      r.rect(x + 1, y + 1, CELL - 2, CELL - 2, c.base);
    }
    for (const p of this.painters) {
      const c = this.ctx.players.find((pl) => pl.seat === p.seat)!.color;
      r.disc(p.x, p.y, 5, PAL.line);
      r.disc(p.x, p.y, 4, PAL.text);
      r.disc(p.x, p.y, 2, c.shadow);
      drawMarker(r, p.x, p.y - 7, c.base);
    }
    const scores = this.getScores();
    for (const pl of this.ctx.players) {
      const a = anchorOf(pl, this.ctx.humanCount, 140, 78);
      drawScoreTag(r, pl, a.x, a.y - 4, `${scores[pl.seat]}%`);
    }
    drawTimer(r, DURATION - this.t, 160, 1);
  }
}

/** 작은 네모를 그리며 돌아 땅을 둘러싸 먹는다. 난이도가 낮으면 네모가 삐뚤고 느리게 꺾는다. */
class PaintAI implements AiController {
  private readonly hand: AiHand;
  private corners: Array<{ x: number; y: number }> = [];
  private wait = 0;
  private readonly interval: number;
  private readonly size: readonly [number, number];

  constructor(
    private readonly game: PaintLand,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.15, hard: 0.08 });
    this.size = byDifficulty(player.difficulty, { easy: [16, 32], normal: [24, 48], hard: [32, 64] });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;
    const me = g.painters.find((p) => p.seat === this.player.seat)!;
    if (this.corners.length === 0) this.planLoop(me);
    const target = this.corners[0];
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    const d = Math.hypot(dx, dy);
    if (d < 4) {
      this.corners.shift();
      return;
    }
    this.hand.stick(dx / d, dy / d);
  }

  /** 지금 자리에서 시작하는 네모 한 바퀴(경기장 안쪽으로) */
  private planLoop(me: { x: number; y: number }): void {
    const rng = this.game.rng;
    const w = this.size[0] + rng.next() * (this.size[1] - this.size[0]);
    const h = this.size[0] + rng.next() * (this.size[1] - this.size[0]);
    const sx = me.x < 160 ? 1 : -1;
    const sy = me.y < 90 ? 1 : -1;
    const clampX = (x: number) => Math.max(6, Math.min(314, x));
    const clampY = (y: number) => Math.max(8, Math.min(172, y));
    const x1 = clampX(me.x + sx * w);
    const y1 = clampY(me.y + sy * h);
    this.corners = [
      { x: x1, y: me.y },
      { x: x1, y: y1 },
      { x: me.x, y: y1 },
      { x: me.x, y: me.y },
      // 다음 네모는 조금 옮긴 자리에서
      { x: clampX(me.x + (rng.next() - 0.5) * 60), y: clampY(me.y + (rng.next() - 0.5) * 40) },
    ];
  }
}

export const G04 = defineGame({
  code: 'G04',
  controls: 'pointer',
  pointer: 'area',
  create: () => new PaintLand(),
  createAI: (game, player, controls) => new PaintAI(game, player, controls),
});
