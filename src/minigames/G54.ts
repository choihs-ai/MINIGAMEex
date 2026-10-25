import type { PlayerControls } from '../input/controls';
import { cornerRect, type Rect, type Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawScoreTag, drawTimer, facing, TIMER_X, TIMER_Y } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G54 편의점 알바: 가운데 손님이 원하는 물건을 자기 진열대에서 가장 먼저 찾아 탭하면 +1.
// 진열대는 사람마다 자기 구역에 있고, 손님이 바뀔 때마다 물건 자리가 섞인다. 엉뚱한 물건을 누르면 잠깐 못 누른다.

export const DURATION = 25;
export const ITEM_KINDS = 8;
export const SHELF_COLS = 3;
export const SHELF_ROWS = 2;
const CELL = 22;
const GAP = 3;
const SHELF_W = SHELF_COLS * CELL + (SHELF_COLS - 1) * GAP;
const SHELF_H = SHELF_ROWS * CELL + (SHELF_ROWS - 1) * GAP;
export const WRONG_LOCK = 0.6;
const NEXT_GAP = 0.5;

/**
 * 이 플레이어 진열대가 놓이는 구역. 2인 이상은 자기 터치 구역,
 * 1인은 사분면을 나눠 쓴다(사람은 손에 가까운 왼쪽 아래, 3P 자리 CPU는 왼쪽 위).
 */
export function regionOf(p: PlayerInfo, humanCount: number): Rect {
  if (humanCount >= 2 && p.zone) return p.zone;
  const corner: Seat = p.seat === 0 ? 2 : p.seat === 2 ? 0 : p.seat;
  return cornerRect(corner);
}

export interface Shelf {
  seat: Seat;
  items: number[];
  lockedUntil: number;
  region: Rect;
  flipped: boolean;
}

export class ConvenienceStore implements MiniGame {
  readonly code = 'G54';
  t = 0;
  shelves: Shelf[] = [];
  /** 손님이 원하는 물건(손님이 없으면 null) */
  wanted: number | null = null;
  customer = 0;
  readonly scores = new Map<Seat, number>();
  lastWinner: Seat[] = [];
  private gapLeft = 0.4;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.shelves = ctx.players.map((p) => ({
      seat: p.seat,
      items: [],
      lockedUntil: -1,
      region: regionOf(p, ctx.humanCount),
      flipped: ctx.humanCount >= 2 && p.flipped,
    }));
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

  locked(seat: Seat): boolean {
    return (this.shelves.find((s) => s.seat === seat)?.lockedUntil ?? -1) > this.t;
  }

  /** 진열대 칸 i의 화면 위치. 위쪽 사람은 자기 쪽에서 보이게 구역 안에서 180도 돌린 자리 */
  cellRect(shelf: Shelf, i: number): Rect {
    const { region } = shelf;
    const col = i % SHELF_COLS;
    const row = Math.floor(i / SHELF_COLS);
    const lx = Math.round((region.w - SHELF_W) / 2) + col * (CELL + GAP);
    const ly = Math.round((region.h - SHELF_H) / 2) + 4 + row * (CELL + GAP);
    if (!shelf.flipped) return { x: region.x + lx, y: region.y + ly, w: CELL, h: CELL };
    return { x: region.x + region.w - lx - CELL, y: region.y + region.h - ly - CELL, w: CELL, h: CELL };
  }

