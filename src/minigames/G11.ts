import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { AiHand, byDifficulty } from './ai';
import { anchorOf, drawScoreTag, localOffset, drawTimer, facing, TIMER_X, TIMER_Y } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G11 두더지 쟁탈전: 가운데 구멍에서 나온 두더지를 가장 먼저 때린다(원버튼).
// 보통 +1, 황금 +3, 폭탄 -2(때린 사람). 빈 구멍을 때리면 0.5초 동안 못 때린다.

export const DURATION = 25;
export const LOCKOUT = 0.8;
const EMPTY_MIN = 0.35;
const EMPTY_MAX = 1.1;
const RISE_TIME = 0.12;
const HIT_SHOW = 0.45;
/** 빈 구멍에서 두더지가 살짝 고개만 내미는 속임(이때 치면 헛방) */
const PEEK_CHANCE = 0.4;
export const PEEK_TIME = 0.3;

export type MoleKind = 'normal' | 'gold' | 'bomb';
export const MOLE_POINTS: Readonly<Record<MoleKind, number>> = { normal: 1, gold: 3, bomb: -2 };
const UP_TIME: Readonly<Record<MoleKind, number>> = { normal: 0.6, gold: 0.4, bomb: 0.8 };

export type MolePhase = 'empty' | 'up' | 'hit';

export class MoleGrab implements MiniGame {
  readonly code = 'G11';
  t = 0;
  phase: MolePhase = 'empty';
  phaseT = 0;
  kind: MoleKind = 'normal';
  emptyTime = 1;
  /** 이번 빈 구멍 동안 속임 고개 시각(없으면 null) */
  peekAt: number | null = null;
  readonly scores = new Map<Seat, number>();
  /** 자리별 못 때리는 시간이 끝나는 시각 */
  readonly lockedUntil = new Map<Seat, number>();
  hitters: Seat[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) this.scores.set(p.seat, 0);
    this.toEmpty();
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

  locked(seat: Seat): boolean {
    return (this.lockedUntil.get(seat) ?? -1) > this.t;
  }

  canPress(seat: Seat): boolean {
    return this.phase === 'up' && this.kind !== 'bomb' && !this.locked(seat) && !this.done;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.scores) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.scores].map(([seat, score]) => ({ seat, score })));
  }

  private toEmpty(): void {
    this.phase = 'empty';
    this.phaseT = 0;
    this.emptyTime = EMPTY_MIN + this.ctx.rng.next() * (EMPTY_MAX - EMPTY_MIN);
    this.peekAt =
      this.emptyTime > 0.7 && this.ctx.rng.next() < PEEK_CHANCE ? 0.1 + this.ctx.rng.next() * (this.emptyTime - 0.6) : null;
  }

  /** 지금 속임 고개 중인가(빈 구멍과 같아서 치면 헛방) */
  peeking(): boolean {
    return this.phase === 'empty' && this.peekAt !== null && this.phaseT >= this.peekAt && this.phaseT < this.peekAt + PEEK_TIME;
  }

  private popUp(): void {
    const roll = this.ctx.rng.next();
    this.kind = roll < 0.12 ? 'gold' : roll < 0.4 ? 'bomb' : 'normal';
    this.phase = 'up';
    this.phaseT = 0;
    this.hitters = [];
    this.ctx.sfx.turn();
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;

    const hitters: Seat[] = [];
    for (const p of this.ctx.players) {
      if (!this.ctx.controls.get(p.seat)!.justPressed() || this.locked(p.seat)) continue;
      if (this.phase === 'up') hitters.push(p.seat);
      else if (this.phase === 'empty') {
        this.lockedUntil.set(p.seat, this.t + LOCKOUT);
        this.ctx.sfx.buzz();
      }
      // 이미 맞은 두더지(hit)를 늦게 친 것은 벌 없이 무시
    }
    if (hitters.length > 0) {
      const pts = MOLE_POINTS[this.kind];
      for (const s of hitters) this.scores.set(s, (this.scores.get(s) ?? 0) + pts);
      this.hitters = hitters;
      this.phase = 'hit';
      this.phaseT = 0;
      if (this.kind === 'bomb') {
        this.ctx.sfx.lose();
        this.ctx.fx.shake(4, 0.25);
        this.ctx.fx.burst(160, 86, PAL.yellow, 12);
      } else {
        this.ctx.sfx.hit();
        this.ctx.fx.shake(2, 0.1);
        this.ctx.fx.burst(160, 80, this.kind === 'gold' ? PAL.yellow : PAL.text, 8);
      }
    }

    if (this.phase === 'empty' && this.phaseT >= this.emptyTime) this.popUp();
    else if (this.phase === 'up' && this.phaseT >= UP_TIME[this.kind]) this.toEmpty();
    else if (this.phase === 'hit' && this.phaseT >= HIT_SHOW) this.toEmpty();

    if (this.t >= DURATION) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const cx = 160;
    const cy = 96;
    // 흙더미와 구멍
    r.rect(cx - 34, cy + 2, 68, 10, PAL.greenShadow);
    r.rect(cx - 30, cy, 60, 4, PAL.greenShadow);
    r.rect(cx - 24, cy - 3, 48, 7, PAL.line);
    // 두더지: 구멍 위로 올라온 높이만큼 보인다
    let rise = 0;
    if (this.phase === 'up') rise = Math.min(1, this.phaseT / RISE_TIME);
    else if (this.peeking()) rise = 0.3;
    else if (this.phase === 'hit') rise = Math.max(0, 1 - this.phaseT / HIT_SHOW) * 0.6;
    if (rise > 0) {
      const sprite = moleSprite(this.peeking() ? 'normal' : this.kind, this.phase === 'hit');
      const visible = Math.round(sprite.height * rise);
      r.ctx.drawImage(sprite, 0, 0, sprite.width, visible, cx - sprite.width / 2, cy - visible + 1, sprite.width, visible);
    }
    r.rect(cx - 24, cy + 1, 48, 3, PAL.line);
    if (this.phase === 'hit') {
      const pts = MOLE_POINTS[this.kind];
      r.text(pts > 0 ? `+${pts}` : String(pts), cx, cy - 46, pts > 0 ? PAL.yellow : PAL.red, 'center');
    }

    for (const p of this.ctx.players) {
      const a = anchorOf(p, this.ctx.humanCount);
      const hit = this.phase === 'hit' && this.hitters.includes(p.seat);
      const pose = hit ? (this.kind === 'bomb' ? 'lose' : 'win') : this.locked(p.seat) ? 'lose' : 'idle';
      facing(r, p, a.x, a.y, () => {
        drawCharacter(r.ctx, p.seat, pose, this.t + p.seat * 0.3, a.x - CHAR_SIZE / 2, a.y - CHAR_SIZE / 2 - 4);
        if (this.locked(p.seat)) r.text('헛방!', a.x, a.y - 26, PAL.text, 'center');
      });
      const tag = localOffset(p, a, 24, -6);
      drawScoreTag(r, p, tag.x, tag.y, this.scores.get(p.seat) ?? 0);
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }
}

