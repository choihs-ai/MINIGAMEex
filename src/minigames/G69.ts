import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { glyphIcon } from '../ui/padIcons';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawMarker, drawTimer, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PadStyle, type PlayerInfo } from './types';

// G69 블러핑 주사위(차례제, 4버튼): 내 차례에 주사위 2개가 몰래 굴러간다(? 버튼을 누르고 있는 동안만 보인다, 손으로 가리기).
// 합이 "몇 이상"이라고 −/+로 정해 선언(v). 앞사람 선언보다 커야 한다(거짓말 가능).
// 다음 사람은 믿거나(v, 그러면 자기가 굴려서 더 크게 선언해야 한다) 의심한다(x).
// 의심하면 공개: 진짜 합이 선언 이상이면 의심한 사람이, 아니면 거짓말한 사람이 목숨 하나를 잃는다. 시간 초과도 목숨 -1.
// 목숨 2개, 마지막 생존자가 1위.

export const LIVES = 2;
export const PEEK = 0;
export const MINUS = 1;
export const PLUS = 2;
export const OK = 3;
/** 의심은 OK 자리 반대(PEEK 자리) 버튼 */
export const DOUBT = 0;
export const CLAIM_TIME = 10;
export const RESPOND_TIME = 6;
const REVEAL_TIME = 2.4;
const GAP_TIME = 0.6;
const MAX_TIME = 160;
export const MAX_CLAIM = 12;

export type DicePhase = 'claim' | 'respond' | 'reveal' | 'gap';

/** 주사위 두 개 합이 n 이상일 확률 */
export function atLeast(n: number): number {
  let k = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= n) k++;
  return k / 36;
}

export interface Liar {
  seat: Seat;
  lives: number;
  outAt: number | null;
}

export class BluffDice implements MiniGame {
  readonly code = 'G69';
  t = 0;
  phase: DicePhase = 'gap';
  phaseT = 0;
  liars: Liar[] = [];
  order: Seat[] = [];
  /** 지금 굴리는(선언하는) 사람 */
  roller: Seat = 0;
  dice: [number, number] = [1, 1];
  /** 앞사람 선언(이번 판 처음이면 0) */
  prev = 0;
  /** 지금 고르는/한 선언 */
  claim = 0;
  /** 공개 결과: 목숨 잃은 사람 */
  loser: Seat | null = null;
  doubter: Seat | null = null;
  /** 이번 공개가 시간 초과 때문인가 */
  timedOut = false;
  /** 차례(선언·응답)가 바뀔 때마다 1씩 */
  step = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.order = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    this.liars = this.order.map((seat) => ({ seat, lives: LIVES, outAt: null }));
    this.roller = this.order[Math.floor(ctx.rng.next() * this.order.length)];
    this.startTurn(0);
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

  get sum(): number {
    return this.dice[0] + this.dice[1];
  }

  liar(seat: Seat): Liar {
    return this.liars.find((l) => l.seat === seat)!;
  }

  /** seat 다음 살아 있는 사람 */
  nextAlive(seat: Seat): Seat {
    const i = this.order.indexOf(seat);
    for (let k = 1; k <= this.order.length; k++) {
      const s = this.order[(i + k) % this.order.length];
      if (this.liar(s).outAt === null) return s;
    }
    return seat;
  }

  /** 지금 버튼을 눌러야 하는 사람 */
  get current(): Seat | null {
    if (this.phase === 'claim') return this.roller;
    if (this.phase === 'respond') return this.nextAlive(this.roller);
    return null;
  }

  canPress(seat: Seat): boolean {
    return !this.done && seat === this.current;
  }

  padStyle(seat: Seat, index: number): PadStyle | null {
    if (seat !== this.current) return null;
    if (this.phase === 'claim') return { icon: glyphIcon(['?', '-', '+', 'v'][index]) };
    if (index === DOUBT) return { icon: glyphIcon('x', PAL.red) };
    if (index === OK) return { icon: glyphIcon('v', this.prevBelievable ? PAL.green : PAL.bgMid) };
    return null;
  }

