import type { PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawScoreTag, drawTimer, TIMER_X, TIMER_Y } from './common';
import { regionOf } from './G54';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G57 좀비 막기(협동): 가운데 기지를 향해 각자 자기 구역 가장자리에서 좀비가 걸어온다. 직접 탭해서 쓰러뜨린다.
// 한 마리라도 기지에 닿으면 모두 끝. 순위는 개인 처치 수(팀 기록은 버틴 시간).

/** 이만큼 버티면 성공으로 끝난다 */
export const DURATION = 30;
export const BASE_X = 160;
export const BASE_Y = 90;
export const BASE_R = 12;
export const ZOMBIE_R = 6;
export const HIT_R = ZOMBIE_R + 4;
/** 구역 하나에서 초당 나오는 좀비 수(시작 → 끝) */
const SPAWN_START = 0.8;
const SPAWN_END = 3.6;
const SPEED_START = 16;
const SPEED_END = 34;
const BIG_CHANCE = 0.15;

export interface Zombie {
  id: number;
  /** 이 좀비가 나온 구역의 주인 */
  lane: Seat;
  x: number;
  y: number;
  hp: number;
  big: boolean;
  speed: number;
  hitAt: number;
}

export class ZombieDefense implements MiniGame {
  readonly code = 'G57';
  t = 0;
  zombies: Zombie[] = [];
  readonly kills = new Map<Seat, number>();
  readonly regions = new Map<Seat, Rect>();
  /** 뚫린 시각(성공하면 null) */
  breachedAt: number | null = null;
  breachBy: Seat | null = null;
  private ctx!: GameContext;
  private done = false;
  private nextId = 0;
  private readonly spawnClock = new Map<Seat, number>();

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) {
      this.kills.set(p.seat, 0);
      this.regions.set(p.seat, regionOf(p, ctx.humanCount));
      this.spawnClock.set(p.seat, 0.6 + ctx.rng.next() * 0.6);
    }
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
    return Object.fromEntries(this.kills) as Partial<Record<Seat, number>>;
  }

  getContribution(): Partial<Record<Seat, number>> {
    return this.getScores();
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.kills].map(([seat, score]) => ({ seat, score })));
  }

  private progress(): number {
    return Math.min(1, this.t / DURATION);
  }

  /** 좀비가 기지를 향해 dt초 뒤에 있을 자리 */
  ahead(z: Zombie, dt: number): { x: number; y: number } {
    const dx = BASE_X - z.x;
    const dy = BASE_Y - z.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, z.speed * dt);
    return { x: z.x + (dx / d) * step, y: z.y + (dy / d) * step };
  }

  private spawn(seat: Seat): void {
    const rng = this.ctx.rng;
    const rc = this.regions.get(seat)!;
    // 화면 가장자리에 닿은 변에서만 나온다
    const edges: Array<{ len: number; at: (k: number) => { x: number; y: number } }> = [];
    if (rc.y === 0) edges.push({ len: rc.w, at: (k) => ({ x: rc.x + k * rc.w, y: -4 }) });
    if (rc.y + rc.h >= 180) edges.push({ len: rc.w, at: (k) => ({ x: rc.x + k * rc.w, y: 184 }) });
    if (rc.x === 0) edges.push({ len: rc.h, at: (k) => ({ x: -4, y: rc.y + k * rc.h }) });
    if (rc.x + rc.w >= 320) edges.push({ len: rc.h, at: (k) => ({ x: 324, y: rc.y + k * rc.h }) });
    const total = edges.reduce((s, e) => s + e.len, 0);
    let pick = rng.next() * total;
    let edge = edges[0];
    for (const e of edges) {
      if (pick < e.len) {
        edge = e;
        break;
      }
      pick -= e.len;
    }
    // 기지 바로 옆(구역 안쪽 모서리)에서 나오지 않게 가장자리 쪽 80%만 쓴다
    const pos = edge.at(0.05 + rng.next() * 0.8);
    const k = this.progress();
    const big = rng.next() < BIG_CHANCE;
    this.zombies.push({
      id: this.nextId++,
      lane: seat,
      x: pos.x,
      y: pos.y,
      hp: big ? 2 : 1,
      big,
      speed: (SPEED_START + (SPEED_END - SPEED_START) * k) * (big ? 0.7 : 1) * (0.9 + rng.next() * 0.2),
      hitAt: -1,
    });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    const k = this.progress();
    for (const p of this.ctx.players) {
      let clock = this.spawnClock.get(p.seat)! - dt;
      while (clock <= 0) {
        this.spawn(p.seat);
        clock += 1 / (SPAWN_START + (SPAWN_END - SPAWN_START) * k);
      }
      this.spawnClock.set(p.seat, clock);
    }

    for (const p of this.ctx.players) {
      for (const tap of this.ctx.controls.get(p.seat)!.tapsThisTick) this.tap(p, tap.x, tap.y);
    }

    for (const z of this.zombies) {
      const next = this.ahead(z, dt);
      z.x = next.x;
      z.y = next.y;
      if (Math.hypot(z.x - BASE_X, z.y - BASE_Y) <= BASE_R + ZOMBIE_R - 2 && this.breachedAt === null) {
        this.breachedAt = this.t;
        this.breachBy = z.lane;
        this.done = true;
        this.ctx.sfx.lose();
        this.ctx.fx.shake(4, 0.3);
      }
    }
    if (this.t >= DURATION) this.done = true;
  }

  private tap(p: PlayerInfo, x: number, y: number): void {
    let best: Zombie | null = null;
    let bestD = HIT_R * HIT_R;
    for (const z of this.zombies) {
      const d = (z.x - x) ** 2 + (z.y - (y + 2)) ** 2;
      if (d <= bestD) {
        best = z;
        bestD = d;
      }
    }
    if (!best) return;
    best.hp--;
    best.hitAt = this.t;
    // 맞으면 조금 밀려난다
    const dx = best.x - BASE_X;
    const dy = best.y - BASE_Y;
    const d = Math.hypot(dx, dy) || 1;
    best.x += (dx / d) * 4;
    best.y += (dy / d) * 4;
    if (best.hp > 0) {
      this.ctx.sfx.hit();
      return;
    }
    this.zombies = this.zombies.filter((z) => z !== best);
    this.kills.set(p.seat, (this.kills.get(p.seat) ?? 0) + 1);
    this.ctx.sfx.tap();
    this.ctx.fx.burst(best.x, best.y, PAL.green, 6);
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 구역 경계
    const multi = this.ctx.humanCount !== 2;
    for (let x = 0; x < 320; x += 6) r.rect(x, 90, 3, 1, PAL.bgMid);
    if (multi) for (let y = 0; y < 180; y += 6) r.rect(160, y, 1, 3, PAL.bgMid);
    // 기지
    r.disc(BASE_X, BASE_Y, BASE_R + 2, PAL.line);
    r.disc(BASE_X, BASE_Y, BASE_R, this.breachedAt !== null ? PAL.redShadow : PAL.bgMid);
    r.rect(BASE_X - 6, BASE_Y - 4, 12, 9, PAL.yellowShadow);
    r.rect(BASE_X - 7, BASE_Y - 6, 14, 3, PAL.red);
    r.rect(BASE_X - 2, BASE_Y + 1, 4, 4, PAL.line);

    for (const z of this.zombies) {
      const sprite = zombieSprite(z.big, this.t - z.hitAt < 0.12, Math.floor((this.t * 4 + z.id) % 2));
      r.ctx.drawImage(sprite, Math.round(z.x - sprite.width / 2), Math.round(z.y - sprite.height / 2));
    }

    for (const p of this.ctx.players) {
      // 구역 바깥 모서리에 처치 수(위/아래 반씩 나눈 2인은 그 사람 기준 오른쪽 아래)
      const rc = this.regions.get(p.seat)!;
      const top = rc.y === 0;
      const x = rc.w === 320 ? (top ? 16 : 304) : rc.x === 0 ? 16 : 304;
      drawScoreTag(r, p, x, top ? 12 : 164, this.kills.get(p.seat) ?? 0);
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
    if (this.breachedAt !== null) {
      r.rect(120, 104, 80, 14, PAL.line);
      r.text('뚫렸다!', 160, 107, PAL.red, 'center');
    } else if (this.done) {
      r.rect(120, 104, 80, 14, PAL.line);
      r.text('막아냈다!', 160, 107, PAL.yellow, 'center');
    }
  }
}

