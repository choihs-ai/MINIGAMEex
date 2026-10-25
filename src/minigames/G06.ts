import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { QUIZ, type QuizItem } from '../data/quiz';
import { Grid } from '../render/grid';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { glyphIcon } from '../ui/padIcons';
import { AiHand, byDifficulty } from './ai';
import { facing, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G06 폭탄 돌리기 퀴즈(차례제): 폭탄을 든 사람만 문제를 푼다(버튼 1·2·3). 맞히면 폭탄이 다음 사람에게 넘어간다.
// 폭탄 시간은 숨겨져 있고, 터질 때 들고 있던 사람이 탈락. 마지막까지 남은 사람이 1위(탈락 역순).

/** 안전장치: 이 시간이 지나면 남은 사람끼리 공동 1위 */
export const DURATION = 45;
const FUSE_MIN = 5;
const FUSE_MAX = 9;
/** 틀리면 잠깐 못 누르고 새 문제 */
export const WRONG_PAUSE = 0.6;
const BOOM_PAUSE = 1.3;

export type BombPhase = 'quiz' | 'boom';

export class BombQuiz implements MiniGame {
  readonly code = 'G06';
  t = 0;
  order: Seat[] = [];
  readonly outAt = new Map<Seat, number>();
  holder: Seat = 0;
  phase: BombPhase = 'quiz';
  phaseT = 0;
  /** 폭탄이 터지기까지 남은 시간(숨김) */
  fuse = 0;
  item: QuizItem = QUIZ[0];
  /** 문제 번호(새 문제마다 1씩) */
  asked = 0;
  pauseLeft = 0;
  private ctx!: GameContext;
  private done = false;
  private deck: number[] = [];

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.order = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    this.holder = this.order[Math.floor(ctx.rng.next() * this.order.length)];
    this.newBomb();
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

  alive(seat: Seat): boolean {
    return !this.outAt.has(seat);
  }

  canPress(seat: Seat): boolean {
    return !this.done && this.phase === 'quiz' && seat === this.holder && this.pauseLeft <= 0;
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.order.map((seat) => ({ seat, outAt: this.outAt.get(seat) ?? null })));
  }

  private newBomb(): void {
    this.fuse = FUSE_MIN + this.ctx.rng.next() * (FUSE_MAX - FUSE_MIN);
    this.phase = 'quiz';
    this.phaseT = 0;
    this.newQuestion();
  }

  private newQuestion(): void {
    if (this.deck.length === 0) {
      this.deck = [...QUIZ.keys()];
      for (let i = this.deck.length - 1; i > 0; i--) {
        const j = Math.floor(this.ctx.rng.next() * (i + 1));
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
      }
    }
    this.item = QUIZ[this.deck.pop()!];
    this.asked++;
  }

  private nextHolder(): Seat {
    const i = this.order.indexOf(this.holder);
    for (let k = 1; k <= this.order.length; k++) {
      const s = this.order[(i + k) % this.order.length];
      if (this.alive(s)) return s;
    }
    return this.holder;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'boom') {
      if (this.phaseT >= BOOM_PAUSE) {
        this.holder = this.nextHolder();
        this.newBomb();
      }
      return;
    }
    this.fuse -= dt;
    this.pauseLeft = Math.max(0, this.pauseLeft - dt);
    const c = this.ctx.controls.get(this.holder)!;
    if (this.pauseLeft <= 0) {
      for (let b = 0; b < 3; b++) {
        if (!c.justPressed(b)) continue;
        if (b === this.item.answer) {
          this.ctx.sfx.coin();
          this.holder = this.nextHolder();
          this.newQuestion();
        } else {
          this.ctx.sfx.buzz();
          this.pauseLeft = WRONG_PAUSE;
          this.newQuestion();
        }
        break;
      }
    }
    if (this.fuse <= 0) {
      this.outAt.set(this.holder, this.t);
      this.phase = 'boom';
      this.phaseT = 0;
      this.ctx.sfx.hit();
      this.ctx.sfx.lose();
      this.ctx.fx.shake(5, 0.35);
      const a = sideAnchor(this.ctx.players.find((p) => p.seat === this.holder)!, this.ctx.humanCount);
      this.ctx.fx.burst(a.x, a.y, PAL.yellow, 16);
      if (this.order.filter((s) => this.alive(s)).length <= 1) this.done = true;
    }
    if (this.t >= DURATION) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      const out = !this.alive(p.seat);
      const holding = p.seat === this.holder && this.phase === 'quiz';
      facing(r, p, a.x, a.y, () => {
        drawCharacter(r.ctx, p.seat, out ? 'lose' : holding ? 'move' : 'idle', this.t + p.seat * 0.3, a.x - CHAR_SIZE / 2, a.y - CHAR_SIZE / 2 - 4);
        if (holding) {
          // 남은 시간은 안 보이지만 심지가 짧아지고 흔들림이 커진다(대충만 알 수 있게)
          const shake = this.fuse < 2 ? Math.round(Math.sin(this.t * 40)) : 0;
          r.ctx.drawImage(bombSprite(), a.x + 10 + shake, a.y - 8);
        }
      });
    }
    if (this.phase === 'boom') {
      r.rect(120, 82, 80, 14, PAL.line);
      r.text('펑!', 160, 85, PAL.red, 'center');
      return;
    }
    // 문제는 폭탄 든 사람 쪽에서 바로 읽히게
    const holderInfo = this.ctx.players.find((p) => p.seat === this.holder)!;
    facing(r, holderInfo, 160, 90, () => {
      const x = 76;
      const y = 66;
      r.rect(x, y, 168, 48, PAL.line);
      r.frame(x, y, 168, 48, holderInfo.color.base);
      r.text(this.item.q, 160, y + 6, PAL.text, 'center');
      this.item.choices.forEach((ch, i) => {
        const cx = x + 28 + i * 56;
        r.text(String(i + 1), cx - 22, y + 28, PAL.yellow);
        r.text(ch, cx + 4, y + 28, this.pauseLeft > 0 ? PAL.bgMid : PAL.text, 'center');
      });
    });
  }
}