  private newCustomer(): void {
    const rng = this.ctx.rng;
    let wanted = Math.floor(rng.next() * ITEM_KINDS);
    if (wanted === this.wanted) wanted = (wanted + 1) % ITEM_KINDS;
    this.wanted = wanted;
    this.customer++;
    for (const s of this.shelves) {
      // 원하는 물건 + 다른 물건 다섯 개를 섞어 놓는다
      const others = [...Array(ITEM_KINDS).keys()].filter((k) => k !== wanted);
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
      }
      const items = [wanted, ...others.slice(0, SHELF_COLS * SHELF_ROWS - 1)];
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      s.items = items;
    }
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    if (this.wanted === null) {
      this.gapLeft -= dt;
      if (this.gapLeft <= 0) this.newCustomer();
    } else {
      const winners: Seat[] = [];
      for (const s of this.shelves) {
        if (this.locked(s.seat)) continue;
        for (const tap of this.ctx.controls.get(s.seat)!.tapsThisTick) {
          const i = s.items.findIndex((_, k) => inRect(this.cellRect(s, k), tap.x, tap.y));
          if (i < 0) continue;
          if (s.items[i] === this.wanted) winners.push(s.seat);
          else {
            s.lockedUntil = this.t + WRONG_LOCK;
            this.ctx.sfx.buzz();
          }
          break;
        }
      }
      if (winners.length > 0) {
        for (const w of winners) this.scores.set(w, (this.scores.get(w) ?? 0) + 1);
        this.lastWinner = winners;
        this.wanted = null;
        this.gapLeft = NEXT_GAP;
        this.ctx.sfx.coin();
        for (const w of winners) {
          const s = this.shelves.find((sh) => sh.seat === w)!;
          const c = this.ctx.players.find((p) => p.seat === w)!.color.base;
          this.ctx.fx.burst(s.region.x + s.region.w / 2, s.region.y + s.region.h / 2, c, 8);
        }
      }
    }
    if (this.t >= DURATION) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (const s of this.shelves) this.drawShelf(r, s);
    this.drawCustomer(r);
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }

  private drawShelf(r: Renderer, s: Shelf): void {
    const p = this.ctx.players.find((pl) => pl.seat === s.seat)!;
    const first = this.cellRect(s, 0);
    const last = this.cellRect(s, SHELF_COLS * SHELF_ROWS - 1);
    const x0 = Math.min(first.x, last.x) - 3;
    const y0 = Math.min(first.y, last.y) - 3;
    const w = SHELF_W + 6;
    const h = SHELF_H + 6;
    const locked = this.locked(s.seat);
    r.rect(x0, y0, w, h, PAL.line);
    r.frame(x0, y0, w, h, locked ? PAL.bgMid : p.color.base);
    s.items.forEach((item, i) => {
      const c = this.cellRect(s, i);
      r.rect(c.x, c.y, c.w, c.h, PAL.bgMid);
      r.rect(c.x, c.y + (s.flipped ? 0 : c.h - 2), c.w, 2, PAL.line);
      if (locked) return;
      const icon = itemSprite(item);
      const ix = c.x + (c.w - icon.width) / 2;
      const iy = c.y + (c.h - icon.height) / 2;
      facing(r, s, c.x + c.w / 2, c.y + c.h / 2, () => r.ctx.drawImage(icon, Math.round(ix), Math.round(iy)));
    });
    // 진열대 아래(그 사람 기준) 점수
    const cx = x0 + w / 2;
    const tagY = s.flipped ? y0 - 12 : y0 + h + 6;
    drawScoreTag(r, p, cx, tagY, this.scores.get(s.seat) ?? 0);
    if (locked) facing(r, s, cx, y0 + h / 2, () => r.text('땡!', cx, y0 + h / 2 - 4, PAL.red, 'center'));
  }

  private drawCustomer(r: Renderer): void {
    const cx = 160;
    const cy = 90;
    r.rect(cx - 19, cy - 15, 38, 30, PAL.line);
    r.frame(cx - 19, cy - 15, 38, 30, PAL.text);
    if (this.wanted === null) {
      r.text('감사!', cx, cy - 4, PAL.yellow, 'center');
      return;
    }
    const icon = itemSprite(this.wanted);
    r.ctx.drawImage(icon, cx - icon.width, cy - icon.height, icon.width * 2, icon.height * 2);
  }
}

function inRect(rc: Rect, x: number, y: number): boolean {
  return x >= rc.x && x < rc.x + rc.w && y >= rc.y && y < rc.y + rc.h;
}

const itemCache = new Map<number, HTMLCanvasElement>();

