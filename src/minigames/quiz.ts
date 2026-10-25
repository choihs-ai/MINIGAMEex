import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { AiHand, byDifficulty } from './ai';
import { anchorOf, drawScoreTag, localOffset, drawTimer, facing, TIMER_X, TIMER_Y } from './common';
import type { AiController, GameContext, MiniGame, PlayerInfo } from './types';

// 가운데 문제를 보고 맞는 버튼을 가장 먼저 누르는 게임의 공통 틀(G20 가위바위보, G21 색깔 함정).
// 가장 먼저 맞힌 사람 +1(같은 틱이면 함께), 틀리면 -1이고 그 문제는 더 못 누른다.

export type QuizPhase = 'gap' | 'ask' | 'reveal';

const GAP_MIN = 0.35;
const GAP_MAX = 0.8;
/** 아무도 못 맞히면 이 시간 뒤 다음 문제 */
export const ASK_TIMEOUT = 2.6;
const REVEAL_TIME = 0.55;

export abstract class QuizGame implements MiniGame {
  abstract readonly code: string;
  abstract readonly duration: number;
  /** 버튼 수 */
  abstract readonly choices: number;
  t = 0;
  phase: QuizPhase = 'gap';
  phaseT = 0;
  /** 이번 문제의 정답 버튼 */
  answer = 0;
  question = 0;
  readonly scores = new Map<Seat, number>();
  readonly locked = new Set<Seat>();
  winners: Seat[] = [];
  protected ctx!: GameContext;
  private gapTime = 0.6;
  private done = false;
  private flash = new Map<Seat, { t: number; delta: number }>();

  /** 새 문제를 내고 정답 버튼을 answer에 둔다 */
  protected abstract newQuestion(): void;
  /** 가운데 문제 그림 */
  protected abstract drawQuestion(r: Renderer): void;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) this.scores.set(p.seat, 0);
    this.gapTime = 0.5;
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
    return this.phase === 'ask' && !this.locked.has(seat) && !this.done;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.scores) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.scores].map(([seat, score]) => ({ seat, score })));
  }

  private add(seat: Seat, delta: number): void {
    this.scores.set(seat, (this.scores.get(seat) ?? 0) + delta);
    this.flash.set(seat, { t: this.t, delta });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;

    if (this.phase === 'ask') {
      const winners: Seat[] = [];
      for (const p of this.ctx.players) {
        if (this.locked.has(p.seat)) continue;
        const c = this.ctx.controls.get(p.seat)!;
        const pressed: number[] = [];
        for (let b = 0; b < this.choices; b++) if (c.justPressed(b)) pressed.push(b);
        if (pressed.length === 0) continue;
        // 여러 버튼을 한꺼번에 누르면 틀린 것으로 본다(찍기 방지)
        if (pressed.length === 1 && pressed[0] === this.answer) winners.push(p.seat);
        else {
          this.locked.add(p.seat);
          this.add(p.seat, -1);
          this.ctx.sfx.buzz();
        }
      }
      if (winners.length > 0) {
        this.winners = winners;
        for (const s of winners) this.add(s, 1);
        this.ctx.sfx.coin();
        this.ctx.fx.shake(2, 0.1);
        this.toPhase('reveal');
      } else if (this.phaseT >= ASK_TIMEOUT || this.ctx.players.every((p) => this.locked.has(p.seat))) {
        this.toPhase('reveal');
      }
    } else if (this.phase === 'gap' && this.phaseT >= this.gapTime) {
      this.locked.clear();
      this.winners = [];
      this.newQuestion();
      this.question++;
      this.toPhase('ask');
      this.ctx.sfx.turn();
    } else if (this.phase === 'reveal' && this.phaseT >= REVEAL_TIME) {
      this.gapTime = GAP_MIN + this.ctx.rng.next() * (GAP_MAX - GAP_MIN);
      this.toPhase('gap');
    }

    if (this.t >= this.duration) this.done = true;
  }

  private toPhase(phase: QuizPhase): void {
    this.phase = phase;
    this.phaseT = 0;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    if (this.phase !== 'gap') this.drawQuestion(r);
    for (const p of this.ctx.players) {
      const a = anchorOf(p, this.ctx.humanCount);
      const won = this.phase === 'reveal' && this.winners.includes(p.seat);
      const pose = won ? 'win' : this.locked.has(p.seat) ? 'lose' : 'idle';
      facing(r, p, a.x, a.y, () => {
        drawCharacter(r.ctx, p.seat, pose, this.t + p.seat * 0.3, a.x - CHAR_SIZE / 2, a.y - CHAR_SIZE / 2 - 4);
        const f = this.flash.get(p.seat);
        if (f && this.t - f.t < 0.7) {
          r.text(f.delta > 0 ? `+${f.delta}` : String(f.delta), a.x + 16, a.y - 20, f.delta > 0 ? PAL.yellow : PAL.red);
        }
      });
      const tag = localOffset(p, a, 24, -6);
      drawScoreTag(r, p, tag.x, tag.y, this.scores.get(p.seat) ?? 0);
    }
    drawTimer(r, this.duration - this.t, TIMER_X, TIMER_Y);
  }
}

/** 문제가 뜨면 생각할 시간 뒤에 정답(가끔 오답)을 누른다 */
export class QuizAI implements AiController {
  private readonly hand: AiHand;
  private question = -1;
  private readonly reaction: readonly [number, number];
  private readonly wrong: number;

  constructor(
    private readonly game: QuizGame,
    player: PlayerInfo,
    controls: PlayerControls,
    opts: { reaction: Record<PlayerInfo['difficulty'], [number, number]>; wrong: Record<PlayerInfo['difficulty'], number> },
  ) {
    this.hand = new AiHand(controls);
    this.reaction = byDifficulty(player.difficulty, opts.reaction);
    this.wrong = byDifficulty(player.difficulty, opts.wrong);
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    if (g.phase !== 'ask') {
      if (this.hand.busy) this.hand.reset();
      return;
    }
    if (g.question === this.question) return;
    this.question = g.question;
    const rng = g.rng;
    const [lo, hi] = this.reaction;
    let button = g.answer;
    if (rng.next() < this.wrong) button = (g.answer + 1 + Math.floor(rng.next() * (g.choices - 1))) % g.choices;
    this.hand.tap(button, lo + rng.next() * (hi - lo));
  }
}
