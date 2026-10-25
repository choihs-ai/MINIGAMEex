import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL, type Color } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawLine } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G51 드럼 배틀: 북이 리듬을 한 번 치면(듣기), 같은 리듬을 자기 버튼(패드)으로 따라 친다(따라 치기).
// 5라운드, 라운드마다 박자가 늘어난다. 정확도 순(맞힌 박자 − 헛친 수의 절반, 전체 박자 대비 %).

export const ROUNDS = 5;
/** 한 칸(8분음표) 길이 */
export const STEP = 0.25;
export const STEPS = 8;
export const LISTEN = STEP * STEPS;
export const CUE = 0.6;
export const PLAY = STEP * STEPS;
const RESULT = 0.8;
export const WINDOW = 0.11;
export const ROUND_TIME = LISTEN + CUE + PLAY + RESULT;

export type DrumPhase = 'listen' | 'cue' | 'play' | 'result';

export interface Drummer {
  seat: Seat;
  hits: number;
  extras: number;
  /** 이번 라운드에 맞힌 칸 */
  hitSteps: Set<number>;
  lastHitAt: number;
  lastExtraAt: number;
}

/** 라운드별 리듬: 첫 칸은 항상, 나머지는 무작위. 라운드가 갈수록 많아진다(3~6개). */
export function makePatterns(rng: { next(): number }): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const count = Math.min(6, 3 + r);
    const steps = new Set<number>([0]);
    while (steps.size < count) steps.add(1 + Math.floor(rng.next() * (STEPS - 1)));
    out.push([...steps].sort((a, b) => a - b));
  }
  return out;
}