const moleCache = new Map<string, HTMLCanvasElement>();

/** 두더지(보통·황금)와 폭탄, 26×30 */
function moleSprite(kind: MoleKind, dizzy: boolean): HTMLCanvasElement {
  const key = `${kind}|${dizzy}`;
  const hit = moleCache.get(key);
  if (hit) return hit;
  const g = new Grid(26, 30);
  if (kind === 'bomb') {
    g.ellipse(13, 19, 10, 10, PAL.bgMid, PAL.line);
    g.rect(11, 7, 5, 3, PAL.bgMid);
    g.line(14, 6, 18, 2, PAL.yellowShadow);
    g.rect(18, 0, 3, 3, dizzy ? PAL.text : PAL.yellow);
    g.rect(8, 14, 3, 2, PAL.text);
  } else {
    const [base, shadow] = kind === 'gold' ? [PAL.yellow, PAL.yellowShadow] : [PAL.redShadow, PAL.line];
    g.ellipse(13, 18, 11, 13, base, shadow);
    g.ellipse(13, 17, 5, 3, PAL.text);
    g.rect(12, 14, 3, 2, PAL.red);
    if (dizzy) {
      g.line(6, 8, 9, 11, PAL.line);
      g.line(9, 8, 6, 11, PAL.line);
      g.line(17, 8, 20, 11, PAL.line);
      g.line(20, 8, 17, 11, PAL.line);
    } else {
      g.rect(7, 9, 2, 3, PAL.line);
      g.rect(17, 9, 2, 3, PAL.line);
    }
    g.rect(4, 22, 4, 3, PAL.text);
    g.rect(18, 22, 4, 3, PAL.text);
  }
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  moleCache.set(key, canvas);
  return canvas;
}

/** 두더지가 보이면 반응 시간 뒤에 친다. 폭탄은 난이도만큼 참는다. 가끔 성급하게 빈 구멍을 친다. */
class MoleGrabAI implements AiController {
  private readonly hand: AiHand;
  private seenUp = false;
  private readonly reaction: readonly [number, number];
  private readonly bombDodge: number;
  private readonly rash: number;
  private readonly fooled: number;
  private sawPeek = false;

  constructor(
    private readonly game: MoleGrab,
    player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.reaction = byDifficulty(player.difficulty, { easy: [0.38, 0.62], normal: [0.28, 0.46], hard: [0.21, 0.32] });
    this.bombDodge = byDifficulty(player.difficulty, { easy: 0.6, normal: 0.82, hard: 0.95 });
    this.rash = byDifficulty(player.difficulty, { easy: 0.12, normal: 0.06, hard: 0.02 });
    this.fooled = byDifficulty(player.difficulty, { easy: 0.4, normal: 0.2, hard: 0.08 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    const rng = g.rng;
    if (g.peeking() && !this.sawPeek) {
      this.sawPeek = true;
      const [lo, hi] = this.reaction;
      if (rng.next() < this.fooled) this.hand.tap(0, lo + rng.next() * (hi - lo));
    } else if (!g.peeking()) this.sawPeek = false;
    if (g.phase === 'up' && !this.seenUp) {
      this.seenUp = true;
      if (g.kind === 'bomb' && rng.next() < this.bombDodge) return;
      const [lo, hi] = this.reaction;
      this.hand.tap(0, lo + rng.next() * (hi - lo));
    } else if (g.phase !== 'up' && this.seenUp) {
      this.seenUp = false;
      this.hand.reset();
      if (rng.next() < this.rash) this.hand.tap(0, 0.2 + rng.next() * 0.5);
    }
  }
}

export const G11 = defineGame({
  code: 'G11',
  controls: 'one',
  create: () => new MoleGrab(),
  createAI: (game, player, controls) => new MoleGrabAI(game, player, controls),
});
