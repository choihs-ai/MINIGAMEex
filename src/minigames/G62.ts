import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawTimer } from './common';
import { homeDir } from './players';
import { collideMovers, drive, drawMover, makeMover, MoverAI, type Mover } from './mover';
import { defineGame, type GameContext, type MiniGame } from './types';

// G62 범퍼카: 원버튼(떼면 제자리에서 돌고, 누르면 그쪽으로 돌진). 네모 판 위에서 서로 들이받아 떨어뜨린다.
// 시간이 지나면 판 바닥 칸이 깜빡이다 무너진다. 떨어지면 탈락, 탈락 역순.

export const DURATION = 30;
export const TILE = 20;
export const COLS = 10;
export const ROWS = 7;
export const X0 = 60;
export const Y0 = 20;
const CRUMBLE_START = 5;
const CRUMBLE_EVERY = 0.5;
/** 한 바퀴(가장자리 한 줄)씩 안쪽으로 들어오는 간격 */
const RING_EVERY = 6;
const WARN = 1;
const FALL_TIME = 0.5;
const RAM_MASS = 1.8;

export class BumperCars implements MiniGame {
  readonly code = 'G62';
  t = 0;
  cars: Mover[] = [];
  /** 칸 상태: 0 바닥, 양수 = 무너질 시각, -1 무너짐 */
  readonly tiles = new Float32Array(COLS * ROWS);
  private nextCrumble = CRUMBLE_START;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.cars = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      return makeMover(p.seat, 160 + d.x * 60, 90 + d.y * 40, 160, 90, 8);
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

  canPress(seat: Seat): boolean {
    return !this.done && !!this.cars.find((c) => c.seat === seat)?.alive;
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.cars.map((c) => ({ seat: c.seat, outAt: c.outAt })));
  }

  solid(x: number, y: number): boolean {
    const cx = Math.floor((x - X0) / TILE);
    const cy = Math.floor((y - Y0) / TILE);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
    return this.tiles[cy * COLS + cx] >= 0;
  }

  /** 두 점 사이가 모두 바닥(깜빡이는 칸 제외)인가 */
  pathSafe(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
    // 지금 서 있는 칸은 빼고 본다
    for (let k = 1; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const y = y0 + ((y1 - y0) * k) / n;
      const cx = Math.floor((x - X0) / TILE);
      const cy = Math.floor((y - Y0) / TILE);
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || this.tiles[cy * COLS + cx] !== 0) return false;
    }
    return true;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const c of this.cars) {
      if (!c.alive) continue;
      const held = this.ctx.controls.get(c.seat)!.isDown();
      drive(c, held, dt);
      // 달리는 차가 더 무겁다: 가만히 있다가 받히면 멀리 날아간다
      c.mass = held && c.stun <= 0 ? RAM_MASS : 1;
    }
    for (const [, , v] of collideMovers(this.cars)) {
      this.ctx.sfx.hit();
      this.ctx.fx.shake(Math.min(4, 1 + v / 50), 0.1);
    }
    // 바닥 무너지기: 바깥 칸부터 무작위로
    if (this.t >= this.nextCrumble) {
      this.nextCrumble += CRUMBLE_EVERY;
      const candidates: number[] = [];
      for (let i = 0; i < COLS * ROWS; i++) {
        if (this.tiles[i] !== 0) continue;
        const x = i % COLS;
        const y = Math.floor(i / COLS);
        const edge = Math.min(x, y, COLS - 1 - x, ROWS - 1 - y);
        if (edge <= Math.floor(this.t / RING_EVERY)) candidates.push(i);
      }
      // 한 번에 두 칸씩(가장 바깥 줄부터)
      for (let k = 0; k < 2 && candidates.length > 0; k++) {
        const j = Math.floor(this.ctx.rng.next() * candidates.length);
        this.tiles[candidates[j]] = this.t + WARN;
        candidates.splice(j, 1);
      }
    }
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] > 0 && this.t >= this.tiles[i]) this.tiles[i] = -1;
    for (const c of this.cars) {
      if (!c.alive || this.solid(c.x, c.y)) continue;
      c.alive = false;
      c.outAt = this.t;
      this.ctx.sfx.lose();
      this.ctx.fx.burst(c.x, c.y, this.ctx.players.find((p) => p.seat === c.seat)!.color.base, 10);
    }
    const alive = this.cars.filter((c) => c.alive).length;
    if (this.t >= DURATION || (this.cars.length > 1 && alive <= 1)) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const blink = Math.floor(this.t * 8) % 2 === 0;
    for (let i = 0; i < COLS * ROWS; i++) {
      const s = this.tiles[i];
      if (s < 0) continue;
      const x = X0 + (i % COLS) * TILE;
      const y = Y0 + Math.floor(i / COLS) * TILE;
      const warn = s > 0 && blink;
      r.rect(x, y, TILE, TILE, PAL.line);
      r.rect(x + 1, y + 1, TILE - 2, TILE - 2, warn ? PAL.redShadow : (i + Math.floor(i / COLS)) % 2 ? PAL.bgMid : PAL.yellowShadow);
    }
    for (const c of this.cars) {
      const p = this.ctx.players.find((pl) => pl.seat === c.seat)!;
      if (!c.alive) {
        const k = Math.min(1, (this.t - (c.outAt ?? 0)) / FALL_TIME);
        if (k < 1) r.disc(c.x, c.y, Math.max(1, Math.round(c.r * (1 - k))), p.color.shadow);
        continue;
      }
      drawMover(r, c, p.color, { flash: c.stun > 0.15 });
    }
    drawTimer(r, DURATION - this.t, 24, 82);
  }
}

