import { stickOf, type PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import type { Rng } from '../core/rng';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawScoreTag, drawTimer, TIMER_X, TIMER_Y } from './common';
import { regionOf } from './G54';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G37 길 기억 미로: 모두 같은 미로가 자기 구역에 나온다. 처음 3초 동안 정답 길을 보여 주고 깜깜해진다.
// 가상 조이스틱(자기 구역에서 누른 채 끌기)으로 한 칸씩 움직여 출구(별)로. 보이지 않는 벽에 부딪히면 출발점으로.
// 먼저 도착한 순(못 가면 출구까지 남은 칸 수가 적은 순).

export const MW = 7;
export const MH = 5;
const CELL = 10;
export const SHOW = 3;
export const DURATION = 25;
/** 한 칸 움직이는 데 걸리는 시간 */
const STEP_TIME = 0.17;

/** 칸 사이 벽: right[y][x] = (x,y)와 (x+1,y) 사이, down[y][x] = (x,y)와 (x,y+1) 사이 */
export interface Maze {
  right: boolean[][];
  down: boolean[][];
  path: Array<{ x: number; y: number }>;
}

export const START = { x: 0, y: MH - 1 };
export const EXIT = { x: MW - 1, y: 0 };

export function makeMaze(rng: Rng): Maze {
  const right = Array.from({ length: MH }, () => new Array<boolean>(MW).fill(true));
  const down = Array.from({ length: MH }, () => new Array<boolean>(MW).fill(true));
  const seen = Array.from({ length: MH }, () => new Array<boolean>(MW).fill(false));
  const stack = [{ ...START }];
  seen[START.y][START.x] = true;
  while (stack.length > 0) {
    const c = stack[stack.length - 1];
    const next = [
      { x: c.x + 1, y: c.y },
      { x: c.x - 1, y: c.y },
      { x: c.x, y: c.y + 1 },
      { x: c.x, y: c.y - 1 },
    ].filter((n) => n.x >= 0 && n.y >= 0 && n.x < MW && n.y < MH && !seen[n.y][n.x]);
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const n = next[Math.floor(rng.next() * next.length)];
    if (n.x !== c.x) right[c.y][Math.min(c.x, n.x)] = false;
    else down[Math.min(c.y, n.y)][c.x] = false;
    seen[n.y][n.x] = true;
    stack.push(n);
  }
  const maze: Maze = { right, down, path: [] };
  maze.path = solve(maze, START);
  return maze;
}

export function open(m: Maze, x: number, y: number, dx: number, dy: number): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) return false;
  if (dx !== 0) return !m.right[y][Math.min(x, nx)];
  return !m.down[Math.min(y, ny)][x];
}

/** from에서 출구까지 최단 길(칸 목록, from 포함) */
export function solve(m: Maze, from: { x: number; y: number }): Array<{ x: number; y: number }> {
  const prev = new Map<number, number>();
  const key = (x: number, y: number) => y * MW + x;
  const queue = [from];
  prev.set(key(from.x, from.y), -1);
  while (queue.length > 0) {
    const c = queue.shift()!;
    if (c.x === EXIT.x && c.y === EXIT.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!open(m, c.x, c.y, dx, dy)) continue;
      const k = key(c.x + dx, c.y + dy);
      if (prev.has(k)) continue;
      prev.set(k, key(c.x, c.y));
      queue.push({ x: c.x + dx, y: c.y + dy });
    }
  }
  const path: Array<{ x: number; y: number }> = [];
  let k = key(EXIT.x, EXIT.y);
  while (k !== -1 && prev.has(k)) {
    path.unshift({ x: k % MW, y: Math.floor(k / MW) });
    k = prev.get(k)!;
  }
  return path;
}

export interface Runner {
  seat: Seat;
  region: Rect;
  flipped: boolean;
  x: number;
  y: number;
  stepClock: number;
  arrivedAt: number | null;
  bumps: Array<{ x: number; y: number; dx: number; dy: number }>;
  bumpAt: number;
}

