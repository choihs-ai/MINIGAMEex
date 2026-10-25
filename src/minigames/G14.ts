import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawLaneDividers, drawMarker, drawTimer, makeLanes, TIMER_X, TIMER_Y, type Lane } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G14 블록 탑 쌓기: 흔들리는 블록을 눌러 떨어뜨려 자기 탑에 쌓는다. 무너지면 탈락.
// 순위: 살아남은 사람이 위, 그 안에서는 높이 순(무너진 사람끼리도 높이 순).

export const DURATION = 30;
export const BLOCK_W = 22;
export const BLOCK_H = 8;
/** 아랫블록과 이만큼(블록 폭 대비) 어긋나면 미끄러져 무너진다 */
export const TOPPLE = 0.5;
export const FALL_SPEED = 280;
/** 탑 꼭대기에서 매달린 블록 아랫면까지 */
const SWING_ABOVE = 34;
const RESPAWN = 0.25;
/** 이만큼 안 누르고 있으면 블록이 저절로 떨어진다(가만히 버티기 금지) */
export const AUTO_DROP = 2.5;
const GROUND_Y = 170;
const SCATTER_TIME = 0.8;

export type TowerState = 'swing' | 'fall' | 'wait' | 'down';

export interface Tower {
  seat: Seat;
  lane: Lane;
  /** 쌓인 블록들의 가운데 x(아래부터) */
  blocks: number[];
  state: TowerState;
  swingT: number;
  phase0: number;
  /** 매달리거나 떨어지는 블록의 가운데 x */
  x: number;
  /** 떨어지는 블록 아랫면의 높이(땅 기준) */
  y: number;
  waitT: number;
  outAt: number | null;
  /** 무너질 때 미끄러진 블록의 x(점수에는 안 들어간다) */
  lostX: number | null;
}

/** 위에 얹힌 블록들의 무게중심이 모든 층에서 아랫블록 위에 있어야 버틴다 */
export function isStable(blocks: readonly number[]): boolean {
  for (let i = 0; i < blocks.length - 1; i++) {
    const above = blocks.slice(i + 1);
    const com = above.reduce((a, b) => a + b, 0) / above.length;
    if (Math.abs(com - blocks[i]) > BLOCK_W / 2) return false;
  }
  return true;
}

