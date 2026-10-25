import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { AiHand, byDifficulty } from './ai';
import { drawNumber, DIGIT_SMALL } from '../ui/bigText';
import { drawScoreTag, facing, localOffset, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G31 욕심 게임(G56 해적 보물 파기 흡수): 시작 신호 때 버튼을 누르고 있으면 보물을 파기 시작한다.
// 누르고 있는 동안 보물이 점점 빨리 불어나고, 손을 떼면 그만큼 챙긴다. 언제 나올지 모르는 해골(폭발) 때
// 아직 누르고 있던 사람은 이번 판 0점. 5판 합.

export const ROUNDS = 5;
const READY_TIME = 1.2;
/** 시작 신호 뒤 이만큼은 늦게 눌러도 참가 */
const JOIN_LATE = 0.4;
const SKULL_MIN = 1.0;
const SKULL_MAX = 5.5;
const SHOW_TIME = 1.4;

/** 파기 시작 후 t초 동안 불어난 보물 */
export function treasure(t: number): number {
  return Math.round(10 * Math.max(0, t) ** 1.5);
}

export type GreedPhase = 'ready' | 'dig' | 'show';

export interface Digger {
  seat: Seat;
  total: number;
  /** 이번 판: 파는 중 / 챙김 / 터짐 / 안 함 */
  state: 'out' | 'digging' | 'banked' | 'blown';
  gain: number;
}

export class GreedDig implements MiniGame {
  readonly code = 'G31';
  t = 0;
  round = 0;
  phase: GreedPhase = 'ready';
  phaseT = 0;
  /** 이번 판 해골이 나오는 시각(파기 시작 기준, 숨김) */
  skullAt = 3;
  diggers: Digger[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.diggers = ctx.players.map((p) => ({ seat: p.seat, total: 0, state: 'out', gain: 0 }));
    this.startRound();
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

  get pot(): number {
    return this.phase === 'dig' ? treasure(this.phaseT) : 0;
  }

  canPress(seat: Seat): boolean {
    const d = this.diggers.find((x) => x.seat === seat)!;
    return !this.done && (this.phase === 'ready' || (this.phase === 'dig' && d.state === 'out' && this.phaseT < JOIN_LATE));
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.diggers.map((d) => [d.seat, d.total])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.diggers.map((d) => ({ seat: d.seat, score: d.total })));
  }

  private startRound(): void {
    this.phase = 'ready';
    this.phaseT = 0;
    this.skullAt = SKULL_MIN + this.ctx.rng.next() * (SKULL_MAX - SKULL_MIN);
    for (const d of this.diggers) {
      d.state = 'out';
      d.gain = 0;
    }
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'ready') {
      if (this.phaseT >= READY_TIME) {
        this.phase = 'dig';
        this.phaseT = 0;
        this.ctx.sfx.go();
        for (const d of this.diggers) if (this.ctx.controls.get(d.seat)!.isDown()) d.state = 'digging';
      }
      return;
    }
    if (this.phase === 'dig') {
      for (const d of this.diggers) {
        const c = this.ctx.controls.get(d.seat)!;
        if (d.state === 'out' && this.phaseT < JOIN_LATE && c.isDown()) d.state = 'digging';
        else if (d.state === 'digging' && !c.isDown()) {
          d.state = 'banked';
          d.gain = this.pot;
          d.total += d.gain;
          this.ctx.sfx.coin();
        }
      }
      if (this.phaseT >= this.skullAt) {
        for (const d of this.diggers) if (d.state === 'digging') d.state = 'blown';
        this.ctx.sfx.hit();
        this.ctx.fx.shake(4, 0.3);
        this.toShow();
      } else if (this.phaseT > JOIN_LATE && this.diggers.every((d) => d.state !== 'digging')) {
        this.toShow();
      }
      return;
    }
    if (this.phaseT >= SHOW_TIME) {
      this.round++;
      if (this.round >= ROUNDS) this.done = true;
      else this.startRound();
    }
  }

  private toShow(): void {
    this.phase = 'show';
    this.phaseT = 0;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 가운데 구덩이와 불어나는 보물(또는 해골)
    r.disc(160, 92, 26, PAL.line);
    r.disc(160, 92, 24, PAL.yellowShadow);
    const blown = this.phase === 'show' && this.diggers.some((d) => d.state === 'blown');
    if (this.phase === 'dig') {
      const pot = String(this.pot);
      drawNumber(r, pot, 160, 86, DIGIT_SMALL, PAL.yellow, { align: 'center', shadow: PAL.line });
    } else if (this.phase === 'show') {
      r.ctx.drawImage(blown ? skullSprite() : chestSprite(), 152, 84);
    } else {
      r.text('꾹!', 160, 88, Math.floor(this.t * 6) % 2 === 0 ? PAL.text : PAL.yellow, 'center');
    }
    r.rect(140, 60, 40, 11, PAL.line);
    r.text(`${Math.min(this.round + 1, ROUNDS)}/${ROUNDS}`, 160, 61, PAL.text, 'center');
    for (const d of this.diggers) {
      const p = this.ctx.players.find((pl) => pl.seat === d.seat)!;
      const a = sideAnchor(p, this.ctx.humanCount);
      facing(r, p, a.x, a.y, () => {
        const pose = d.state === 'blown' ? 'lose' : d.state === 'banked' ? 'win' : d.state === 'digging' ? 'move' : 'idle';
        drawCharacter(r.ctx, p.seat, pose, this.t + p.seat * 0.3, a.x - CHAR_SIZE / 2, a.y - CHAR_SIZE / 2 - 4);
        if (d.state === 'banked') r.text(`+${d.gain}`, a.x, a.y - 30, PAL.yellow, 'center');
        if (d.state === 'blown') r.text('0', a.x, a.y - 30, PAL.red, 'center');
        if (d.state === 'digging') r.text('파는 중', a.x, a.y - 30, PAL.text, 'center');
      });
      const tag = localOffset(p, a, 26, -6);
      drawScoreTag(r, p, tag.x, tag.y, d.total);
    }
  }
}