let bombCache: HTMLCanvasElement | null = null;

function bombSprite(): HTMLCanvasElement {
  if (!bombCache) {
    const g = new Grid(13, 15);
    g.ellipse(6.5, 9, 5.5, 5.5, PAL.bgMid, PAL.line);
    g.rect(5, 2, 3, 2, PAL.bgMid);
    g.line(7, 1, 9, 0, PAL.yellowShadow);
    g.set(10, 0, PAL.red);
    g.rect(3, 6, 2, 2, PAL.text);
    g.outline(PAL.line);
    bombCache = g.toCanvas();
  }
  return bombCache;
}

/** 자기 차례면 읽는 시간 뒤에 난이도만큼의 확률로 정답을 누른다 */
class BombQuizAI implements AiController {
  private readonly hand: AiHand;
  private asked = -1;
  private readonly read: readonly [number, number];
  private readonly accuracy: number;

  constructor(
    private readonly game: BombQuiz,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.read = byDifficulty(player.difficulty, { easy: [1.4, 2.4], normal: [1.0, 1.8], hard: [0.7, 1.2] });
    this.accuracy = byDifficulty(player.difficulty, { easy: 0.6, normal: 0.75, hard: 0.9 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.holder !== this.player.seat || g.phase !== 'quiz') {
      if (this.hand.busy) this.hand.reset();
      this.asked = -1;
      return;
    }
    if (g.asked === this.asked) return;
    this.asked = g.asked;
    const rng = g.rng;
    const right = g.item.answer;
    const pick = rng.next() < this.accuracy ? right : (right + 1 + Math.floor(rng.next() * 2)) % 3;
    this.hand.tap(pick, g.pauseLeft + this.read[0] + rng.next() * (this.read[1] - this.read[0]));
  }
}

export const G06 = defineGame({
  code: 'G06',
  controls: 'three',
  padStyle: (_seat, index) => ({ icon: glyphIcon(String(index + 1)) }),
  create: () => new BombQuiz(),
  createAI: (game, player, controls) => new BombQuizAI(game, player, controls),
});
