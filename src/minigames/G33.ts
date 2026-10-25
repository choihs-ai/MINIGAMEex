import { BTN_LEFT, BTN_RIGHT, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { AiHand } from './ai';
import { drawScoreTag, facing, localOffset, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G33 배신 or 협력: 매 라운드 몰래 "나눔"(왼쪽 버튼) 또는 "독식"(오른쪽 버튼)을 고른다(공개 전까지 바꿀 수 있다).
// 전원 나눔: 각 2점 / 독식 1명: 그 사람 5점 / 독식 2명 이상: 독식한 사람 0점. 안 고르면 나눔. 5라운드 합.

export const ROUNDS = 5;
export const CHOOSE_TIME = 4;
const REVEAL_TIME = 2;
export const SHARE = BTN_LEFT;
export const GRAB = BTN_RIGHT;

export type Choice = 'share' | 'grab';

/** 한 라운드 점수 */
export function roundPoints(choices: ReadonlyMap<Seat, Choice>): Map<Seat, number> {
  const grabbers = [...choices].filter(([, c]) => c === 'grab').map(([s]) => s);
  const out = new Map<Seat, number>();
  for (const s of choices.keys()) out.set(s, 0);
  if (grabbers.length === 0) for (const s of choices.keys()) out.set(s, 2);
  else if (grabbers.length === 1) out.set(grabbers[0], 5);
  return out;
}

export class TrustOrBetray implements MiniGame {
  readonly code = 'G33';
  t = 0;
  round = 0;
  phase: 'choose' | 'reveal' = 'choose';
  phaseT = 0;
  readonly choices = new Map<Seat, Choice>();
  readonly picked = new Set<Seat>();
  readonly scores = new Map<Seat, number>();
  lastGain = new Map<Seat, number>();
  /** 지난 라운드까지 독식한 횟수(AI가 참고) */
  readonly grabs = new Map<Seat, number>();
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) {
      this.scores.set(p.seat, 0);
      this.grabs.set(p.seat, 0);
      this.choices.set(p.seat, 'share');
    }
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

  canPress(): boolean {
    return this.phase === 'choose' && !this.done;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.scores) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.scores].map(([seat, score]) => ({ seat, score })));
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'choose') {
      for (const p of this.ctx.players) {
        const c = this.ctx.controls.get(p.seat)!;
        if (c.justPressed(SHARE)) this.choose(p.seat, 'share');
        if (c.justPressed(GRAB)) this.choose(p.seat, 'grab');
      }
      if (this.phaseT >= CHOOSE_TIME) {
        this.lastGain = roundPoints(this.choices);
        for (const [s, g] of this.lastGain) this.scores.set(s, (this.scores.get(s) ?? 0) + g);
        for (const [s, c] of this.choices) if (c === 'grab') this.grabs.set(s, (this.grabs.get(s) ?? 0) + 1);
        const anyGrab = [...this.choices.values()].includes('grab');
        if (anyGrab) this.ctx.sfx.buzz();
        else this.ctx.sfx.coin();
        this.phase = 'reveal';
        this.phaseT = 0;
      }
    } else if (this.phaseT >= REVEAL_TIME) {
      this.round++;
      if (this.round >= ROUNDS) {
        this.done = true;
        return;
      }
      this.phase = 'choose';
      this.phaseT = 0;
      this.picked.clear();
      for (const s of this.choices.keys()) this.choices.set(s, 'share');
    }
  }

  private choose(seat: Seat, c: Choice): void {
    this.choices.set(seat, c);
    this.picked.add(seat);
    this.ctx.sfx.click();
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(130, 80, 60, 20, PAL.line);
    r.text(`${this.round + 1}/${ROUNDS}`, 160, 82, PAL.text, 'center');
    if (this.phase === 'choose') {
      const left = Math.ceil(CHOOSE_TIME - this.phaseT);
      r.text(String(left), 160, 91, PAL.yellow, 'center');
    }
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      const reveal = this.phase === 'reveal';
      const choice = this.choices.get(p.seat)!;
      facing(r, p, a.x, a.y, () => {
        const gain = this.lastGain.get(p.seat) ?? 0;
        drawCharacter(r.ctx, p.seat, reveal ? (gain > 0 ? 'win' : 'lose') : 'idle', this.t + p.seat * 0.3, a.x - CHAR_SIZE / 2, a.y - CHAR_SIZE / 2 - 4);
        if (reveal) {
          r.ctx.drawImage(choiceIcon(choice), a.x - 6, a.y - 32);
          r.text(`+${gain}`, a.x + 16, a.y - 28, gain > 0 ? PAL.yellow : PAL.bgMid);
        } else if (this.picked.has(p.seat)) {
          r.text('골랐다', a.x, a.y - 30, PAL.text, 'center');
        }
      });
      const tag = localOffset(p, a, 24, -6);
      drawScoreTag(r, p, tag.x, tag.y, this.scores.get(p.seat) ?? 0);
    }
  }
}

const iconCache = new Map<Choice, HTMLCanvasElement>();

/** 나눔: 동전 둘(초록 테두리) / 독식: 큰 동전 더미(빨강 테두리) */
export function choiceIcon(c: Choice): HTMLCanvasElement {
  let icon = iconCache.get(c);
  if (icon) return icon;
  const g = new Grid(13, 13);
  if (c === 'share') {
    g.ellipse(4, 7, 3, 3, PAL.yellow, PAL.yellowShadow);
    g.ellipse(9.5, 7, 3, 3, PAL.yellow, PAL.yellowShadow);
  } else {
    for (let i = 0; i < 4; i++) g.rect(2, 9 - i * 2, 9, 2, i % 2 ? PAL.yellowShadow : PAL.yellow);
    g.rect(9, 1, 3, 3, PAL.red);
  }
  g.outline(PAL.line);
  icon = g.toCanvas();
  iconCache.set(c, icon);
  return icon;
}

/** 대체로 나누다가, 남이 독식하면 따라 독식하기도 하고 가끔 혼자 배신한다(마지막 라운드엔 더 자주) */
class TrustAI implements AiController {
  private readonly hand: AiHand;
  private round = -1;

  constructor(
    private readonly game: TrustOrBetray,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.phase !== 'choose' || g.round === this.round) return;
    this.round = g.round;
    const rng = g.rng;
    const othersGrab = [...g.grabs].filter(([s]) => s !== this.player.seat).reduce((n, [, k]) => n + k, 0);
    let p = 0.2 + othersGrab * 0.08 + (g.round === ROUNDS - 1 ? 0.25 : 0);
    p = Math.min(0.75, p);
    this.hand.tap(rng.next() < p ? GRAB : SHARE, 0.5 + rng.next() * 2.5);
  }
}

export const G33 = defineGame({
  code: 'G33',
  controls: 'leftRight',
  padStyle: (_seat, index) =>
    index === SHARE ? { color: SEAT_COLORS[3], icon: choiceIcon('share') } : { color: SEAT_COLORS[0], icon: choiceIcon('grab') },
  create: () => new TrustOrBetray(),
  createAI: (game, player, controls) => new TrustAI(game, player, controls),
});
