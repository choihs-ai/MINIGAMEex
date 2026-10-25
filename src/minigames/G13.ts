import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawMarker, drawTimer, TIMER_X, TIMER_Y } from './common';
import { homeDir } from './players';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G13 스모 밀어내기: 연타로 힘을 모으고, 연타를 멈추면(0.3초) 가장 가까운 상대에게 돌진한다.
// 링 밖으로 밀려나면 탈락. 탈락 역순. 힘을 모으는 중에는 버티는 힘(무게)이 세진다.

export const RING_X = 160;
export const RING_Y = 90;
export const RING_R = 62;
export const BODY_R = 8;
export const DURATION = 30;
/** 이 시간 동안 새로 안 누르면 돌진 */
export const RELEASE_GAP = 0.3;
export const CHARGE_PER_TAP = 0.12;
const MIN_CHARGE = 0.1;
const DASH_BASE = 60;
const DASH_GAIN = 170;
const FRICTION = 3.3;
const RESTITUTION = 0.8;
const START_DIST = 34;
const FALL_TIME = 0.5;

export interface Wrestler {
  seat: Seat;
  x: number;
  y: number;
  vx: number;
  vy: number;
  charge: number;
  /** 마지막으로 누른 시각 */
  lastTap: number;
  alive: boolean;
  outAt: number | null;
  fall: number;
  /** 돌진한 시각(그림용) */
  dashAt: number;
}