export class DrumBattle implements MiniGame {
  readonly code = 'G51';
  patterns: number[][] = [];
  drummers: Drummer[] = [];
  round = 0;
  /** 라운드 시작 뒤 지난 시간 */
  roundT = 0;
  private lastListenStep = -1;
  private drumHitAt = -1;
  private t = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.patterns = makePatterns(ctx.rng);
    this.drummers = [...ctx.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ seat: p.seat, hits: 0, extras: 0, hitSteps: new Set(), lastHitAt: -1, lastExtraAt: -1 }));
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

  get phase(): DrumPhase {
    if (this.roundT < LISTEN) return 'listen';
    if (this.roundT < LISTEN + CUE) return 'cue';
    if (this.roundT < LISTEN + CUE + PLAY) return 'play';
    return 'result';
  }

  /** 따라 치기 시작 뒤 지난 시간 */
  get playT(): number {
    return this.roundT - LISTEN - CUE;
  }

  get pattern(): number[] {
    return this.patterns[Math.min(this.round, ROUNDS - 1)];
  }

  /** 지금까지 따라 칠 차례가 된 박자 수 */
  notesSoFar(): number {
    const done = this.patterns.slice(0, this.round).reduce((n, p) => n + p.length, 0);
    const current = this.phase === 'play' || this.phase === 'result' ? this.pattern.length : 0;
    return done + (this.round < ROUNDS ? current : 0);
  }

  totalNotes(): number {
    return this.patterns.reduce((n, p) => n + p.length, 0);
  }

  accuracy(seat: Seat): number {
    const d = this.drummers.find((x) => x.seat === seat)!;
    return Math.max(0, Math.round((100 * (d.hits - d.extras * 0.5)) / this.totalNotes()));
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.drummers.map((d) => [d.seat, this.accuracy(d.seat)])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.drummers.map((d) => ({ seat: d.seat, score: this.accuracy(d.seat) })));
  }

  /** 아직 안 친 박자 중 지금 시각에 맞는 칸(없으면 -1) */
  noteAt(d: Drummer, playT: number): number {
    let best = -1;
    let bestOff = WINDOW;
    for (const s of this.pattern) {
      const off = Math.abs(playT - s * STEP);
      if (!d.hitSteps.has(s) && off <= bestOff) {
        best = s;
        bestOff = off;
      }
    }
    return best;
  }

  canPress(seat: Seat): boolean {
    const d = this.drummers.find((x) => x.seat === seat);
    return !this.done && this.phase === 'play' && !!d && this.noteAt(d, this.playT) >= 0;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    this.roundT += dt;

    if (this.phase === 'listen') {
      const step = Math.floor(this.roundT / STEP);
      if (step !== this.lastListenStep) {
        this.lastListenStep = step;
        if (this.pattern.includes(step)) {
          this.ctx.sfx.drum(0);
          this.drumHitAt = this.t;
        }
      }
    }

    for (const d of this.drummers) {
      if (!this.ctx.controls.get(d.seat)!.justPressed()) continue;
      if (this.phase !== 'play') continue;
      const s = this.noteAt(d, this.playT);
      this.ctx.sfx.drum(d.seat);
      if (s >= 0) {
        d.hitSteps.add(s);
        d.hits++;
        d.lastHitAt = this.t;
      } else {
        d.extras++;
        d.lastExtraAt = this.t;
      }
    }

    if (this.roundT >= ROUND_TIME) {
      this.round++;
      this.roundT = 0;
      this.lastListenStep = -1;
      for (const d of this.drummers) d.hitSteps = new Set();
      if (this.round >= ROUNDS) this.done = true;
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const phase = this.phase;
    // 북(가운데): 둥근 북면 + 지그재그 줄
    const bounce = this.t - this.drumHitAt < 0.08 ? 2 : 0;
    const cx = 160;
    const top = 32 + bounce;
    r.rect(cx - 25, top, 50, 30, PAL.line);
    r.rect(cx - 24, top + 1, 48, 28, PAL.bgMid);
    for (let i = 0; i < 6; i++) {
      const x = cx - 24 + i * 8;
      drawLine(r, x, top + (i % 2 === 0 ? 4 : 26), x + 8, top + (i % 2 === 0 ? 26 : 4), PAL.text);
    }
    r.rect(cx - 25, top + 26, 50, 3, PAL.line);
    for (let dy = -4; dy <= 4; dy++) {
      const half = Math.round(25 * Math.sqrt(Math.max(0, 1 - (dy / 4.6) ** 2)));
      r.rect(cx - half, top + dy, half * 2, 1, Math.abs(dy) === 4 ? PAL.line : bounce ? PAL.yellow : PAL.text);
    }

    const label = phase === 'listen' ? '듣기' : phase === 'cue' ? '이제!' : phase === 'play' ? '따라 치기' : '';
    if (label) r.text(label, cx, 72, phase === 'cue' ? PAL.yellow : PAL.text, 'center');
    r.text(`${Math.min(this.round + 1, ROUNDS)}/${ROUNDS}`, cx, 2, PAL.text, 'center');

    // 박자 칸 8개와 진행 커서
    const cell = 12;
    const gap = 2;
    const x0 = cx - (STEPS * (cell + gap) - gap) / 2;
    const y0 = 86;
    const cursor =
      phase === 'listen' ? Math.floor(this.roundT / STEP) : phase === 'play' ? Math.floor(this.playT / STEP) : -1;
    for (let s = 0; s < STEPS; s++) {
      const x = x0 + s * (cell + gap);
      const note = this.pattern.includes(s);
      const played = phase === 'listen' && s <= cursor;
      const fill: Color = note ? (played || phase !== 'listen' ? PAL.text : PAL.bgMid) : PAL.bgDark;
      r.rect(x - 1, y0 - 1, cell + 2, cell + 2, PAL.line);
      r.rect(x, y0, cell, cell, fill);
      if (s === cursor) r.frame(x - 1, y0 - 1, cell + 2, cell + 2, PAL.yellow);
    }

    // 사람마다 한 줄: 맞힌 칸 표시 + 정확도
    this.drummers.forEach((d, i) => {
      const p = this.ctx.players.find((pl) => pl.seat === d.seat)!;
      const y = 104 + i * 9;
      r.text(`${d.seat + 1}P`, x0 - 22, y - 1, p.color.base);
      for (let s = 0; s < STEPS; s++) {
        if (!this.pattern.includes(s)) continue;
        const x = x0 + s * (cell + gap) + cell / 2 - 2;
        r.rect(x, y + 1, 4, 4, d.hitSteps.has(s) ? p.color.base : PAL.bgMid);
      }
      const recent = this.t - d.lastExtraAt < 0.25 ? PAL.red : this.t - d.lastHitAt < 0.25 ? PAL.yellow : PAL.text;
      // 진행 중에는 지금까지 맞힌 수 / 지금까지 나온 박자 수(최종 순위는 전체 대비 %)
      r.text(`${d.hits}/${this.notesSoFar()}`, x0 + STEPS * (cell + gap) + 4, y - 1, recent);
    });
  }
}

/** 따라 치기에서 박자마다 난이도별 확률로 맞추고, 가끔 헛친다. */
class DrumAI implements AiController {
  private readonly hand: AiHand;
  private plannedRound = -1;
  private readonly accuracy: number;

  constructor(
    private readonly game: DrumBattle,
    player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.accuracy = byDifficulty(player.difficulty, { easy: 0.6, normal: 0.75, hard: 0.9 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    if (this.game.finished || this.game.phase !== 'cue' || this.plannedRound === this.game.round) return;
    this.plannedRound = this.game.round;
    const rng = this.game.rng;
    const untilPlay = LISTEN + CUE - this.game.roundT;
    for (const s of this.game.pattern) {
      const at = untilPlay + s * STEP;
      if (rng.next() < this.accuracy) this.hand.tap(0, Math.max(0, at + jitter(rng, 0.03)), 0.04);
      else if (rng.next() < 0.4) this.hand.tap(0, Math.max(0, at + 0.16), 0.04);
    }
  }
}

export const G51 = defineGame({
  code: 'G51',
  controls: 'one',
  create: () => new DrumBattle(),
  createAI: (game, player, controls) => new DrumAI(game, player, controls),
});
