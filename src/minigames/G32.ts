import type { PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import { Grid } from '../render/grid';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawMarker, drawScoreTag, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G32 폭탄 고르기(G43 폭탄 해체반 흡수, 차례제): 상자 8개 중 하나에 폭탄. 차례대로 하나씩 연다(화면 직접 탭).
// 안전하면 코인(뒤로 갈수록 많이), 폭탄이면 탈락하고 새 상자로 다시. 4초 안에 안 고르면 아무거나 열린다.
// 끝까지 남은 사람이 위(시간이 다 되면 남은 사람끼리 코인 순), 탈락한 사람은 늦게 떨어진 순.

export const BOXES = 8;
export const PICK_TIME = 4;
export const DURATION = 30;
const SHOW_TIME = 0.9;

export class BombBoxes implements MiniGame {
  readonly code = 'G32';
  t = 0;
  order: Seat[] = [];
  turn = 0;
  opened: boolean[] = [];
  bomb = 0;
  phase: 'pick' | 'show' = 'pick';
  phaseT = 0;
  lastPick = -1;
  readonly coins = new Map<Seat, number>();
  readonly outAt = new Map<Seat, number>();
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.order = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    for (const s of this.order) this.coins.set(s, 0);
    this.turn = Math.floor(ctx.rng.next() * this.order.length);
    this.resetBoxes();
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

  get current(): Seat {
    return this.order[this.turn];
  }

  activeSeat(): Seat | null {
    return this.phase === 'pick' && !this.done ? this.current : null;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.coins) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    const alive = this.order.filter((s) => !this.outAt.has(s)).sort((a, b) => this.coins.get(b)! - this.coins.get(a)!);
    const groups: Seat[][] = [];
    let last: number | null = null;
    for (const s of alive) {
      if (this.coins.get(s) === last) groups[groups.length - 1].push(s);
      else groups.push([s]);
      last = this.coins.get(s)!;
    }
    const out = [...this.outAt].sort((a, b) => b[1] - a[1]);
    let lastT: number | null = null;
    for (const [s, at] of out) {
      if (at === lastT) groups[groups.length - 1].push(s);
      else groups.push([s]);
      lastT = at;
    }
    return groups;
  }

  /** 상자 i의 화면 위치(가운데 두 줄) */
  boxRect(i: number): Rect {
    const col = i % 4;
    const row = Math.floor(i / 4);
    return { x: 96 + col * 34, y: 58 + row * 34, w: 28, h: 28 };
  }

  /** 열면 받는 코인: 많이 열렸을수록 커진다 */
  reward(): number {
    return 1 + this.opened.filter(Boolean).length;
  }

  private resetBoxes(): void {
    this.opened = new Array<boolean>(BOXES).fill(false);
    this.bomb = Math.floor(this.ctx.rng.next() * BOXES);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'show') {
      if (this.phaseT >= SHOW_TIME) this.nextTurn();
      return;
    }
    let pick = -1;
    for (const tap of this.ctx.controls.get(this.current)!.tapsThisTick) {
      const i = this.opened.findIndex((o, k) => !o && inRect(this.boxRect(k), tap.x, tap.y));
      if (i >= 0) {
        pick = i;
        break;
      }
    }
    if (pick < 0 && this.phaseT >= PICK_TIME) {
      const closed = this.opened.map((o, k) => (o ? -1 : k)).filter((k) => k >= 0);
      pick = closed[Math.floor(this.ctx.rng.next() * closed.length)];
    }
    if (pick >= 0) this.open(pick);
    if (this.t >= DURATION) this.done = true;
  }

  private open(i: number): void {
    this.opened[i] = true;
    this.lastPick = i;
    this.phase = 'show';
    this.phaseT = 0;
    if (i === this.bomb) {
      this.outAt.set(this.current, this.t);
      this.ctx.sfx.hit();
      this.ctx.sfx.lose();
      this.ctx.fx.shake(5, 0.3);
      const r = this.boxRect(i);
      this.ctx.fx.burst(r.x + 14, r.y + 14, PAL.yellow, 16);
    } else {
      this.coins.set(this.current, (this.coins.get(this.current) ?? 0) + this.reward() - 1);
      this.ctx.sfx.coin();
    }
  }

  private nextTurn(): void {
    const alive = this.order.filter((s) => !this.outAt.has(s));
    if (alive.length <= 1) {
      this.done = true;
      return;
    }
    if (this.opened[this.bomb]) this.resetBoxes();
    for (let k = 1; k <= this.order.length; k++) {
      const next = (this.turn + k) % this.order.length;
      if (!this.outAt.has(this.order[next])) {
        this.turn = next;
        break;
      }
    }
    this.phase = 'pick';
    this.phaseT = 0;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (let i = 0; i < BOXES; i++) {
      const b = this.boxRect(i);
      const open = this.opened[i];
      if (!open) r.ctx.drawImage(boxSprite(), b.x, b.y);
      else if (i === this.bomb) r.ctx.drawImage(boomSprite(), b.x, b.y);
      else {
        r.rect(b.x + 2, b.y + 8, b.w - 4, b.h - 10, PAL.bgMid);
        if (i === this.lastPick && this.phase === 'show') r.text(`+${this.reward() - 1}`, b.x + 14, b.y + 10, PAL.yellow, 'center');
      }
    }
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      const out = this.outAt.has(p.seat);
      const mine = p.seat === this.current && this.phase === 'pick';
      r.disc(a.x, a.y, 9, PAL.line);
      r.disc(a.x, a.y, 8, out ? PAL.bgMid : p.color.base);
      if (mine) {
        drawMarker(r, a.x, a.y - 12, p.color.base);
        const left = Math.ceil(PICK_TIME - this.phaseT);
        r.text(String(left), a.x, a.y - 4, PAL.text, 'center');
      }
      drawScoreTag(r, p, a.x, a.y + 14, this.coins.get(p.seat) ?? 0);
    }
    // 지금 차례인 사람 색 테두리
    if (this.phase === 'pick') r.frame(90, 52, 140, 74, SEAT_COLORS[this.current].base);
  }
}