  /** 믿고 넘어갈 수 있는가(선언이 이미 최대면 의심밖에 없다) */
  get prevBelievable(): boolean {
    return this.claim < MAX_CLAIM;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.liars.map((l) => [l.seat, l.lives])) as Partial<Record<Seat, number>>;
  }

  /** 살아남은 사람(목숨 많은 순) → 늦게 탈락한 순 */
  getRanking(): Seat[][] {
    const groups: Seat[][] = [];
    const alive = this.liars.filter((l) => l.outAt === null).sort((a, b) => b.lives - a.lives);
    for (const l of alive) {
      const g = groups[groups.length - 1];
      if (g && this.liar(g[0]).lives === l.lives) g.push(l.seat);
      else groups.push([l.seat]);
    }
    const out = this.liars.filter((l) => l.outAt !== null).sort((a, b) => b.outAt! - a.outAt!);
    for (const l of out) {
      const g = groups[groups.length - 1];
      if (g && this.liar(g[0]).outAt === l.outAt) g.push(l.seat);
      else groups.push([l.seat]);
    }
    return groups;
  }

  private startTurn(prev: number): void {
    this.prev = prev;
    this.claim = Math.min(MAX_CLAIM, Math.max(prev + 1, 2));
    this.dice = [1 + Math.floor(this.ctx.rng.next() * 6), 1 + Math.floor(this.ctx.rng.next() * 6)];
    this.phase = 'claim';
    this.phaseT = 0;
    this.step++;
    this.ctx.sfx.drum(1);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.t >= MAX_TIME) {
      this.done = true;
      return;
    }
    if (this.phase === 'claim') {
      const c = this.ctx.controls.get(this.roller)!;
      const min = Math.min(MAX_CLAIM, Math.max(this.prev + 1, 2));
      if (c.justPressed(MINUS) && this.claim > min) {
        this.claim--;
        this.ctx.sfx.click();
      }
      if (c.justPressed(PLUS) && this.claim < MAX_CLAIM) {
        this.claim++;
        this.ctx.sfx.click();
      }
      if (this.phaseT >= CLAIM_TIME) {
        this.timeout(this.roller);
        return;
      }
      if (c.justPressed(OK)) {
        this.phase = 'respond';
        this.phaseT = 0;
        this.step++;
        this.ctx.sfx.turn();
      }
      return;
    }
    if (this.phase === 'respond') {
      const c = this.ctx.controls.get(this.current!)!;
      if (this.phaseT >= RESPOND_TIME) this.timeout(this.current!);
      else if (c.justPressed(DOUBT)) this.reveal(this.current!);
      else if (this.prevBelievable && c.justPressed(OK)) {
        this.roller = this.current!;
        this.startTurn(this.claim);
      }
      return;
    }
    if (this.phase === 'reveal' && this.phaseT >= REVEAL_TIME) {
      const lost = this.liar(this.loser!);
      lost.lives--;
      if (lost.lives <= 0) {
        lost.outAt = this.t;
        this.ctx.sfx.lose();
      }
      if (this.liars.filter((l) => l.outAt === null).length <= 1) {
        this.done = true;
        return;
      }
      // 진 사람(탈락했으면 그다음 사람)부터 새 판
      this.roller = lost.outAt === null ? lost.seat : this.nextAlive(lost.seat);
      this.phase = 'gap';
      this.phaseT = 0;
      return;
    }
    if (this.phase === 'gap' && this.phaseT >= GAP_TIME) this.startTurn(0);
  }

  /** 시간 안에 못 고르면 그 사람이 목숨 하나를 잃는다 */
  private timeout(seat: Seat): void {
    this.doubter = null;
    this.timedOut = true;
    this.loser = seat;
    this.phase = 'reveal';
    this.phaseT = 0;
    this.ctx.sfx.buzz();
  }

  private reveal(doubter: Seat): void {
    this.timedOut = false;
    this.doubter = doubter;
    const honest = this.sum >= this.claim;
    this.loser = honest ? doubter : this.roller;
    this.phase = 'reveal';
    this.phaseT = 0;
    this.ctx.sfx.buzz();
    this.ctx.fx.shake(2, 0.15);
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 가운데: 지금 선언
    r.rect(118, 52, 84, 60, PAL.line);
    r.rect(120, 54, 80, 56, PAL.bgMid);
    if (this.phase === 'claim' || this.phase === 'respond' || this.phase === 'reveal') {
      r.textScaled(String(this.claim), 160, 60, this.phase === 'claim' ? PAL.text : PAL.yellow, 3, 'center');
      r.text('이상!', 160, 88, PAL.text, 'center');
      if (this.prev > 0) r.text(`앞사람 ${this.prev}`, 160, 99, PAL.bgDark, 'center');
    }
    if (this.phase === 'reveal' && this.timedOut) r.text('시간 초과!', 160, 146, PAL.red, 'center');
    else if (this.phase === 'reveal') {
      drawDie(r, 128, 116, this.dice[0]);
      drawDie(r, 166, 116, this.dice[1]);
      const ok = this.sum >= this.claim;
      r.text(ok ? `${this.sum} 진짜!` : `${this.sum} 거짓말!`, 160, 146, ok ? PAL.green : PAL.red, 'center');
    }
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      const l = this.liar(p.seat);
      const out = l.outAt !== null;
      r.disc(a.x, a.y, 9, PAL.line);
      r.disc(a.x, a.y, 8, out ? PAL.bgMid : p.color.base);
      // 목숨(하트 대신 네모)
      for (let i = 0; i < LIVES; i++) r.rect(a.x - 6 + i * 8, a.y + 11, 5, 4, i < l.lives ? PAL.red : PAL.bgMid);
      if (this.phase === 'reveal' && this.loser === p.seat) r.text('-1', a.x, a.y - 4, PAL.text, 'center');
      if (p.seat === this.current) {
        drawMarker(r, a.x, a.y - 12, p.color.base);
        const left = this.phase === 'claim' ? CLAIM_TIME - this.phaseT : RESPOND_TIME - this.phaseT;
        drawTimer(r, left, a.x + (a.x < 160 ? 20 : -20), a.y - 4);
      }
      // 굴린 사람: 주사위 엎어 둔 컵. 사람이 ?를 누르고 있으면 그 사람에게만 보이게(작게) 연다.
      if (p.seat === this.roller && (this.phase === 'claim' || this.phase === 'respond')) {
        const cx = a.x < 160 ? a.x + 26 : a.x - 26;
        const cy = a.y + (a.y < 90 ? 14 : -14);
        const peek = !p.isAI && this.phase === 'claim' && this.ctx.controls.get(p.seat)!.isDown(PEEK);
        if (peek) {
          drawDie(r, cx - 15, cy - 7, this.dice[0], 13);
          drawDie(r, cx + 2, cy - 7, this.dice[1], 13);
        } else {
          r.rect(cx - 13, cy - 6, 26, 13, PAL.line);
          r.rect(cx - 12, cy - 5, 24, 11, PAL.yellowShadow);
          r.text('?', cx, cy - 4, PAL.text, 'center');
        }
      }
    }
  }
}

