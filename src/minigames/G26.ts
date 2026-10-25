import { BTN_LEFT, BTN_RIGHT, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawMarker, drawTimer } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G26 뱀 꼬리 잡기: 뱀은 저절로 앞으로 가고, 지나간 자리는 벽이 된다. 벽·남의 꼬리·내 꼬리에 부딪히면 탈락.
// 좌우 버튼은 "뱀이 보는 방향" 기준으로 90도 꺾기(누가 봐도 똑같다). 탈락 역순.

export const CELL = 4;
export const COLS = 80;
export const ROWS = 45;
export const DURATION = 30;
/** 한 칸 가는 데 걸리는 시간: 처음엔 느리게 시작해 점점 빨라진다 */
export const STEP_SLOW = 0.11;
export const STEP_FAST = 0.07;
const RAMP_TIME = 10;
/** 모서리 버튼 자리는 막아 둔다(칸 단위) */
export const CORNER_COLS = 22;
export const CORNER_ROWS = 11;

/** 0 오른쪽, 1 아래, 2 왼쪽, 3 위(시계 방향 순서) */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export interface Snake {
  seat: Seat;
  x: number;
  y: number;
  dir: Dir;
  /** 다음 칸들에서 꺾을 방향(-1 왼쪽, 1 오른쪽). 너무 쌓이지 않게 두 개까지 */
  turns: Array<-1 | 1>;
  alive: boolean;
  outAt: number | null;
  length: number;
}

/** 모서리 버튼 자리인가 */
export function blockedCorner(x: number, y: number): boolean {
  const left = x < CORNER_COLS;
  const right = x >= COLS - CORNER_COLS;
  const top = y < CORNER_ROWS;
  const bottom = y >= ROWS - CORNER_ROWS;
  return (left || right) && (top || bottom);
}

/** 시작 자리: 바람개비 모양으로 서로 비켜 간다. 2인은 위·아래에서 엇갈려. */
function startOf(seat: Seat, twoPlayer: boolean): { x: number; y: number; dir: Dir } {
  if (twoPlayer) return seat === 0 ? { x: 24, y: 33, dir: 0 } : { x: 55, y: 11, dir: 2 };
  return [
    { x: 26, y: 11, dir: 0 },
    { x: 54, y: 11, dir: 1 },
    { x: 26, y: 33, dir: 3 },
    { x: 54, y: 33, dir: 2 },
  ][seat] as { x: number; y: number; dir: Dir };
}

export class SnakeTail implements MiniGame {
  readonly code = 'G26';
  t = 0;
  snakes: Snake[] = [];
  /** 칸마다 주인(없으면 -1) */
  readonly grid = new Int8Array(COLS * ROWS).fill(-1);
  steps = 0;
  private stepClock = STEP_SLOW;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const two = ctx.players.length === 2;
    this.snakes = ctx.players.map((p) => {
      const s = startOf(p.seat, two);
      this.grid[s.y * COLS + s.x] = p.seat;
      return { seat: p.seat, x: s.x, y: s.y, dir: s.dir, turns: [], alive: true, outAt: null, length: 1 };
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
    return rankByElimination(this.snakes.map((s) => ({ seat: s.seat, outAt: s.outAt })));
  }

  stepTime(): number {
    return STEP_SLOW + (STEP_FAST - STEP_SLOW) * Math.min(1, this.t / RAMP_TIME);
  }

  free(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS && !blockedCorner(x, y) && this.grid[y * COLS + x] < 0;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const c = this.ctx.controls.get(s.seat)!;
      if (c.justPressed(BTN_LEFT) && s.turns.length < 2) s.turns.push(-1);
      if (c.justPressed(BTN_RIGHT) && s.turns.length < 2) s.turns.push(1);
    }
    this.stepClock -= dt;
    while (this.stepClock <= 0 && !this.done) {
      this.stepClock += this.stepTime();
      this.step();
    }
    if (this.t >= DURATION) this.done = true;
  }

