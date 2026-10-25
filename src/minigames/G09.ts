import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL, type Color } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawCharacter, CHAR_SIZE } from '../ui/characters';
import { AiHand, byDifficulty } from './ai';
import { anchorOf, drawScoreTag, localOffset, facing } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G09 눈치 탭: 가운데 신호등이 초록불이 되는 순간 가장 먼저 누르면 +1.
// 빨간불·노란불(페이크)에 누르면 -1이고 그 라운드는 더 못 누른다. 7라운드.

export const ROUNDS = 7;
const RED_MIN = 0.8;
const RED_MAX = 3.0;
/** 노란불 페이크가 끼어들 확률과 길이 */
const FAKE_CHANCE = 0.7;
const FAKE_TIME = 0.3;
/** 초록불 뒤 아무도 안 누르면 이 시간 뒤 라운드 종료 */
export const GREEN_TIMEOUT = 1.0;
const REVEAL_TIME = 0.9;

export type Light = 'red' | 'yellow' | 'green' | 'off';

export class SignalTap implements MiniGame {
  readonly code = 'G09';
  round = 0;
  light: Light = 'red';
  /** 지금 불이 켜진 뒤 지난 시간 */
  lightT = 0;
  readonly scores = new Map<Seat, number>();
  /** 이번 라운드에 잘못 눌러 쉬는 사람 */
  readonly fouled = new Set<Seat>();
  roundWinners: Seat[] = [];
  /** 이번 라운드 남은 계획: [불, 길이] (마지막 초록은 길이 무관) */
  private plan: Array<[Light, number]> = [];
  private ctx!: GameContext;
  private done = false;
  private t = 0;
  private flash = new Map<Seat, { t: number; delta: number }>();

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) this.scores.set(p.seat, 0);
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

  canPress(seat: Seat): boolean {
    return this.light === 'green' && !this.fouled.has(seat) && !this.done;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.scores) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.scores].map(([seat, score]) => ({ seat, score })));
  }

  private startRound(): void {
    const rng = this.ctx.rng;
    const red = RED_MIN + rng.next() * (RED_MAX - RED_MIN);
    this.plan = [];
    if (rng.next() < FAKE_CHANCE) {
      // 빨강 → 노랑(속임) → 빨강 → 초록. 가끔 속임이 두 번
      const first = red * (0.35 + rng.next() * 0.3);
      this.plan.push(['red', first], ['yellow', FAKE_TIME], ['red', 0.3 + rng.next() * 0.7]);
      if (rng.next() < 0.35) this.plan.push(['yellow', FAKE_TIME], ['red', 0.3 + rng.next() * 0.6]);
    } else {
      this.plan.push(['red', red]);
    }
    this.plan.push(['green', GREEN_TIMEOUT]);
    this.fouled.clear();
    this.roundWinners = [];
    this.setLight(this.plan[0][0]);
  }

  private setLight(light: Light): void {
    this.light = light;
    this.lightT = 0;
    if (light === 'green') this.ctx.sfx.signal();
    else if (light === 'yellow') this.ctx.sfx.beep();
  }

  private add(seat: Seat, delta: number): void {
    this.scores.set(seat, (this.scores.get(seat) ?? 0) + delta);
    this.flash.set(seat, { t: this.t, delta });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.lightT += dt;

    const winners: Seat[] = [];
    for (const p of this.ctx.players) {
      if (!this.ctx.controls.get(p.seat)!.justPressed() || this.fouled.has(p.seat)) continue;
      if (this.light === 'red' || this.light === 'yellow') {
        this.fouled.add(p.seat);
        this.add(p.seat, -1);
        this.ctx.sfx.buzz();
        this.ctx.fx.shake(2, 0.1);
      } else if (this.light === 'green') {
        winners.push(p.seat);
      }
    }
    if (winners.length > 0) {
      // 같은 틱에 누른 사람은 함께 +1
      this.roundWinners = winners;
      for (const s of winners) this.add(s, 1);
      this.ctx.sfx.coin();
      this.setLight('off');
      return;
    }

    if (this.light === 'off') {
      if (this.lightT >= REVEAL_TIME) {
        this.round++;
        if (this.round >= ROUNDS) this.done = true;
        else this.startRound();
      }
      return;
    }
    const step = this.plan[0];
    if (this.lightT >= step[1]) {
      this.plan.shift();
      const next = this.plan[0];
      if (next) this.setLight(next[0]);
      else this.setLight('off');
    }
    // 모두 잘못 눌렀으면 초록불을 기다릴 필요가 없다
    if (this.light === 'green' && this.ctx.players.every((p) => this.fouled.has(p.seat))) this.setLight('off');
  }

  render(r: Renderer): void {
    r.clear(this.light === 'green' ? PAL.bgMid : PAL.bgDark);
    drawTrafficLight(r, 160, 90, this.light, this.t);
    for (const p of this.ctx.players) {
      const a = anchorOf(p, this.ctx.humanCount);
      const winner = this.roundWinners.includes(p.seat);
      const pose = this.fouled.has(p.seat) ? 'lose' : winner ? 'win' : 'idle';
      facing(r, p, a.x, a.y, () => {
        drawCharacter(r.ctx, p.seat, pose, this.t + p.seat * 0.3, a.x - CHAR_SIZE / 2, a.y - CHAR_SIZE / 2 - 4);
        const f = this.flash.get(p.seat);
        if (f && this.t - f.t < 0.8) {
          const text = f.delta > 0 ? `+${f.delta}` : String(f.delta);
          r.text(text, a.x + 16, a.y - 20, f.delta > 0 ? PAL.yellow : PAL.red);
        }
      });
      const tag = localOffset(p, a, 24, -6);
      drawScoreTag(r, p, tag.x, tag.y, this.scores.get(p.seat) ?? 0);
    }
    r.rect(146, 0, 28, 11, PAL.line);
    r.text(`${Math.min(this.round + 1, ROUNDS)}/${ROUNDS}`, 160, 1, PAL.text, 'center');
  }
}