/** 눈이 찍힌 주사위 */
export function drawDie(r: Renderer, x: number, y: number, n: number, size = 26): void {
  r.rect(x, y, size, size, PAL.line);
  r.rect(x + 1, y + 1, size - 2, size - 2, PAL.text);
  const s = size / 4;
  const pip = (px: number, py: number) => r.rect(Math.round(x + px * s) - 1, Math.round(y + py * s) - 1, size > 16 ? 3 : 2, size > 16 ? 3 : 2, PAL.line);
  const at: Record<number, Array<[number, number]>> = {
    1: [[2, 2]],
    2: [[1, 1], [3, 3]],
    3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [3, 1], [1, 3], [3, 3]],
    5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
    6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
  };
  for (const [px, py] of at[n]) pip(px, py);
}

/**
 * 선언: 진짜 합이 앞사람보다 크면 대체로 그대로(가끔 한두 칸 부풀림), 아니면 앞사람+1~2로 허세.
 * 응답: 선언이 나올 확률이 낮으면 의심. 난이도가 낮으면 판단이 흔들린다.
 */
class DiceAI implements AiController {
  private readonly hand: AiHand;
  private planned = -1;
  private readonly noise: number;
  private readonly doubtLine: number;

  constructor(
    private readonly game: BluffDice,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.noise = byDifficulty(player.difficulty, { easy: 0.22, normal: 0.12, hard: 0.06 });
    this.doubtLine = byDifficulty(player.difficulty, { easy: 0.35, normal: 0.42, hard: 0.45 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.current !== this.player.seat) return;
    if (this.planned === g.step) return;
    this.planned = g.step;
    const rng = g.rng;
    const think = 0.6 + rng.next() * 1.2;
    if (g.phase === 'claim') {
      const min = Math.min(MAX_CLAIM, Math.max(g.prev + 1, 2));
      let want: number;
      if (g.sum >= min) want = rng.next() < 0.25 ? g.sum + 1 : g.sum;
      else want = min + (rng.next() < 0.25 ? 1 : 0);
      // 처음 선언은 너무 낮게 하지 않는다(다음 사람이 쉽게 믿고 넘어간다)
      if (g.prev === 0) want = Math.max(want, 5 + Math.floor(rng.next() * 3));
      want = Math.max(min, Math.min(MAX_CLAIM, want));
      let at = think;
      const steps = want - g.claim;
      for (let i = 0; i < Math.abs(steps); i++) {
        this.hand.tap(steps > 0 ? PLUS : MINUS, at, 0.05);
        at += 0.12;
      }
      this.hand.tap(OK, at + 0.2, 0.05);
      return;
    }
    if (g.phase === 'respond') {
      // 앞사람 선언을 믿으면 내가 그보다 높게 내야 한다: 그 확률까지 따져 본다
      const p = atLeast(g.claim) + jitter(rng, this.noise);
      const mine = atLeast(g.claim + 1);
      const doubt = !g.prevBelievable || (p < this.doubtLine && rng.next() < 0.85) || (mine < 0.2 && p < 0.6);
      this.hand.tap(doubt ? DOUBT : OK, think * 0.8, 0.05);
    }
  }
}

export const G69 = defineGame({
  code: 'G69',
  controls: 'four',
  create: () => new BluffDice(),
  createAI: (game, player, controls) => new DiceAI(game, player, controls),
});
