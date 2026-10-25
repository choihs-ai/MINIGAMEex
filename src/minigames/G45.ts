import type { PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawScoreTag, drawTimer, TIMER_X, TIMER_Y } from './common';
import { regionOf } from './G54';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G45 어둠 속 손전등: 자기 구역이 깜깜하다. 손가락을 대고 움직이면 그 둘레만 밝게 보인다.
// 숨은 보석에 손가락을 올리면 +1(다른 곳에 새로 숨는다). 폭탄을 건드리면 -1이고 잠깐 손전등이 꺼진다. 25초.

export const DURATION = 25;
export const LIGHT_R = 16;
export const TOUCH_R = 6;
const BOMBS = 2;
const BOMB_LOCK = 0.8;

export interface Thing {
  x: number;
  y: number;
  bomb: boolean;
}

export interface Searcher {
  seat: Seat;
  region: Rect;
  things: Thing[];
  score: number;
  lockedUntil: number;
  light: { x: number; y: number } | null;
  foundAt: number;
}

export class DarkSearch implements MiniGame {
  readonly code = 'G45';
  t = 0;
  searchers: Searcher[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.searchers = ctx.players.map((p) => {
      const s: Searcher = { seat: p.seat, region: regionOf(p, ctx.humanCount), things: [], score: 0, lockedUntil: -1, light: null, foundAt: -9 };
      s.things.push(this.spot(s, false));
      for (let i = 0; i < BOMBS; i++) s.things.push(this.spot(s, true));
      return s;
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
    return Object.fromEntries(this.searchers.map((s) => [s.seat, s.score])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.searchers.map((s) => ({ seat: s.seat, score: s.score })));
  }

  /** 구역 안, 다른 것과 겹치지 않는 자리 */
  private spot(s: Searcher, bomb: boolean): Thing {
    const r = s.region;
    const rng = this.ctx.rng;
    for (let k = 0; k < 50; k++) {
      const x = r.x + 12 + rng.next() * (r.w - 24);
      const y = r.y + 12 + rng.next() * (r.h - 24);
      if (s.things.every((t) => Math.hypot(t.x - x, t.y - y) > 20)) return { x, y, bomb };
    }
    return { x: r.x + r.w / 2, y: r.y + r.h / 2, bomb };
  }

  locked(s: Searcher): boolean {
    return s.lockedUntil > this.t;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    for (const s of this.searchers) {
      const d = this.ctx.controls.get(s.seat)!.drag;
      s.light = d && !this.locked(s) ? { x: d.x, y: d.y } : null;
      if (!s.light) continue;
      const hit = s.things.find((th) => Math.hypot(th.x - s.light!.x, th.y - s.light!.y) <= TOUCH_R);
      if (!hit) continue;
      s.things = s.things.filter((th) => th !== hit);
      if (hit.bomb) {
        s.score--;
        s.lockedUntil = this.t + BOMB_LOCK;
        this.ctx.sfx.buzz();
        this.ctx.fx.burst(hit.x, hit.y, PAL.red, 8);
      } else {
        s.score++;
        s.foundAt = this.t;
        this.ctx.sfx.coin();
        this.ctx.fx.burst(hit.x, hit.y, PAL.yellow, 8);
      }
      s.things.push(this.spot(s, hit.bomb));
    }
    if (this.t >= DURATION) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.line);
    for (const s of this.searchers) {
      const p = this.ctx.players.find((pl) => pl.seat === s.seat)!;
      r.frame(s.region.x + 1, s.region.y + 1, s.region.w - 2, s.region.h - 2, this.locked(s) ? PAL.red : p.color.shadow);
      if (s.light) {
        r.disc(s.light.x, s.light.y, LIGHT_R, PAL.bgMid);
        for (const th of s.things) {
          if (Math.hypot(th.x - s.light.x, th.y - s.light.y) > LIGHT_R + 2) continue;
          if (th.bomb) {
            r.disc(th.x, th.y, 4, PAL.line);
            r.disc(th.x, th.y, 3, PAL.red);
          } else {
            r.rect(th.x - 1, th.y - 4, 3, 9, PAL.yellow);
            r.rect(th.x - 4, th.y - 1, 9, 3, PAL.yellow);
            r.rect(th.x, th.y, 1, 1, PAL.text);
          }
        }
        r.disc(s.light.x, s.light.y, 1, p.color.base);
      }
      const cx = s.region.x + s.region.w / 2;
      const top = s.region.y === 0;
      drawScoreTag(r, p, cx, top ? s.region.y + 8 : s.region.y + s.region.h - 14, s.score);
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }
}

/** 구역을 지그재그로 훑다가 빛에 보석이 걸리면 그리로 간다. 폭탄은 난이도만큼 피한다. */
class SearchAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private sweep = 0;
  private readonly speed: number;
  private readonly careless: number;

  constructor(
    private readonly game: DarkSearch,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.speed = byDifficulty(player.difficulty, { easy: 55, normal: 75, hard: 95 });
    this.careless = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.15, hard: 0.05 });
    this.sweep = game.rng.next() * 100;
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    const me = g.searchers.find((s) => s.seat === this.player.seat)!;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 0.05;
    const r = me.region;
    const light = me.light;
    const seen = light ? me.things.filter((th) => Math.hypot(th.x - light.x, th.y - light.y) <= LIGHT_R) : [];
    const gem = seen.find((th) => !th.bomb);
    let tx: number;
    let ty: number;
    if (gem && light) {
      tx = gem.x;
      ty = gem.y;
    } else {
      // 지그재그로 훑기
      this.sweep += this.speed * 0.05;
      const rows = 3;
      const lane = Math.floor(this.sweep / (r.w - 20)) % (rows * 2);
      const along = this.sweep % (r.w - 20);
      const row = lane < rows ? lane : rows * 2 - 1 - lane;
      const dirRight = lane % 2 === 0;
      tx = r.x + 10 + (dirRight ? along : r.w - 20 - along);
      ty = r.y + 14 + (row * (r.h - 28)) / (rows - 1);
    }
    // 가는 길에 보이는 폭탄은 비켜 간다(가끔 실수)
    const bomb = seen.find((th) => th.bomb && Math.hypot(th.x - tx, th.y - ty) < TOUCH_R + 6);
    if (bomb && this.game.rng.next() > this.careless) ty += ty > bomb.y ? 10 : -10;
    const cur = light ?? { x: tx, y: ty };
    const dx = tx - cur.x;
    const dy = ty - cur.y;
    const d = Math.hypot(dx, dy);
    const step = Math.min(d, this.speed * 0.05);
    this.hand.pointTo(cur.x + (d > 0 ? (dx / d) * step : 0), cur.y + (d > 0 ? (dy / d) * step : 0));
  }
}

export const G45 = defineGame({
  code: 'G45',
  controls: 'pointer',
  pointer: 'area',
  create: () => new DarkSearch(),
  createAI: (game, player, controls) => new SearchAI(game, player, controls),
});
