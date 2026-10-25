import { stickOf, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { anchorOf, drawMarker, drawScoreTag, drawTimer } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G58 우주 쓰레기 청소: 가상 조이스틱으로 우주선을 몰아 떠다니는 쓰레기에 닿으면 그물(꼬리)에 줄줄이 달린다.
// 자기 기지(자기 쪽 모서리 원)에 들어가면 달린 쓰레기를 모두 챙긴다. 남의 그물에 부딪히면 그 그물이 끊겨 쓰레기가 흩어진다.
// 챙긴 개수 순.

export const DURATION = 25;
export const SHIP_SPEED = 70;
export const BASE_R = 18;
const MAX_TAIL = 6;
const JUNK = 12;
const PICK_R = 7;
const CUT_R = 5;
const LINK = 7;

export interface Junk {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Ship {
  seat: Seat;
  x: number;
  y: number;
  base: { x: number; y: number };
  tail: Array<{ x: number; y: number }>;
  banked: number;
  cutAt: number;
}

export class SpaceSweep implements MiniGame {
  readonly code = 'G58';
  t = 0;
  ships: Ship[] = [];
  junk: Junk[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.ships = ctx.players.map((p) => {
      const base = anchorOf(p, ctx.humanCount, 140, 72);
      const start = anchorOf(p, ctx.humanCount, 100, 50);
      return { seat: p.seat, x: start.x, y: start.y, base, tail: [], banked: 0, cutAt: -9 };
    });
    for (let i = 0; i < JUNK; i++) this.junk.push(this.spawnJunk());
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
    return Object.fromEntries(this.ships.map((s) => [s.seat, s.banked])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.ships.map((s) => ({ seat: s.seat, score: s.banked * 10 + s.tail.length })));
  }

  private spawnJunk(x?: number, y?: number): Junk {
    const rng = this.ctx.rng;
    const a = rng.next() * Math.PI * 2;
    const v = 6 + rng.next() * 10;
    return { x: x ?? 100 + rng.next() * 120, y: y ?? 50 + rng.next() * 80, vx: Math.cos(a) * v, vy: Math.sin(a) * v };
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    for (const s of this.ships) {
      const st = stickOf(this.ctx.controls.get(s.seat)!);
      s.x = Math.max(4, Math.min(316, s.x + st.x * SHIP_SPEED * dt));
      s.y = Math.max(4, Math.min(176, s.y + st.y * SHIP_SPEED * dt));
      // 꼬리는 앞 칸을 따라온다
      let lead = { x: s.x, y: s.y };
      for (const seg of s.tail) {
        const dx = lead.x - seg.x;
        const dy = lead.y - seg.y;
        const d = Math.hypot(dx, dy);
        if (d > LINK) {
          seg.x += (dx / d) * (d - LINK);
          seg.y += (dy / d) * (d - LINK);
        }
        lead = seg;
      }
    }
    for (const j of this.junk) {
      j.x += j.vx * dt;
      j.y += j.vy * dt;
      if (j.x < 6 || j.x > 314) j.vx = -j.vx;
      if (j.y < 6 || j.y > 174) j.vy = -j.vy;
    }
    for (const s of this.ships) {
      // 쓰레기 줍기
      if (s.tail.length < MAX_TAIL) {
        const j = this.junk.find((k) => Math.hypot(k.x - s.x, k.y - s.y) <= PICK_R);
        if (j) {
          this.junk = this.junk.filter((k) => k !== j);
          s.tail.push({ x: j.x, y: j.y });
          this.ctx.sfx.tap();
        }
      }
      // 기지에 들어가면 챙기기
      if (s.tail.length > 0 && Math.hypot(s.x - s.base.x, s.y - s.base.y) <= BASE_R) {
        s.banked += s.tail.length;
        for (let i = 0; i < s.tail.length; i++) this.junk.push(this.spawnJunk());
        s.tail = [];
        this.ctx.sfx.coin();
      }
      // 남의 그물 끊기
      for (const o of this.ships) {
        if (o === s) continue;
        const k = o.tail.findIndex((seg) => Math.hypot(seg.x - s.x, seg.y - s.y) <= CUT_R);
        if (k < 0) continue;
        for (const seg of o.tail.slice(k)) this.junk.push(this.spawnJunk(seg.x, seg.y));
        o.tail = o.tail.slice(0, k);
        o.cutAt = this.t;
        this.ctx.sfx.hit();
        this.ctx.fx.shake(2, 0.1);
      }
    }
    if (this.t >= DURATION) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (let i = 0; i < 30; i++) r.rect((i * 97) % 320, (i * 53) % 180, 1, 1, PAL.bgMid);
    for (const s of this.ships) {
      const c = this.ctx.players.find((p) => p.seat === s.seat)!.color;
      r.disc(s.base.x, s.base.y, BASE_R, c.shadow);
      r.disc(s.base.x, s.base.y, BASE_R - 2, PAL.bgDark);
    }
    for (const j of this.junk) {
      r.rect(j.x - 2, j.y - 2, 5, 5, PAL.line);
      r.rect(j.x - 1, j.y - 1, 3, 3, PAL.text);
    }
    for (const s of this.ships) {
      const p = this.ctx.players.find((pl) => pl.seat === s.seat)!;
      let lead = { x: s.x, y: s.y };
      for (const seg of s.tail) {
        r.rect((lead.x + seg.x) / 2, (lead.y + seg.y) / 2, 1, 1, p.color.base);
        r.rect(seg.x - 2, seg.y - 2, 5, 5, p.color.shadow);
        r.rect(seg.x - 1, seg.y - 1, 3, 3, PAL.text);
        lead = seg;
      }
      r.disc(s.x, s.y, 5, PAL.line);
      r.disc(s.x, s.y, 4, this.t - s.cutAt < 0.2 ? PAL.red : p.color.base);
      r.rect(s.x - 1, s.y - 1, 2, 2, PAL.text);
      drawMarker(r, s.x, s.y - 7, p.color.base);
      drawScoreTag(r, p, s.base.x, s.base.y - 4, s.banked);
    }
    drawTimer(r, DURATION - this.t, 160, 1);
  }
}

/** 가까운 쓰레기를 주워 꼬리가 차거나 시간이 지나면 기지로. 가까운 남의 꼬리는 가끔 끊으러 간다. */
class SweepAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private readonly interval: number;
  private readonly greed: number;

  constructor(
    private readonly game: SpaceSweep,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.16, hard: 0.08 });
    this.greed = byDifficulty(player.difficulty, { easy: 2, normal: 3, hard: 4 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;
    const me = g.ships.find((s) => s.seat === this.player.seat)!;
    let tx = me.base.x;
    let ty = me.base.y;
    if (me.tail.length < this.greed) {
      const near = [...g.junk].sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
      if (near) {
        tx = near.x;
        ty = near.y;
      }
      // 아주 가까운 남의 꼬리는 끊는다
      for (const o of g.ships) {
        if (o === me || o.tail.length < 2) continue;
        const seg = o.tail[0];
        if (Math.hypot(seg.x - me.x, seg.y - me.y) < 30) {
          tx = seg.x;
          ty = seg.y;
        }
      }
    }
    const dx = tx - me.x;
    const dy = ty - me.y;
    const d = Math.hypot(dx, dy) || 1;
    this.hand.stick(dx / d, dy / d);
  }
}

export const G58 = defineGame({
  code: 'G58',
  controls: 'pointer',
  pointer: 'area',
  create: () => new SpaceSweep(),
  createAI: (game, player, controls) => new SweepAI(game, player, controls),
});