let skull: HTMLCanvasElement | null = null;
let chest: HTMLCanvasElement | null = null;

function skullSprite(): HTMLCanvasElement {
  if (!skull) {
    const g = new Grid(16, 16);
    g.ellipse(8, 7, 6, 6, PAL.text, PAL.bgMid);
    g.rect(5, 11, 6, 4, PAL.text);
    g.rect(4, 6, 3, 3, PAL.line);
    g.rect(9, 6, 3, 3, PAL.line);
    g.rect(7, 12, 1, 3, PAL.line);
    g.outline(PAL.line);
    skull = g.toCanvas();
  }
  return skull;
}

function chestSprite(): HTMLCanvasElement {
  if (!chest) {
    const g = new Grid(16, 16);
    g.rect(1, 6, 14, 9, PAL.redShadow);
    g.rect(1, 3, 14, 4, PAL.red);
    g.rect(7, 6, 2, 3, PAL.yellow);
    g.rect(2, 1, 4, 2, PAL.yellow);
    g.rect(10, 1, 4, 2, PAL.yellow);
    g.outline(PAL.line);
    chest = g.toCanvas();
  }
  return chest;
}

/** 시작 때 누르고 있다가, 판마다 정한 욕심만큼 기다린 뒤 뗀다 */
class GreedAI implements AiController {
  private readonly hand: AiHand;
  private round = -1;
  private readonly greed: readonly [number, number];

  constructor(
    private readonly game: GreedDig,
    player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.greed = byDifficulty(player.difficulty, { easy: [0.8, 4.5], normal: [1.2, 3.4], hard: [1.4, 2.8] });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.round === this.round || g.phase !== 'ready') return;
    this.round = g.round;
    const rng = g.rng;
    const until = READY_TIME - g.phaseT;
    this.hand.pressIn(0, Math.max(0, until - 0.4));
    this.hand.releaseIn(0, until + this.greed[0] + rng.next() * (this.greed[1] - this.greed[0]));
  }
}

export const G31 = defineGame({
  code: 'G31',
  controls: 'one',
  create: () => new GreedDig(),
  createAI: (game, player, controls) => new GreedAI(game, player, controls),
});