export class BlockTower implements MiniGame {
  readonly code = 'G14';
  towers: Tower[] = [];
  t = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.towers = makeLanes(ctx.players).map((lane) => ({
      seat: lane.seat,
      lane,
      blocks: [],
      state: 'swing',
      swingT: 0,
      phase0: ctx.rng.next() * Math.PI * 2,
      x: lane.cx,
      y: 0,
      waitT: 0,
      outAt: null,
      lostX: null,
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

  canPress(seat: Seat): boolean {
    return !this.done && this.towers.find((t) => t.seat === seat)?.state === 'swing';
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.towers.map((t) => [t.seat, t.blocks.length])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    const key = (t: Tower) => (t.outAt === null ? 1000 : 0) + t.blocks.length;
    const sorted = [...this.towers].sort((a, b) => key(b) - key(a) || a.seat - b.seat);
    const groups: Seat[][] = [];
    for (const t of sorted) {
      const prev = groups[groups.length - 1];
      if (prev && key(this.towers.find((x) => x.seat === prev[0])!) === key(t)) prev.push(t.seat);
      else groups.push([t.seat]);
    }
    return groups;
  }

  amplitude(t: Tower): number {
    return t.lane.w / 2 - BLOCK_W / 2 + 4;
  }

  /** 높이가 높을수록 빨리 흔들린다 */
  omega(t: Tower): number {
    return Math.min(7.5, 3 + 0.28 * t.blocks.length);
  }

  swingX(t: Tower, swingT: number): number {
    return t.lane.cx + this.amplitude(t) * Math.sin(this.omega(t) * swingT + t.phase0);
  }

  top(t: Tower): number {
    return t.blocks.length * BLOCK_H;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const tw of this.towers) {
      const c = this.ctx.controls.get(tw.seat)!;
      if (tw.state === 'swing') {
        tw.swingT += dt;
        tw.x = this.swingX(tw, tw.swingT);
        if (c.justPressed() || tw.swingT >= AUTO_DROP) {
          tw.state = 'fall';
          tw.y = this.top(tw) + SWING_ABOVE;
          this.ctx.sfx.turn();
        }
      } else if (tw.state === 'fall') {
        tw.y -= FALL_SPEED * dt;
        if (tw.y <= this.top(tw)) this.land(tw);
      } else if (tw.state === 'wait') {
        tw.waitT -= dt;
        if (tw.waitT <= 0) {
          tw.state = 'swing';
          tw.swingT = 0;
          tw.phase0 = this.ctx.rng.next() * Math.PI * 2;
        }
      }
    }
    const alive = this.towers.filter((t) => t.outAt === null).length;
    if (this.t >= DURATION || alive === 0 || (this.towers.length > 1 && alive <= 1)) this.done = true;
  }

  private land(tw: Tower): void {
    // 첫 블록은 땅 위라 어디에 떨어뜨려도 선다
    if (tw.blocks.length > 0) {
      const d = tw.x - tw.blocks[tw.blocks.length - 1];
      if (Math.abs(d) >= TOPPLE * BLOCK_W || !isStable([...tw.blocks, tw.x])) {
        this.collapse(tw);
        return;
      }
    }
    tw.blocks.push(tw.x);
    tw.state = 'wait';
    tw.waitT = RESPAWN;
    this.ctx.sfx.tap();
  }

  private collapse(tw: Tower): void {
    tw.lostX = tw.x;
    tw.state = 'down';
    tw.outAt = this.t;
    this.ctx.sfx.lose();
    this.ctx.fx.shake(3, 0.15);
    const p = this.ctx.players.find((pl) => pl.seat === tw.seat);
    if (p) this.ctx.fx.burst(tw.lane.cx, GROUND_Y - 20, p.color.base, 10);
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    drawLaneDividers(r, this.towers.map((t) => t.lane));
    for (const tw of this.towers) this.drawTower(r, tw);
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }

  private drawTower(r: Renderer, tw: Tower): void {
    const p = this.ctx.players.find((pl) => pl.seat === tw.seat)!;
    const { base, shadow } = p.color;
    // 탑이 높아지면 블록 단위로 화면을 내린다
    const camera = Math.max(0, this.top(tw) + SWING_ABOVE + BLOCK_H - (GROUND_Y - 34));
    const sy = (worldY: number) => GROUND_Y - worldY + camera;
    r.rect(tw.lane.x + 2, sy(0), tw.lane.w - 3, 2, PAL.bgMid);

    const block = (cx: number, bottom: number) => {
      const x = Math.round(cx - BLOCK_W / 2);
      const y = Math.round(sy(bottom) - BLOCK_H);
      r.rect(x - 1, y - 1, BLOCK_W + 2, BLOCK_H + 2, PAL.line);
      r.rect(x, y, BLOCK_W, BLOCK_H, base);
      r.rect(x, y + BLOCK_H - 2, BLOCK_W, 2, shadow);
      r.rect(x + 2, y + 1, 3, 1, PAL.text);
    };

    if (tw.state === 'down') {
      // 무너짐: 블록이 양옆으로 흩어지며 떨어진다(프레임 단위)
      const since = this.t - (tw.outAt ?? this.t);
      const step = Math.min(SCATTER_TIME, Math.floor(since * 12) / 12);
      [...tw.blocks, tw.lostX ?? tw.x].forEach((bx, i) => {
        const dx = (i % 2 === 0 ? -1 : 1) * step * (20 + i * 4);
        const dy = step * step * 260;
        block(bx + dx, i * BLOCK_H - dy);
      });
      r.text(String(tw.blocks.length), tw.lane.cx, 4, shadow, 'center');
      return;
    }

    tw.blocks.forEach((bx, i) => block(bx, i * BLOCK_H));
    if (tw.state === 'swing' || tw.state === 'fall') {
      const bottom = tw.state === 'swing' ? this.top(tw) + SWING_ABOVE : tw.y;
      if (tw.state === 'swing') r.rect(Math.round(tw.x), 0, 1, Math.round(sy(bottom + BLOCK_H)), PAL.bgMid);
      block(tw.x, bottom);
      drawMarker(r, tw.x, sy(bottom + BLOCK_H) - 3, base);
    }
    r.text(String(tw.blocks.length), tw.lane.cx, 4, base, 'center');
  }
}

/** 매달린 블록이 아랫블록 바로 위를 지나는 순간을 계산해 누른다(난이도별 타이밍 오차). */
class TowerAI implements AiController {
  private readonly hand: AiHand;
  private planned = false;
  private readonly sigma: number;

  constructor(
    private readonly game: BlockTower,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.sigma = byDifficulty(player.difficulty, { easy: 0.09, normal: 0.045, hard: 0.02 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const tw = this.game.towers.find((t) => t.seat === this.player.seat)!;
    if (this.game.finished || tw.state !== 'swing') {
      this.planned = false;
      return;
    }
    if (this.planned) return;
    this.planned = true;
    const target = tw.blocks.length ? tw.blocks[tw.blocks.length - 1] : tw.lane.cx;
    const step = 1 / 120;
    let prev = this.game.swingX(tw, tw.swingT + 0.12) - target;
    let delay = 0.3;
    for (let tau = 0.12 + step; tau < 3; tau += step) {
      const cur = this.game.swingX(tw, tw.swingT + tau) - target;
      if (cur === 0 || Math.sign(cur) !== Math.sign(prev)) {
        delay = tau;
        break;
      }
      prev = cur;
    }
    this.hand.tap(0, Math.max(0, delay + jitter(this.game.rng, this.sigma)));
  }
}

export const G14 = defineGame({
  code: 'G14',
  controls: 'one',
  create: () => new BlockTower(),
  createAI: (game, player, controls) => new TowerAI(game, player, controls),
});