export class MemoryMaze implements MiniGame {
  readonly code = 'G37';
  t = 0;
  maze!: Maze;
  runners: Runner[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.maze = makeMaze(ctx.rng);
    this.runners = ctx.players.map((p) => ({
      seat: p.seat,
      region: regionOf(p, ctx.humanCount),
      flipped: ctx.humanCount >= 2 && p.flipped,
      ...START,
      stepClock: 0,
      arrivedAt: null,
      bumps: [],
      bumpAt: -9,
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

  get showing(): boolean {
    return this.t < SHOW;
  }

  remaining(r: Runner): number {
    return r.arrivedAt !== null ? 0 : solve(this.maze, r).length - 1;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.runners.map((r) => [r.seat, this.remaining(r)])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    const key = (r: Runner) => (r.arrivedAt !== null ? r.arrivedAt : 1000 + this.remaining(r));
    const sorted = [...this.runners].sort((a, b) => key(a) - key(b) || a.seat - b.seat);
    const groups: Seat[][] = [];
    let last: number | null = null;
    for (const r of sorted) {
      if (key(r) === last) groups[groups.length - 1].push(r.seat);
      else groups.push([r.seat]);
      last = key(r);
    }
    return groups;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    if (!this.showing) {
      for (const r of this.runners) {
        if (r.arrivedAt !== null) continue;
        r.stepClock -= dt;
        const s = stickOf(this.ctx.controls.get(r.seat)!);
        if (r.stepClock > 0 || Math.hypot(s.x, s.y) < 0.5) continue;
        r.stepClock = STEP_TIME;
        // 화면 방향 → 미로 방향(위쪽에 앉은 사람의 미로는 돌려 그렸으므로 반대)
        let dx = Math.abs(s.x) > Math.abs(s.y) ? Math.sign(s.x) : 0;
        let dy = dx === 0 ? Math.sign(s.y) : 0;
        if (r.flipped) {
          dx = -dx;
          dy = -dy;
        }
        this.step(r, dx, dy);
      }
    }
    if (this.t >= DURATION || this.runners.every((r) => r.arrivedAt !== null)) this.done = true;
  }

  private step(r: Runner, dx: number, dy: number): void {
    if (open(this.maze, r.x, r.y, dx, dy)) {
      r.x += dx;
      r.y += dy;
      this.ctx.sfx.turn();
      if (r.x === EXIT.x && r.y === EXIT.y) {
        r.arrivedAt = this.t;
        this.ctx.sfx.coin();
      }
      return;
    }
    // 벽: 그 벽은 보이게 남기고 출발점으로
    if (!r.bumps.some((b) => b.x === r.x && b.y === r.y && b.dx === dx && b.dy === dy)) r.bumps.push({ x: r.x, y: r.y, dx, dy });
    r.x = START.x;
    r.y = START.y;
    r.bumpAt = this.t;
    this.ctx.sfx.buzz();
  }

  /** 미로 칸 (x, y)의 화면 왼쪽 위 */
  private cellPos(r: Runner, x: number, y: number): { x: number; y: number } {
    const ox = r.region.x + Math.round((r.region.w - MW * CELL) / 2);
    const oy = r.region.y + Math.round((r.region.h - MH * CELL) / 2);
    if (!r.flipped) return { x: ox + x * CELL, y: oy + y * CELL };
    return { x: ox + (MW - 1 - x) * CELL, y: oy + (MH - 1 - y) * CELL };
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (const run of this.runners) {
      const p = this.ctx.players.find((pl) => pl.seat === run.seat)!;
      const o = this.cellPos(run, 0, 0);
      const far = this.cellPos(run, MW - 1, MH - 1);
      const x0 = Math.min(o.x, far.x);
      const y0 = Math.min(o.y, far.y);
      r.rect(x0 - 2, y0 - 2, MW * CELL + 4, MH * CELL + 4, PAL.line);
      r.frame(x0 - 2, y0 - 2, MW * CELL + 4, MH * CELL + 4, this.t - run.bumpAt < 0.3 ? PAL.red : p.color.shadow);
      if (this.showing) {
        for (const c of this.maze.path) {
          const q = this.cellPos(run, c.x, c.y);
          r.rect(q.x + 2, q.y + 2, CELL - 4, CELL - 4, PAL.yellow);
        }
      }
      // 부딪혀 알게 된 벽
      for (const b of run.bumps) {
        const a = this.cellPos(run, b.x, b.y);
        const n = this.cellPos(run, b.x + b.dx, b.y + b.dy);
        const mx = (a.x + n.x) / 2 + CELL / 2;
        const my = (a.y + n.y) / 2 + CELL / 2;
        if (b.dx !== 0) r.rect(mx, my - CELL / 2, 1, CELL, PAL.red);
        else r.rect(mx - CELL / 2, my, CELL, 1, PAL.red);
      }
      const s = this.cellPos(run, START.x, START.y);
      r.rect(s.x + 1, s.y + 1, CELL - 2, CELL - 2, PAL.bgMid);
      const e = this.cellPos(run, EXIT.x, EXIT.y);
      r.rect(e.x + 3, e.y + 1, 4, 8, PAL.yellow);
      r.rect(e.x + 1, e.y + 3, 8, 4, PAL.yellow);
      const me = this.cellPos(run, run.x, run.y);
      r.disc(me.x + 5, me.y + 5, 4, PAL.line);
      r.disc(me.x + 5, me.y + 5, 3, run.arrivedAt !== null ? PAL.yellow : p.color.base);
      const tagY = run.flipped ? y0 - 12 : y0 + MH * CELL + 6;
      drawScoreTag(r, p, x0 + (MW * CELL) / 2, tagY, run.arrivedAt !== null ? '도착' : this.remaining(run));
    }
    if (this.showing) {
      r.rect(130, 84, 60, 12, PAL.line);
      r.text('길 외우기!', 160, 86, PAL.yellow, 'center');
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }
}

/** 외운 길을 따라 한 칸씩 간다. 칸마다 난이도만큼 길을 헷갈려 벽에 부딪히기도 한다. */
class MazeAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private readonly memory: number;
  private readonly interval: number;

  constructor(
    private readonly game: MemoryMaze,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.memory = byDifficulty(player.difficulty, { easy: 0.8, normal: 0.9, hard: 0.96 });
    this.interval = byDifficulty(player.difficulty, { easy: 0.42, normal: 0.3, hard: 0.22 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    const me = g.runners.find((r) => r.seat === this.player.seat)!;
    if (g.finished || g.showing || me.arrivedAt !== null) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;
    const rng = g.rng;
    const path = g.maze.path;
    const i = path.findIndex((c) => c.x === me.x && c.y === me.y);
    let dx = 0;
    let dy = 0;
    if (i >= 0 && i < path.length - 1 && rng.next() < this.memory) {
      dx = path[i + 1].x - me.x;
      dy = path[i + 1].y - me.y;
    } else {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      [dx, dy] = dirs[Math.floor(rng.next() * 4)];
    }
    if (me.flipped) {
      dx = -dx;
      dy = -dy;
    }
    // 한 칸 가도록 잠깐만 민다
    this.hand.stick(dx, dy);
    this.hand.stickRelease(0.12);
  }
}

export const G37 = defineGame({
  code: 'G37',
  controls: 'pointer',
  pointer: 'area',
  create: () => new MemoryMaze(),
  createAI: (game, player, controls) => new MazeAI(game, player, controls),
});