/** 편의점 물건 14×14: 우유, 빵, 사과, 캔, 삼각김밥, 아이스크림, 컵라면, 바나나 */
export function itemSprite(kind: number): HTMLCanvasElement {
  const hit = itemCache.get(kind);
  if (hit) return hit;
  const g = new Grid(14, 14);
  switch (kind) {
    case 0: // 우유팩
      g.rect(3, 4, 8, 9, PAL.text);
      g.rect(4, 1, 6, 3, PAL.text);
      g.rect(3, 7, 8, 3, PAL.blue);
      g.rect(9, 4, 2, 9, PAL.bgMid);
      break;
    case 1: // 식빵
      g.ellipse(7, 5, 6, 4, PAL.yellowShadow);
      g.rect(1, 5, 12, 8, PAL.yellowShadow);
      g.rect(3, 6, 8, 6, PAL.yellow);
      break;
    case 2: // 사과
      g.ellipse(7, 8, 6, 5.5, PAL.red, PAL.redShadow);
      g.rect(7, 1, 1, 3, PAL.bgMid);
      g.rect(8, 1, 3, 2, PAL.green);
      g.rect(4, 6, 2, 2, PAL.text);
      break;
    case 3: // 캔음료
      g.rect(3, 2, 8, 11, PAL.green);
      g.rect(9, 2, 2, 11, PAL.greenShadow);
      g.rect(3, 1, 8, 1, PAL.text);
      g.rect(3, 6, 8, 2, PAL.text);
      break;
    case 4: // 삼각김밥(아래에 김)
      for (let y = 1; y < 13; y++) {
        const half = Math.floor(y / 2) + 1;
        g.rect(7 - half, y, half * 2, 1, PAL.text);
      }
      g.rect(5, 9, 4, 4, PAL.greenShadow);
      break;
    case 5: // 아이스크림콘
      g.ellipse(7, 4.5, 4.5, 4, PAL.blue, PAL.blueShadow);
      for (let y = 7; y < 14; y++) {
        const half = Math.max(0, Math.round((13 - y) / 2));
        g.rect(7 - half, y, half * 2 + 1, 1, PAL.yellowShadow);
      }
      break;
    case 6: // 컵라면
      g.rect(2, 3, 10, 2, PAL.text);
      for (let y = 5; y < 13; y++) {
        const inset = Math.floor((y - 5) / 3);
        g.rect(3 + inset, y, 8 - inset * 2, 1, PAL.red);
      }
      g.rect(4, 7, 6, 2, PAL.yellow);
      break;
    default: // 바나나(초승달 모양, 끝은 갈색)
      g.ellipseWith(7, 4, 6.5, 8.5, (nx, ny) => {
        if (ny < 0) return null;
        const inner = (nx * 1.15) ** 2 + ((ny + 0.28) * 1.3) ** 2 < 1;
        if (inner) return null;
        return ny > 0.75 ? PAL.yellowShadow : PAL.yellow;
      });
      g.rect(0, 3, 2, 2, PAL.bgMid);
      g.rect(12, 3, 2, 2, PAL.bgMid);
      break;
  }
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  itemCache.set(kind, canvas);
  return canvas;
}

/** 손님이 바뀌면 찾는 시간 뒤에 정답 칸(가끔 다른 칸)을 탭한다 */
class ConvenienceStoreAI implements AiController {
  private readonly hand: AiHand;
  private customer = 0;
  private readonly search: readonly [number, number];
  private readonly wrong: number;

  constructor(
    private readonly game: ConvenienceStore,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.search = byDifficulty(player.difficulty, { easy: [1.2, 1.9], normal: [0.85, 1.35], hard: [0.6, 0.95] });
    this.wrong = byDifficulty(player.difficulty, { easy: 0.16, normal: 0.08, hard: 0.03 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    if (g.wanted === null) {
      this.hand.reset();
      return;
    }
    if (g.customer === this.customer) return;
    this.customer = g.customer;
    const shelf = g.shelves.find((s) => s.seat === this.player.seat)!;
    const rng = g.rng;
    const i = shelf.items.indexOf(g.wanted);
    let delay = this.search[0] + rng.next() * (this.search[1] - this.search[0]);
    if (rng.next() < this.wrong) {
      // 헷갈려서 옆 칸을 누르고, 잠긴 시간이 끝난 뒤 다시 정답을 누른다
      const wrongCell = (i + 1 + Math.floor(rng.next() * (shelf.items.length - 1))) % shelf.items.length;
      const c = g.cellRect(shelf, wrongCell);
      this.hand.tapAt(c.x + c.w / 2, c.y + c.h / 2, delay * 0.7);
      delay = delay * 0.7 + WRONG_LOCK + 0.25;
    }
    const c = g.cellRect(shelf, i);
    this.hand.tapAt(c.x + c.w / 2, c.y + c.h / 2, delay);
  }
}

export const G54 = defineGame({
  code: 'G54',
  controls: 'pointer',
  pointer: 'area',
  create: () => new ConvenienceStore(),
  createAI: (game, player, controls) => new ConvenienceStoreAI(game, player, controls),
});