function inRect(rc: Rect, x: number, y: number): boolean {
  return x >= rc.x && x < rc.x + rc.w && y >= rc.y && y < rc.y + rc.h;
}

let box: HTMLCanvasElement | null = null;
let boom: HTMLCanvasElement | null = null;

function boxSprite(): HTMLCanvasElement {
  if (!box) {
    const g = new Grid(28, 28);
    g.rect(2, 8, 24, 18, PAL.yellowShadow);
    g.rect(2, 4, 24, 6, PAL.yellow);
    g.rect(12, 4, 4, 22, PAL.redShadow);
    g.outline(PAL.line);
    box = g.toCanvas();
  }
  return box;
}

function boomSprite(): HTMLCanvasElement {
  if (!boom) {
    const g = new Grid(28, 28);
    g.ellipse(14, 15, 11, 11, PAL.red, PAL.redShadow);
    g.ellipse(14, 15, 6, 6, PAL.yellow);
    g.outline(PAL.line);
    boom = g.toCanvas();
  }
  return boom;
}

/** 생각하는 척 잠깐 뒤에 남은 상자 하나를 고른다(폭탄 위치는 모른다) */
class BombBoxesAI implements AiController {
  private readonly hand: AiHand;
  private planned = '';
  private readonly think0: number;

  constructor(
    private readonly game: BombBoxes,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.think0 = byDifficulty(player.difficulty, { easy: 1.6, normal: 1.1, hard: 0.7 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.activeSeat() !== this.player.seat) return;
    if (this.hand.busy || this.planned === g.opened.join() + g.turn) return;
    this.planned = g.opened.join() + g.turn;
    const closed = g.opened.map((o, k) => (o ? -1 : k)).filter((k) => k >= 0);
    const pick = closed[Math.floor(g.rng.next() * closed.length)];
    const b = g.boxRect(pick);
    this.hand.tapAt(b.x + 14, b.y + 14, this.think0 * (0.6 + g.rng.next() * 0.8));
  }
}

export const G32 = defineGame({
  code: 'G32',
  controls: 'pointer',
  pointer: 'turn',
  create: () => new BombBoxes(),
  createAI: (game, player, controls) => new BombBoxesAI(game, player, controls),
});
