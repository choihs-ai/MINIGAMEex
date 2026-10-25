import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { anchorOf, drawScoreTag, drawTimer, TIMER_X, TIMER_Y } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G23 풍선 터뜨리기: 화면 곳곳에 풍선이 떠오른다. 자기 구역의 풍선을 직접 탭해 터뜨린다.
// 터진 풍선은 "그 풍선 색 주인"이 +1. 남의 색을 터뜨리면 그 사람 점수가 오른다.

export const DURATION = 25;
/** 참가자 1명당 초당 풍선 수 */
const BALLOONS_PER_PLAYER = 1.0;
export const LIFETIME = 1.7;
const INFLATE = 0.2;
const RISE = 16;
export const BALLOON_R = 7;
/** 탭 판정은 그림보다 넉넉하게 */
export const HIT_R = BALLOON_R + 3;
/** 버튼이 없는 게임이라 모서리도 쓴다. 가장자리만 조금 비운다. */
const MARGIN_X = 14;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 12;

export interface Balloon {
  id: number;
  /** 풍선 색 주인 */
  owner: Seat;
  x: number;
  y: number;
  born: number;
  sway: number;
}

export class BalloonPop implements MiniGame {
  readonly code = 'G23';
  t = 0;
  balloons: Balloon[] = [];
  readonly scores = new Map<Seat, number>();
  private ctx!: GameContext;
  private done = false;
  private nextId = 0;
  private spawnClock = 0.2;
  private pops: Array<{ x: number; y: number; t: number; owner: Seat }> = [];

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) this.scores.set(p.seat, 0);
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
    return Object.fromEntries(this.scores) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.scores].map(([seat, score]) => ({ seat, score })));
  }

  /** 지금 (x, y)에 그려진 풍선 위치(흔들림 포함) */
  posOf(b: Balloon, at = this.t): { x: number; y: number } {
    const age = at - b.born;
    return { x: b.x + Math.sin(age * 3 + b.sway) * 3, y: b.y - age * RISE };
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    const rng = this.ctx.rng;

    this.spawnClock -= dt;
    while (this.spawnClock <= 0) {
      this.spawnClock += 1 / (BALLOONS_PER_PLAYER * this.ctx.players.length);
      const owner = this.ctx.players[Math.floor(rng.next() * this.ctx.players.length)].seat;
      this.balloons.push({
        id: this.nextId++,
        owner,
        x: MARGIN_X + rng.next() * (320 - MARGIN_X * 2),
        y: MARGIN_TOP + LIFETIME * RISE + rng.next() * (180 - MARGIN_TOP - MARGIN_BOTTOM - LIFETIME * RISE),
        born: this.t,
        sway: rng.next() * Math.PI * 2,
      });
    }

    for (const p of this.ctx.players) {
      for (const tap of this.ctx.controls.get(p.seat)!.tapsThisTick) this.tap(tap.x, tap.y);
    }
    this.balloons = this.balloons.filter((b) => this.t - b.born < LIFETIME);
    this.pops = this.pops.filter((f) => this.t - f.t < 0.3);
    if (this.t >= DURATION) this.done = true;
  }

  /** 탭한 자리에서 가장 가까운 풍선 하나를 터뜨린다 */
  private tap(x: number, y: number): void {
    let best: Balloon | null = null;
    let bestD = HIT_R * HIT_R;
    for (const b of this.balloons) {
      const pos = this.posOf(b);
      const d = (pos.x - x) ** 2 + (pos.y - y) ** 2;
      if (d <= bestD) {
        best = b;
        bestD = d;
      }
    }
    if (!best) return;
    const pos = this.posOf(best);
    this.balloons = this.balloons.filter((b) => b !== best);
    this.scores.set(best.owner, (this.scores.get(best.owner) ?? 0) + 1);
    this.pops.push({ ...pos, t: this.t, owner: best.owner });
    this.ctx.sfx.tap();
    this.ctx.fx.burst(pos.x, pos.y, SEAT_COLORS[best.owner].base, 6);
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 사람마다 자기 구역 경계(점선)
    if (this.ctx.humanCount >= 2) {
      for (let x = 0; x < 320; x += 6) r.rect(x, 90, 3, 1, PAL.bgMid);
      if (this.ctx.humanCount >= 3) for (let y = 0; y < 180; y += 6) r.rect(160, y, 1, 3, PAL.bgMid);
    }
    for (const b of this.balloons) {
      const age = this.t - b.born;
      const pos = this.posOf(b);
      const s = Math.min(1, age / INFLATE);
      const sprite = balloonSprite(b.owner, s < 1 ? 'small' : 'full');
      // 사라지기 직전 깜빡임
      if (LIFETIME - age < 0.4 && Math.floor(this.t * 12) % 2 === 0) continue;
      r.ctx.drawImage(sprite, Math.round(pos.x - sprite.width / 2), Math.round(pos.y - BALLOON_R - 1));
    }
    for (const f of this.pops) {
      const k = (this.t - f.t) / 0.3;
      const rad = Math.round(4 + k * 8);
      const c = SEAT_COLORS[f.owner].base;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        r.rect(f.x + dx * rad, f.y + dy * rad, 2, 2, c);
      }
    }
    for (const p of this.ctx.players) {
      const a = anchorOf(p, this.ctx.humanCount, 140, 74);
      drawScoreTag(r, p, a.x, a.y - 4, this.scores.get(p.seat) ?? 0);
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }
}

