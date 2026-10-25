import type { PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawMarker, drawScoreTag, sideAnchor } from './common';
import { itemSprite } from './G54';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G35 카드 짝맞추기(차례제): 뒤집힌 카드 12장(6쌍). 자기 차례에 두 장을 탭해 뒤집고, 짝이면 1점 + 한 번 더.
// 아니면 잠깐 보여 주고 다음 사람. 한 장에 4초 안에 안 고르면 아무거나 뒤집힌다. 맞춘 쌍 수 순.

export const COLS = 4;
export const ROWS = 3;
export const PAIRS = (COLS * ROWS) / 2;
export const FLIP_TIME = 4;
export const DURATION = 45;
const SHOW_TIME = 0.9;

export class MemoryPairs implements MiniGame {
  readonly code = 'G35';
  t = 0;
  cards: number[] = [];
  matched: boolean[] = [];
  /** 이번 차례에 뒤집은 카드 */
  flipped: number[] = [];
  order: Seat[] = [];
  turn = 0;
  phase: 'pick' | 'show' = 'pick';
  phaseT = 0;
  readonly pairs = new Map<Seat, number>();
  /** 지금까지 한 번이라도 뒤집혀 보인 카드(AI 기억용) */
  readonly seen = new Set<number>();
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.order = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    for (const s of this.order) this.pairs.set(s, 0);
    const deck: number[] = [];
    for (let k = 0; k < PAIRS; k++) deck.push(k, k);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng.next() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.cards = deck;
    this.matched = new Array<boolean>(deck.length).fill(false);
    this.turn = Math.floor(ctx.rng.next() * this.order.length);
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
    return Object.fromEntries(this.pairs) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.pairs].map(([seat, score]) => ({ seat, score })));
  }

  cardRect(i: number): Rect {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return { x: 104 + col * 29, y: 48 + row * 29, w: 26, h: 26 };
  }

  /** 아직 뒤집을 수 있는 카드 */
  closed(): number[] {
    return this.cards.map((_, i) => i).filter((i) => !this.matched[i] && !this.flipped.includes(i));
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'show') {
      if (this.phaseT >= SHOW_TIME) {
        this.flipped = [];
        this.turn = (this.turn + 1) % this.order.length;
        this.phase = 'pick';
        this.phaseT = 0;
      }
      return;
    }
    let pick = -1;
    for (const tap of this.ctx.controls.get(this.current)!.tapsThisTick) {
      const i = this.closed().find((k) => inRect(this.cardRect(k), tap.x, tap.y));
      if (i !== undefined) {
        pick = i;
        break;
      }
    }
    if (pick < 0 && this.phaseT >= FLIP_TIME) {
      const c = this.closed();
      pick = c[Math.floor(this.ctx.rng.next() * c.length)];
    }
    if (pick >= 0) this.flip(pick);
    if (this.t >= DURATION) this.done = true;
  }

  private flip(i: number): void {
    this.flipped.push(i);
    this.seen.add(i);
    this.phaseT = 0;
    this.ctx.sfx.turn();
    if (this.flipped.length < 2) return;
    const [a, b] = this.flipped;
    if (this.cards[a] === this.cards[b]) {
      this.matched[a] = true;
      this.matched[b] = true;
      this.flipped = [];
      this.pairs.set(this.current, (this.pairs.get(this.current) ?? 0) + 1);
      this.ctx.sfx.coin();
      if (this.matched.every(Boolean)) this.done = true;
    } else {
      this.phase = 'show';
      this.ctx.sfx.buzz();
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const turnColor = SEAT_COLORS[this.current].base;
    this.cards.forEach((kind, i) => {
      const c = this.cardRect(i);
      if (this.matched[i]) {
        r.rect(c.x + 3, c.y + 3, c.w - 6, c.h - 6, PAL.bgMid);
        return;
      }
      const up = this.flipped.includes(i);
      r.rect(c.x - 1, c.y - 1, c.w + 2, c.h + 2, PAL.line);
      r.rect(c.x, c.y, c.w, c.h, up ? PAL.text : turnColor);
      if (up) {
        const icon = itemSprite(kind);
        r.ctx.drawImage(icon, c.x + (c.w - icon.width) / 2, c.y + (c.h - icon.height) / 2);
      } else {
        r.rect(c.x + 4, c.y + 4, c.w - 8, c.h - 8, SEAT_COLORS[this.current].shadow);
      }
    });
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      r.disc(a.x, a.y, 9, PAL.line);
      r.disc(a.x, a.y, 8, p.color.base);
      if (p.seat === this.current && this.phase === 'pick') {
        drawMarker(r, a.x, a.y - 12, p.color.base);
        r.text(String(Math.ceil(FLIP_TIME - this.phaseT)), a.x, a.y - 4, PAL.text, 'center');
      }
      drawScoreTag(r, p, a.x, a.y + 14, this.pairs.get(p.seat) ?? 0);
    }
  }
}

function inRect(rc: Rect, x: number, y: number): boolean {
  return x >= rc.x && x < rc.x + rc.w && y >= rc.y && y < rc.y + rc.h;
}

/** 본 카드를 난이도만큼 기억해 짝을 찾는다. 모르면 아직 안 본 카드부터 */
class PairsAI implements AiController {
  private readonly hand: AiHand;
  private planned = '';
  private readonly memory: number;
  private readonly remembered = new Map<number, number>();

  constructor(
    private readonly game: MemoryPairs,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.memory = byDifficulty(player.difficulty, { easy: 0.35, normal: 0.6, hard: 0.85 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    // 남의 차례에도 보이는 카드를 기억한다
    for (const i of g.flipped) if (!this.remembered.has(i) && g.rng.next() < this.memory) this.remembered.set(i, g.cards[i]);
    for (const i of [...this.remembered.keys()]) if (g.matched[i]) this.remembered.delete(i);
    if (g.finished || g.activeSeat() !== this.player.seat || this.hand.busy) return;
    const key = `${g.turn}|${g.flipped.join()}|${g.matched.filter(Boolean).length}`;
    if (key === this.planned) return;
    this.planned = key;
    const closed = g.closed();
    let pick: number | undefined;
    if (g.flipped.length === 1) {
      const kind = g.cards[g.flipped[0]];
      pick = closed.find((i) => this.remembered.get(i) === kind);
    } else {
      // 기억 속에 짝이 있으면 그중 하나부터
      const byKind = new Map<number, number[]>();
      for (const [i, k] of this.remembered) if (closed.includes(i)) byKind.set(k, [...(byKind.get(k) ?? []), i]);
      pick = [...byKind.values()].find((v) => v.length >= 2)?.[0];
    }
    if (pick === undefined) {
      const unseen = closed.filter((i) => !this.remembered.has(i));
      const pool = unseen.length > 0 ? unseen : closed;
      pick = pool[Math.floor(g.rng.next() * pool.length)];
    }
    const c = g.cardRect(pick);
    this.hand.tapAt(c.x + 13, c.y + 13, 0.5 + g.rng.next() * 0.6);
  }
}

export const G35 = defineGame({
  code: 'G35',
  controls: 'pointer',
  pointer: 'turn',
  create: () => new MemoryPairs(),
  createAI: (game, player, controls) => new PairsAI(game, player, controls),
});