const zombieCache = new Map<string, HTMLCanvasElement>();

/** 초록 좀비(팔을 앞으로 내민 정면), 큰 좀비는 한 대 더 맞아야 쓰러진다 */
function zombieSprite(big: boolean, hit: boolean, frame: number): HTMLCanvasElement {
  const key = `${big}|${hit}|${frame}`;
  const cached = zombieCache.get(key);
  if (cached) return cached;
  const s = big ? 18 : 14;
  const g = new Grid(s, s);
  const body = hit ? PAL.text : PAL.green;
  const shade = hit ? PAL.text : PAL.greenShadow;
  const m = big ? 1 : 0;
  g.ellipse(s / 2, 4 + m, 3.5 + m, 3.5 + m, body, shade);
  g.rect(s / 2 - 3 - m, 7 + m * 2, 6 + m * 2, 5 + m, PAL.bgMid);
  g.rect(s / 2 - 5 - m, 7 + m * 2 + frame, 2, 4, body);
  g.rect(s / 2 + 3 + m, 8 + m * 2 - frame, 2, 4, body);
  g.rect(s / 2 - 2 - m, 12 + m * 3, 2, 1 + (1 - frame), shade);
  g.rect(s / 2 + 1 + m, 12 + m * 3, 2, 1 + frame, shade);
  g.rect(s / 2 - 2, 3 + m, 1, 1, PAL.red);
  g.rect(s / 2 + 1, 3 + m, 1, 1, PAL.red);
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  zombieCache.set(key, canvas);
  return canvas;
}

/** 자기 구역에서 기지에 가장 가까운 좀비부터 탭한다. 손이 빠르지 않아 몰려오면 놓친다. */
class ZombieDefenseAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0.5;
  private readonly interval: number;
  private readonly aim: number;

  constructor(
    private readonly game: ZombieDefense,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.6, normal: 0.45, hard: 0.34 });
    this.aim = byDifficulty(player.difficulty, { easy: 4, normal: 2.8, hard: 1.8 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    // 자기 구역에서 나와 화면 안에 들어온 좀비
    const seen = g.zombies.filter((z) => z.lane === this.player.seat && z.x > 0 && z.x < 320 && z.y > 0 && z.y < 180);
    if (seen.length === 0) {
      this.wait = 0.1;
      return;
    }
    seen.sort((a, b) => Math.hypot(a.x - BASE_X, a.y - BASE_Y) - Math.hypot(b.x - BASE_X, b.y - BASE_Y));
    const target = seen[0];
    const delay = 0.06;
    const pos = g.ahead(target, delay);
    const rng = g.rng;
    this.hand.tapAt(pos.x + jitter(rng, this.aim), pos.y + jitter(rng, this.aim), delay);
    this.wait = this.interval * (0.75 + rng.next() * 0.5);
  }
}

export const G57 = defineGame({
  code: 'G57',
  controls: 'pointer',
  pointer: 'area',
  create: () => new ZombieDefense(),
  createAI: (game, player, controls) => new ZombieDefenseAI(game, player, controls),
});