export const G62 = defineGame({
  code: 'G62',
  controls: 'one',
  create: () => new BumperCars(),
  createAI: (game, player, controls) => {
    const me = () => game.cars.find((c) => c.seat === player.seat)!;
    // 노리는 상대를 가끔 바꾼다(가까울수록 자주 고른다)
    let prey: Seat | null = null;
    let repick = 0;
    return new MoverAI(
      me,
      () => {
        const m = me();
        const center = { x: 160, y: 90 };
        const foes = game.cars.filter((c) => c !== m && c.alive);
        if (prey === null || game.t >= repick || !foes.some((c) => c.seat === prey)) {
          const w = foes.map((c) => 1 / (20 + Math.hypot(c.x - m.x, c.y - m.y)));
          let x = game.rng.next() * w.reduce((a, b) => a + b, 0);
          prey = foes.find((_, i) => (x -= w[i]) <= 0)?.seat ?? foes[0]?.seat ?? null;
          repick = game.t + 2 + game.rng.next() * 2;
        }
        const near = foes.find((c) => c.seat === prey);
        // 이대로 미끄러지면 떨어질 것 같거나 가는 길에 구멍이 있으면, 가까운 안전한 칸으로
        const slide = { x: m.x + m.vx * 0.3 + Math.cos(m.heading) * 12, y: m.y + m.vy * 0.3 + Math.sin(m.heading) * 12 };
        if (near && game.solid(slide.x, slide.y) && game.pathSafe(m.x, m.y, near.x, near.y)) return near;
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (let i = 0; i < COLS * ROWS; i++) {
          if (game.tiles[i] !== 0) continue;
          const x = X0 + (i % COLS) * TILE + TILE / 2;
          const y = Y0 + Math.floor(i / COLS) * TILE + TILE / 2;
          // 가운데 쪽 칸을 조금 더 좋아한다
          const d = Math.hypot(x - m.x, y - m.y) + Math.hypot(x - 160, y - 90) * 0.5;
          if (d < bestD && game.pathSafe(m.x, m.y, x, y)) {
            bestD = d;
            best = { x, y };
          }
        }
        return best ?? center;
      },
      player.difficulty,
      controls,
      game,
    );
  },
});