const balloonCache = new Map<string, HTMLCanvasElement>();

/** 풍선(지름 15)과 매듭·줄 */
function balloonSprite(owner: Seat, size: 'small' | 'full'): HTMLCanvasElement {
  const key = `${owner}|${size}`;
  const hit = balloonCache.get(key);
  if (hit) return hit;
  const c = SEAT_COLORS[owner];
  const g = new Grid(17, 24);
  const rad = size === 'full' ? BALLOON_R : 4;
  const cy = 1 + BALLOON_R;
  g.ellipse(8.5, cy + (BALLOON_R - rad), rad, rad + (size === 'full' ? 1 : 0), c.base, c.shadow);
  if (size === 'full') {
    g.rect(5, 4, 2, 2, PAL.text);
    g.rect(7, cy + BALLOON_R + 1, 3, 2, c.shadow);
    g.line(8, cy + BALLOON_R + 3, 9, 23, PAL.bgMid);
  }
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  balloonCache.set(key, canvas);
  return canvas;
}

/** 자기 색 풍선을 알아보는 데 시간이 걸리고, 가끔 남의 색을 잘못 누르거나 빗맞힌다 */
class BalloonPopAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0.4;
  private readonly notice: number;
  private readonly interval: number;
  private readonly misTap: number;
  private readonly aim: number;
  private readonly tried = new Set<number>();

  constructor(
    private readonly game: BalloonPop,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.notice = byDifficulty(player.difficulty, { easy: 0.85, normal: 0.55, hard: 0.35 });
    this.interval = byDifficulty(player.difficulty, { easy: 0.6, normal: 0.42, hard: 0.3 });
    this.misTap = byDifficulty(player.difficulty, { easy: 0.14, normal: 0.07, hard: 0.02 });
    this.aim = byDifficulty(player.difficulty, { easy: 4, normal: 2.5, hard: 1.5 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    const rng = g.rng;
    const seen = g.balloons.filter((b) => g.t - b.born >= this.notice && !this.tried.has(b.id));
    const wrong = rng.next() < this.misTap;
    const pool = seen.filter((b) => (b.owner === this.player.seat) !== wrong);
    if (pool.length === 0) {
      this.wait = 0.1;
      return;
    }
    // 곧 사라질 풍선부터
    pool.sort((a, b) => a.born - b.born);
    const target = pool[0];
    this.tried.add(target.id);
    const delay = 0.08;
    const pos = g.posOf(target, g.t + delay);
    this.hand.tapAt(pos.x + jitter(rng, this.aim), pos.y + jitter(rng, this.aim), delay);
    this.wait = this.interval * (0.7 + rng.next() * 0.6);
  }
}

export const G23 = defineGame({
  code: 'G23',
  controls: 'pointer',
  pointer: 'area',
  create: () => new BalloonPop(),
  createAI: (game, player, controls) => new BalloonPopAI(game, player, controls),
});