  private step(): void {
    this.steps++;
    const moving = this.snakes.filter((s) => s.alive);
    const targets = new Map<Snake, number>();
    for (const s of moving) {
      const turn = s.turns.shift();
      if (turn) s.dir = ((s.dir + turn + 4) % 4) as Dir;
      targets.set(s, (s.y + DY[s.dir]) * COLS + (s.x + DX[s.dir]));
    }
    const dead: Snake[] = [];
    for (const s of moving) {
      const nx = s.x + DX[s.dir];
      const ny = s.y + DY[s.dir];
      const cell = targets.get(s)!;
      const clash = moving.some((o) => o !== s && targets.get(o) === cell);
      if (!this.free(nx, ny) || clash) dead.push(s);
    }
    for (const s of moving) {
      if (dead.includes(s)) continue;
      s.x += DX[s.dir];
      s.y += DY[s.dir];
      s.length++;
      this.grid[s.y * COLS + s.x] = s.seat;
    }
    for (const s of dead) {
      s.alive = false;
      s.outAt = this.t;
      this.ctx.sfx.hit();
      const p = this.ctx.players.find((pl) => pl.seat === s.seat);
      if (p) this.ctx.fx.burst(s.x * CELL + 2, s.y * CELL + 2, p.color.base, 10);
    }
    if (dead.length > 0) this.ctx.fx.shake(3, 0.15);
    const alive = this.snakes.filter((s) => s.alive).length;
    if (this.snakes.length > 1 && alive <= 1) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 모서리(버튼 자리)는 막힌 벽
    const cw = CORNER_COLS * CELL;
    const ch = CORNER_ROWS * CELL;
    for (const [x, y] of [[0, 0], [320 - cw, 0], [0, 180 - ch], [320 - cw, 180 - ch]]) {
      r.rect(x, y, cw, ch, PAL.line);
    }
    r.frame(0, 0, 320, 180, PAL.bgMid);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const owner = this.grid[y * COLS + x];
        if (owner < 0) continue;
        const s = this.snakes.find((sn) => sn.seat === owner)!;
        const color = this.ctx.players.find((p) => p.seat === owner)!.color;
        r.rect(x * CELL, y * CELL, CELL, CELL, s.alive ? color.shadow : PAL.bgMid);
      }
    }
    for (const s of this.snakes) {
      const p = this.ctx.players.find((pl) => pl.seat === s.seat)!;
      const hx = s.x * CELL;
      const hy = s.y * CELL;
      r.rect(hx - 1, hy - 1, CELL + 2, CELL + 2, PAL.line);
      r.rect(hx, hy, CELL, CELL, s.alive ? p.color.base : PAL.bgMid);
      if (s.alive) drawMarker(r, hx + 2, hy - 3, p.color.base);
    }
    drawTimer(r, DURATION - this.t, 160, 1);
  }
}

/** 앞·왼쪽·오른쪽 중 갈 수 있는 빈 칸이 가장 넓은 쪽으로 간다. 난이도가 낮으면 멀리 보지 못한다. */
class SnakeAI implements AiController {
  private readonly hand: AiHand;
  private lastStep = -1;
  private readonly depth: number;
  private readonly blunder: number;

  constructor(
    private readonly game: SnakeTail,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.depth = byDifficulty(player.difficulty, { easy: 25, normal: 70, hard: 220 });
    this.blunder = byDifficulty(player.difficulty, { easy: 0.06, normal: 0.025, hard: 0.005 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    const me = g.snakes.find((s) => s.seat === this.player.seat)!;
    if (!me.alive || g.steps === this.lastStep || me.turns.length > 0) return;
    this.lastStep = g.steps;
    const rng = g.rng;
    const options: Array<{ turn: -1 | 0 | 1; score: number }> = ([0, -1, 1] as const).map((turn) => {
      const dir = ((me.dir + turn + 4) % 4) as Dir;
      const nx = me.x + DX[dir];
      const ny = me.y + DY[dir];
      if (!g.free(nx, ny)) return { turn, score: -1 };
      // 바로 앞이 막히는지 + 그쪽 빈 공간 넓이
      let run = 0;
      while (run < 8 && g.free(nx + DX[dir] * (run + 1), ny + DY[dir] * (run + 1))) run++;
      const space = this.reach(nx, ny, this.depth);
      return { turn, score: space * 10 + run + (turn === 0 ? 3 : 0) + rng.next() * 2 };
    });
    options.sort((a, b) => b.score - a.score);
    let pick = options[0];
    if (rng.next() < this.blunder && options[1].score >= 0) pick = options[1];
    if (pick.turn !== 0) this.hand.tap(pick.turn < 0 ? BTN_LEFT : BTN_RIGHT, 0, 0.03);
  }

  /** (x, y)에서 갈 수 있는 빈 칸 수(limit까지만 센다) */
  private reach(x: number, y: number, limit: number): number {
    const g = this.game;
    const seen = new Set<number>([y * COLS + x]);
    const queue = [y * COLS + x];
    while (queue.length > 0 && seen.size < limit) {
      const cur = queue.shift()!;
      const cx = cur % COLS;
      const cy = Math.floor(cur / COLS);
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        const key = ny * COLS + nx;
        if (seen.has(key) || !g.free(nx, ny)) continue;
        seen.add(key);
        queue.push(key);
      }
    }
    return Math.min(seen.size, limit);
  }
}

export const G26 = defineGame({
  code: 'G26',
  controls: 'leftRight',
  create: () => new SnakeTail(),
  createAI: (game, player, controls) => new SnakeAI(game, player, controls),
});
