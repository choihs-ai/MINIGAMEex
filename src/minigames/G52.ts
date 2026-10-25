import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { DIGIT_BIG, DIGIT_SMALL, drawNumber, numberWidth } from '../ui/bigText';
import { AiHand, byDifficulty, jitter } from './ai';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G52 멈춰 시계: 정확히 10.00초에 누른다. 1.5초가 지나면 숫자가 사라진다. 오차 합이 작은 순.
// 세부표는 3라운드지만 판 길이(20~30초)에 맞춰 2라운드.

export const ROUNDS = 2;
export const TARGET = 10;
export const HIDE_AFTER = 1.5;
/** 이때까지 안 누르면 이 시각에 누른 것으로 친다(오차 4초) */
export const TIMEOUT = 14;
const REVEAL = 2.4;

export class StopClock implements MiniGame {
  readonly code = 'G52';
  round = 0;
  phase: 'run' | 'reveal' = 'run';
  phaseT = 0;
  /** 이번 라운드에 멈춘 시각 */
  readonly stops = new Map<Seat, number>();
  /** 라운드별 오차(초) */
  readonly errors = new Map<Seat, number[]>();
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) this.errors.set(p.seat, []);
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

  totalError(seat: Seat): number {
    return (this.errors.get(seat) ?? []).reduce((a, b) => a + b, 0);
  }

  /** 오차 합(1/100초) */
  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.ctx.players.map((p) => [p.seat, Math.round(this.totalError(p.seat) * 100)])) as Partial<
      Record<Seat, number>
    >;
  }

  getRanking(): Seat[][] {
    return rankByScore(
      this.ctx.players.map((p) => ({ seat: p.seat, score: Math.round(this.totalError(p.seat) * 100) })),
      false,
    );
  }

  canPress(seat: Seat): boolean {
    return !this.done && this.phase === 'run' && !this.stops.has(seat);
  }

  update(dt: number): void {
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'run') {
      for (const p of this.ctx.players) {
        if (this.stops.has(p.seat) || !this.ctx.controls.get(p.seat)!.justPressed()) continue;
        this.stops.set(p.seat, this.phaseT);
        this.ctx.sfx.click();
      }
      if (this.stops.size === this.ctx.players.length || this.phaseT >= TIMEOUT) {
        for (const p of this.ctx.players) this.errors.get(p.seat)!.push(Math.abs((this.stops.get(p.seat) ?? TIMEOUT) - TARGET));
        this.phase = 'reveal';
        this.phaseT = 0;
        this.ctx.sfx.signal();
      }
    } else if (this.phaseT >= REVEAL) {
      this.round++;
      if (this.round >= ROUNDS) {
        this.done = true;
        return;
      }
      this.phase = 'run';
      this.phaseT = 0;
      this.stops.clear();
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.text(`${Math.min(this.round + 1, ROUNDS)}/${ROUNDS}`, 160, 2, PAL.text, 'center');
    r.text('목표 10.00', 160, 16, PAL.yellow, 'center');

    const shown = this.phase === 'run' ? this.phaseT : TARGET;
    const y = 32;
    // 시계처럼 오른쪽 끝을 맞춘다. 숫자가 사라진 뒤에는 꺼진 세그먼트만 보인다.
    const right = 160 + Math.ceil(numberWidth('88.88', DIGIT_BIG) / 2);
    drawNumber(r, '88.88', right, y, DIGIT_BIG, PAL.bgMid, { align: 'right' });
    if (this.phase === 'reveal' || this.phaseT < HIDE_AFTER) {
      drawNumber(r, shown.toFixed(2), right, y, DIGIT_BIG, PAL.text, { shadow: PAL.line, align: 'right' });
    }

    // 사람마다: 멈췄는지, 공개 때는 시각과 오차
    const players = [...this.ctx.players].sort((a, b) => a.seat - b.seat);
    const best = this.phase === 'reveal' ? Math.min(...players.map((p) => this.lastError(p.seat))) : -1;
    players.forEach((p, i) => {
      const cx = Math.round((320 * (i + 1)) / (players.length + 1));
      const yy = 104;
      r.text(`${p.seat + 1}P`, cx, yy, p.color.base, 'center');
      const stop = this.stops.get(p.seat);
      if (this.phase === 'run') {
        r.rect(cx - 6, yy + 14, 12, 12, PAL.line);
        r.rect(cx - 5, yy + 15, 10, 10, stop !== undefined ? p.color.base : PAL.bgDark);
      } else {
        const err = this.lastError(p.seat);
        drawNumber(r, (stop ?? TIMEOUT).toFixed(2), cx, yy + 13, DIGIT_SMALL, err === best ? PAL.yellow : PAL.text, {
          align: 'center',
        });
        r.text(`±${err.toFixed(2)}`, cx, yy + 28, err === best ? PAL.yellow : PAL.text, 'center');
      }
    });
  }

  lastError(seat: Seat): number {
    const list = this.errors.get(seat) ?? [];
    return list[list.length - 1] ?? 0;
  }
}

/** 10초를 마음속으로 세어 누른다(난이도별 오차: 쉬움 ±0.6, 보통 ±0.3, 어려움 ±0.12초). */
class StopClockAI implements AiController {
  private readonly hand: AiHand;
  private plannedRound = -1;
  private readonly sigma: number;

  constructor(
    private readonly game: StopClock,
    player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.sigma = byDifficulty(player.difficulty, { easy: 0.6, normal: 0.3, hard: 0.12 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    if (this.game.finished || this.game.phase !== 'run' || this.plannedRound === this.game.round) return;
    this.plannedRound = this.game.round;
    const at = Math.max(1, TARGET + jitter(this.game.rng, this.sigma));
    this.hand.tap(0, Math.max(0, at - this.game.phaseT));
  }
}

export const G52 = defineGame({
  code: 'G52',
  controls: 'one',
  create: () => new StopClock(),
  createAI: (game, player, controls) => new StopClockAI(game, player, controls),
});