/** 세로 신호등(빨강·노랑·초록). 켜진 불만 밝게. */
function drawTrafficLight(r: Renderer, cx: number, cy: number, light: Light, t: number): void {
  const w = 22;
  const h = 62;
  const x = cx - w / 2;
  const y = cy - h / 2;
  r.rect(cx - 2, y + h, 4, 12, PAL.bgMid);
  r.rect(x - 1, y - 1, w + 2, h + 2, PAL.line);
  r.rect(x, y, w, h, PAL.bgMid);
  const lamps: Array<[Light, Color, Color]> = [
    ['red', PAL.red, PAL.redShadow],
    ['yellow', PAL.yellow, PAL.yellowShadow],
    ['green', PAL.green, PAL.greenShadow],
  ];
  lamps.forEach(([name, on, off], i) => {
    const ly = y + 11 + i * 20;
    r.disc(cx, ly, 8, PAL.line);
    const lit = light === name;
    r.disc(cx, ly, 7, lit ? on : off);
    if (lit) {
      r.rect(cx - 4, ly - 4, 3, 1, PAL.text);
      r.rect(cx - 4, ly - 3, 1, 2, PAL.text);
    } else {
      r.disc(cx, ly, 5, PAL.line);
      r.disc(cx, ly, 4, off);
    }
  });
  // 초록불은 테두리가 번쩍인다(어느 방향에서 봐도 바로 보이게)
  if (light === 'green' && Math.floor(t * 8) % 2 === 0) r.frame(x - 4, y - 4, w + 8, h + 8, PAL.green);
}

/** 초록불을 보면 반응 시간 뒤에 누른다. 낮은 확률로 노란불에 속는다. */
class SignalTapAI implements AiController {
  private readonly hand: AiHand;
  private seen: Light | null = null;
  private round = -1;
  private readonly reaction: readonly [number, number];
  private readonly fooled: number;

  constructor(
    private readonly game: SignalTap,
    player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.reaction = byDifficulty(player.difficulty, { easy: [0.36, 0.56], normal: [0.25, 0.45], hard: [0.2, 0.3] });
    this.fooled = byDifficulty(player.difficulty, { easy: 0.18, normal: 0.08, hard: 0.03 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    if (this.game.finished) return;
    const g = this.game;
    if (g.round !== this.round) {
      this.round = g.round;
      this.hand.reset();
    }
    if (g.light === this.seen) return;
    this.seen = g.light;
    const [lo, hi] = this.reaction;
    const rt = lo + g.rng.next() * (hi - lo);
    if (g.light === 'green') this.hand.tap(0, rt);
    else if (g.light === 'yellow' && g.rng.next() < this.fooled) this.hand.tap(0, rt);
    else if (g.light === 'off') this.hand.reset();
  }
}

export const G09 = defineGame({
  code: 'G09',
  controls: 'one',
  create: () => new SignalTap(),
  createAI: (game, player, controls) => new SignalTapAI(game, player, controls),
});
