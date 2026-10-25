import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawMarker, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G18 기억력 릴레이(차례제, 4색 버튼): 지금까지 나온 색 순서를 그대로 누른 뒤, 아무 색이나 하나를 덧붙인다.
// 다음 사람은 늘어난 순서를 따라 누르고 또 하나를 붙인다. 틀리거나 3초 안에 못 누르면 탈락. 마지막 생존자가 1위.
// 순서는 처음 한 번만 보여 준다(나머지는 남이 누르는 걸 보고 외워야 한다).

export const PRESS_TIME = 3;
export const DURATION = 50;
const FLASH = 0.25;
const PAUSE = 0.5;

export type RelayPhase = 'intro' | 'input' | 'pause';

export class MemoryRelay implements MiniGame {
  readonly code = 'G18';
  t = 0;
  seq: number[] = [];
  order: Seat[] = [];
  turn = 0;
  /** 이번 차례에 몇 개째를 누를 차례인지(seq.length면 덧붙이기) */
  pos = 0;
  phase: RelayPhase = 'intro';
  phaseT = 0;
  pressT = 0;
  readonly outAt = new Map<Seat, number>();
  /** 가운데에 불이 켜진 색과 시각 */
  lit: { color: number; at: number } | null = null;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.order = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    this.seq = [Math.floor(ctx.rng.next() * 4)];
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

  canPress(seat: Seat): boolean {
    return this.phase === 'input' && seat === this.current && !this.done;
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.order.map((seat) => ({ seat, outAt: this.outAt.get(seat) ?? null })));
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'intro') {
      // 첫 색을 한 번 보여 준다
      if (!this.lit && this.phaseT > 0.4) this.light(this.seq[0]);
      if (this.phaseT > 1.2) this.toInput();
      return;
    }
    if (this.phase === 'pause') {
      if (this.phaseT >= PAUSE) this.toInput();
      return;
    }
    this.pressT += dt;
    const c = this.ctx.controls.get(this.current)!;
    for (let b = 0; b < 4; b++) {
      if (!c.justPressed(b)) continue;
      this.press(b);
      break;
    }
    if (this.phase === 'input' && this.pressT >= PRESS_TIME) this.fail();
    if (this.t >= DURATION) this.done = true;
  }

  private light(color: number): void {
    this.lit = { color, at: this.t };
    this.ctx.sfx.drum(color);
  }

  private toInput(): void {
    this.phase = 'input';
    this.phaseT = 0;
    this.pos = 0;
    this.pressT = 0;
  }

  private press(b: number): void {
    this.light(b);
    this.pressT = 0;
    if (this.pos < this.seq.length) {
      if (b !== this.seq[this.pos]) {
        this.fail();
        return;
      }
      this.pos++;
      return;
    }
    // 덧붙이기 성공 → 다음 사람
    this.seq.push(b);
    this.ctx.sfx.coin();
    this.nextTurn();
  }

  private fail(): void {
    this.outAt.set(this.current, this.t);
    this.ctx.sfx.buzz();
    this.ctx.fx.shake(3, 0.2);
    if (this.order.filter((s) => !this.outAt.has(s)).length <= 1) {
      this.done = true;
      return;
    }
    this.nextTurn();
  }

  private nextTurn(): void {
    for (let k = 1; k <= this.order.length; k++) {
      const next = (this.turn + k) % this.order.length;
      if (!this.outAt.has(this.order[next])) {
        this.turn = next;
        break;
      }
    }
    this.phase = 'pause';
    this.phaseT = 0;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 가운데 네 칸 램프(빨·파·노·초)
    const on = this.lit && this.t - this.lit.at < FLASH ? this.lit.color : -1;
    for (let i = 0; i < 4; i++) {
      const x = 134 + (i % 2) * 27;
      const y = 64 + Math.floor(i / 2) * 27;
      const c = SEAT_COLORS[i];
      r.rect(x - 1, y - 1, 26, 26, PAL.line);
      r.rect(x, y, 24, 24, on === i ? c.base : c.shadow);
      if (on === i) r.rect(x + 3, y + 3, 6, 2, PAL.text);
    }
    // 이번 차례 진행(점): 따라 누를 개수 + 덧붙일 한 칸
    const n = this.seq.length + 1;
    const x0 = 160 - (n * 6) / 2;
    for (let i = 0; i < n; i++) {
      const done = this.phase === 'input' && i < this.pos;
      r.rect(x0 + i * 6, 122, 4, 4, i === n - 1 ? PAL.yellowShadow : done ? PAL.text : PAL.bgMid);
    }
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      const out = this.outAt.has(p.seat);
      r.disc(a.x, a.y, 9, PAL.line);
      r.disc(a.x, a.y, 8, out ? PAL.bgMid : p.color.base);
      if (p.seat === this.current && !out) {
        drawMarker(r, a.x, a.y - 12, p.color.base);
        if (this.phase === 'input') r.text(String(Math.ceil(PRESS_TIME - this.pressT)), a.x, a.y - 4, PAL.text, 'center');
      }
    }
  }
}

/** 자기 차례면 순서를 하나씩 누른다. 길어질수록 가끔 헷갈린다. 덧붙일 색은 아무거나. */
class RelayAI implements AiController {
  private readonly hand: AiHand;
  private planned = -1;
  private readonly slip: number;
  private readonly gap: number;

  constructor(
    private readonly game: MemoryRelay,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.slip = byDifficulty(player.difficulty, { easy: 0.08, normal: 0.045, hard: 0.02 });
    this.gap = byDifficulty(player.difficulty, { easy: 0.7, normal: 0.5, hard: 0.35 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.phase !== 'input' || g.current !== this.player.seat) return;
    if (this.planned === g.seq.length * 10 + g.turn) return;
    this.planned = g.seq.length * 10 + g.turn;
    const rng = g.rng;
    let at = 0.3;
    for (const color of g.seq) {
      const wrong = rng.next() < this.slip + g.seq.length * 0.008;
      this.hand.tap(wrong ? (color + 1 + Math.floor(rng.next() * 3)) % 4 : color, at, 0.05);
      at += this.gap * (0.7 + rng.next() * 0.6);
      if (wrong) return;
    }
    this.hand.tap(Math.floor(rng.next() * 4), at, 0.05);
  }
}

export const G18 = defineGame({
  code: 'G18',
  controls: 'four',
  padStyle: (_seat, index) => ({ color: SEAT_COLORS[index] }),
  create: () => new MemoryRelay(),
  createAI: (game, player, controls) => new RelayAI(game, player, controls),
});