export class SumoPush implements MiniGame {
  readonly code = 'G13';
  t = 0;
  wrestlers: Wrestler[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.wrestlers = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      const len = Math.hypot(d.x, d.y) || 1;
      return {
        seat: p.seat,
        x: RING_X + (d.x / len) * START_DIST,
        y: RING_Y + (d.y / len) * START_DIST,
        vx: 0,
        vy: 0,
        charge: 0,
        lastTap: -1,
        alive: true,
        outAt: null,
        fall: 0,
        dashAt: -1,
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

  canPress(seat: Seat): boolean {
    return !this.done && (this.wrestlers.find((w) => w.seat === seat)?.alive ?? false);
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.wrestlers.map((w) => ({ seat: w.seat, outAt: w.outAt })));
  }

  /** 가장 가까운 살아 있는 상대 */
  nearest(w: Wrestler): Wrestler | null {
    let best: Wrestler | null = null;
    let bestD = Infinity;
    for (const o of this.wrestlers) {
      if (o === w || !o.alive) continue;
      const d = Math.hypot(o.x - w.x, o.y - w.y);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  /** 힘을 모으는 중(무게가 늘어난다) */
  charging(w: Wrestler): boolean {
    return w.charge > 0;
  }

  update(dt: number): void {
    for (const w of this.wrestlers) if (!w.alive) w.fall += dt;
    if (this.done) return;
    this.t += dt;

    for (const w of this.wrestlers) {
      if (!w.alive) continue;
      const c = this.ctx.controls.get(w.seat)!;
      if (c.justPressed()) {
        w.charge = Math.min(1, w.charge + CHARGE_PER_TAP);
        w.lastTap = this.t;
        this.ctx.sfx.drum(w.seat);
      } else if (w.charge > 0 && this.t - w.lastTap >= RELEASE_GAP) {
        if (w.charge >= MIN_CHARGE) this.dash(w);
        w.charge = 0;
      }
      const k = Math.exp(-FRICTION * dt);
      w.vx *= k;
      w.vy *= k;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
    }
    this.collide();
    for (const w of this.wrestlers) {
      if (!w.alive) continue;
      if (Math.hypot(w.x - RING_X, w.y - RING_Y) > RING_R) {
        w.alive = false;
        w.outAt = this.t;
        w.charge = 0;
        this.ctx.sfx.lose();
        const p = this.ctx.players.find((pl) => pl.seat === w.seat);
        if (p) this.ctx.fx.burst(w.x, w.y, p.color.base, 10);
      }
    }
    const alive = this.wrestlers.filter((w) => w.alive).length;
    if (this.t >= DURATION || (this.wrestlers.length > 1 && alive <= 1)) this.done = true;
  }

  private dash(w: Wrestler): void {
    const target = this.nearest(w);
    if (!target) return;
    const dx = target.x - w.x;
    const dy = target.y - w.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = DASH_BASE + DASH_GAIN * w.charge;
    w.vx = (dx / d) * speed;
    w.vy = (dy / d) * speed;
    w.dashAt = this.t;
    this.ctx.sfx.dash();
  }

  private collide(): void {
    const alive = this.wrestlers.filter((w) => w.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= BODY_R * 2 || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = BODY_R * 2 - dist;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing <= 0) continue;
        const ma = this.charging(a) ? 2 : 1;
        const mb = this.charging(b) ? 2 : 1;
        const imp = ((1 + RESTITUTION) * closing) / (1 / ma + 1 / mb);
        a.vx -= (nx * imp) / ma;
        a.vy -= (ny * imp) / ma;
        b.vx += (nx * imp) / mb;
        b.vy += (ny * imp) / mb;
        this.ctx.sfx.hit();
        this.ctx.fx.shake(Math.min(4, 1 + closing / 60), 0.1);
      }
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 씨름판: 모래 원과 가장자리 띠
    r.disc(RING_X, RING_Y, RING_R + 4, PAL.line);
    r.disc(RING_X, RING_Y, RING_R + 2, PAL.text);
    r.disc(RING_X, RING_Y, RING_R, PAL.yellowShadow);
    r.rect(RING_X - 14, RING_Y - 9, 2, 18, PAL.bgMid);
    r.rect(RING_X + 13, RING_Y - 9, 2, 18, PAL.bgMid);

    for (const w of this.wrestlers) if (!w.alive && w.fall < FALL_TIME) this.drawWrestler(r, w);
    for (const w of this.wrestlers) if (w.alive) this.drawWrestler(r, w);
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }

  private drawWrestler(r: Renderer, w: Wrestler): void {
    const p = this.ctx.players.find((pl) => pl.seat === w.seat)!;
    if (!w.alive) {
      const size = [6, 4, 2][Math.min(2, Math.floor((w.fall / FALL_TIME) * 3))];
      r.disc(w.x, w.y, size + 1, PAL.line);
      r.disc(w.x, w.y, size, p.color.shadow);
      return;
    }
    const sprite = sumoSprite(p.color, this.t - w.dashAt < 0.3);
    r.ctx.drawImage(sprite, Math.round(w.x - sprite.width / 2), Math.round(w.y - sprite.height / 2));
    drawMarker(r, w.x, w.y - 11, p.color.base);
    // 모은 힘 막대
    if (w.charge > 0) {
      const bw = 14;
      r.rect(w.x - bw / 2 - 1, w.y + 10, bw + 2, 4, PAL.line);
      r.rect(w.x - bw / 2, w.y + 11, Math.round(bw * w.charge), 2, w.charge >= 1 ? PAL.yellow : p.color.base);
    }
  }
}

const sumoCache = new Map<string, HTMLCanvasElement>();

/** 위에서 본 씨름꾼(동그란 몸 + 머리띠) */
function sumoSprite(color: SeatColor, dashing: boolean): HTMLCanvasElement {
  const key = `${color.base}|${dashing}`;
  const hit = sumoCache.get(key);
  if (hit) return hit;
  const g = new Grid(19, 19);
  g.ellipse(9.5, 9.5, 8, 8, color.base, color.shadow);
  g.ellipse(9.5, 9.5, 4, 4, PAL.text, PAL.yellowShadow);
  g.rect(5, 9, 9, 2, PAL.line);
  if (dashing) {
    g.rect(1, 4, 2, 2, PAL.text);
    g.rect(16, 4, 2, 2, PAL.text);
  }
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  sumoCache.set(key, canvas);
  return canvas;
}

/** 난이도만큼 빠르게 연타해 힘을 모은 뒤 멈춘다. 상대가 가까우면 덜 모으고 바로 들이받는다. */
class SumoAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0.3;
  private target = 0.6;
  private readonly tapGap: number;
  private readonly greed: readonly [number, number];

  constructor(
    private readonly game: SumoPush,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.tapGap = byDifficulty(player.difficulty, { easy: 0.2, normal: 0.14, hard: 0.1 });
    this.greed = byDifficulty(player.difficulty, { easy: [0.3, 0.9], normal: [0.45, 1], hard: [0.6, 1] });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    const me = g.wrestlers.find((w) => w.seat === this.player.seat)!;
    if (!me.alive) return;
    this.wait -= dt;
    if (this.wait > 0 || this.hand.busy) return;
    const rng = g.rng;
    // 아직 미끄러지는 중이면 기다린다
    if (Math.hypot(me.vx, me.vy) > 25) {
      this.wait = 0.1;
      return;
    }
    if (me.charge === 0) {
      const [lo, hi] = this.greed;
      this.target = lo + rng.next() * (hi - lo);
      // 링 가장자리에 몰렸으면 크게 모아 버틴다
      if (Math.hypot(me.x - RING_X, me.y - RING_Y) > RING_R * 0.7) this.target = 1;
    }
    if (me.charge < this.target) {
      this.hand.tap(0, 0, 0.04);
      this.wait = this.tapGap * (0.8 + rng.next() * 0.4);
    } else {
      // 힘을 다 모았으면 손을 떼고 돌진을 기다린다
      this.wait = RELEASE_GAP + 0.1 + rng.next() * 0.3;
    }
  }
}

export const G13 = defineGame({
  code: 'G13',
  controls: 'one',
  create: () => new SumoPush(),
  createAI: (game, player, controls) => new SumoAI(game, player, controls),
});
