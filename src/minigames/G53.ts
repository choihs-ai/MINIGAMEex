import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawLaneDividers, drawLine, drawMarker, drawTimer, makeLanes, TIMER_X, TIMER_Y, type Lane } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G53 낚시 대결: 찌가 쑥 들어가는 순간 눌러 낚아챈다. 큰 고기는 걸린 뒤 연타로 끌어올린다.
// 입질 전에 누르면 고기가 놀라 도망가 1.3초 손해. 잡은 무게 합 순.

export const DURATION = 30;
export const BITE = 0.5;
export const REEL_TIME = 2.4;
const WAIT_MIN = 1.0;
const WAIT_MAX = 3.8;
/** 입질 전에 잘못 누르면 이만큼 손해(고기가 놀라 다시 기다림) */
const SCARE = 1.3;
const SHOW = 0.7;
const WATER_Y = 100;
const SMALL_CHANCE = 0.62;
/** 입질 전에 찌가 살짝 건드려지는(속임) 확률과 길이. 이때 누르면 고기가 놀라 도망간다. */
const NIBBLE_CHANCE = 0.55;
export const NIBBLE_TIME = 0.3;

export type AnglerState = 'wait' | 'bite' | 'reel' | 'catch' | 'escape' | 'scared';

export interface Fish {
  weight: number;
  big: boolean;
}

export interface Angler {
  seat: Seat;
  lane: Lane;
  state: AnglerState;
  timer: number;
  fish: Fish | null;
  taps: number;
  total: number;
  /** 기다리는 동안 속임 입질이 시작되는 남은 시간(없으면 null) */
  nibble: number | null;
}

/** 큰 고기를 끌어올리는 데 필요한 연타 수 */
export function tapsNeeded(f: Fish): number {
  return 6 + f.weight;
}

export class FishingDuel implements MiniGame {
  readonly code = 'G53';
  anglers: Angler[] = [];
  t = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.anglers = makeLanes(ctx.players).map((lane) => ({
      seat: lane.seat,
      lane,
      state: 'wait',
      timer: 0,
      fish: null,
      nibble: null,
      taps: 0,
      total: 0,
    }));
    for (const a of this.anglers) this.toWait(a);
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

  /** 다시 기다리기: 입질까지 시간과 속임 입질 시점을 정한다 */
  private toWait(a: Angler): void {
    const rng = this.ctx.rng;
    a.state = 'wait';
    a.timer = WAIT_MIN + rng.next() * (WAIT_MAX - WAIT_MIN);
    a.nibble = a.timer > 1 && rng.next() < NIBBLE_CHANCE ? a.timer * (0.35 + rng.next() * 0.35) : null;
  }

  /** 지금 속임 입질 중인가 */
  nibbling(a: Angler): boolean {
    return a.state === 'wait' && a.nibble !== null && a.timer <= a.nibble && a.timer > a.nibble - NIBBLE_TIME;
  }

  private rollFish(): Fish {
    const rng = this.ctx.rng;
    if (rng.next() < SMALL_CHANCE) return { weight: 1 + Math.floor(rng.next() * 3), big: false };
    return { weight: 4 + Math.floor(rng.next() * 6), big: true };
  }

  canPress(seat: Seat): boolean {
    const a = this.anglers.find((x) => x.seat === seat);
    return !this.done && (a?.state === 'bite' || a?.state === 'reel');
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.anglers.map((a) => [a.seat, a.total])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.anglers.map((a) => ({ seat: a.seat, score: a.total })));
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const a of this.anglers) {
      const pressed = this.ctx.controls.get(a.seat)!.justPressed();
      a.timer -= dt;
      switch (a.state) {
        case 'wait':
          if (a.nibble !== null && a.timer <= a.nibble && a.timer + dt > a.nibble) this.ctx.sfx.tap();
          if (pressed) {
            a.state = 'scared';
            a.timer = SCARE;
            this.ctx.sfx.splash();
          } else if (a.timer <= 0) {
            a.state = 'bite';
            a.timer = BITE;
            a.fish = this.rollFish();
            this.ctx.sfx.splash();
          }
          break;
        case 'bite':
          if (pressed) this.hook(a);
          else if (a.timer <= 0) this.escape(a);
          break;
        case 'reel':
          if (pressed) {
            a.taps++;
            this.ctx.sfx.tap();
            if (a.taps >= tapsNeeded(a.fish!)) this.land(a);
          }
          if (a.state === 'reel' && a.timer <= 0) this.escape(a);
          break;
        default:
          if (a.timer <= 0) this.toWait(a);
      }
    }
    if (this.t >= DURATION) this.done = true;
  }

  private hook(a: Angler): void {
    if (!a.fish!.big) {
      this.land(a);
      return;
    }
    a.state = 'reel';
    a.timer = REEL_TIME;
    a.taps = 0;
    this.ctx.sfx.signal();
  }

  private land(a: Angler): void {
    a.total += a.fish!.weight;
    a.state = 'catch';
    a.timer = SHOW;
    this.ctx.sfx.catchStar();
    const p = this.ctx.players.find((pl) => pl.seat === a.seat);
    if (p) this.ctx.fx.burst(a.lane.cx, WATER_Y - 10, p.color.base, a.fish!.big ? 10 : 5);
  }

  private escape(a: Angler): void {
    a.state = 'escape';
    a.timer = SHOW;
    this.ctx.sfx.buzz();
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(56, WATER_Y, 208, 180 - WATER_Y, PAL.bgMid);
    // 물결(프레임 단위로 옆으로 흐름)
    const shift = Math.floor(this.t * 6) % 6;
    for (let x = 56 + shift; x < 262; x += 6) r.rect(x, WATER_Y, 3, 1, PAL.text);
    drawLaneDividers(r, this.anglers.map((a) => a.lane));
    for (const a of this.anglers) this.drawAngler(r, a);
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }

  private drawAngler(r: Renderer, a: Angler): void {
    const p = this.ctx.players.find((pl) => pl.seat === a.seat)!;
    const { base, shadow } = p.color;
    const cx = Math.round(a.lane.cx);
    // 낚싯대(위에서 내려온다)와 줄
    drawLine(r, a.lane.x + 3, 22, cx, 30, PAL.yellowShadow);
    drawLine(r, a.lane.x + 3, 23, cx, 31, PAL.yellowShadow);
    const step = Math.floor(this.t * 10);
    let floatY = WATER_Y - 3 + (step % 4 < 2 ? 0 : 1);
    let floatX = cx;
    if (a.state === 'bite') {
      floatY += 3;
      floatX += step % 2 === 0 ? -1 : 1;
    } else if (this.nibbling(a)) {
      // 속임 입질: 살짝만 꼼지락
      floatY += step % 2 === 0 ? 2 : 1;
    } else if (a.state === 'reel') {
      floatY += 4;
      floatX += (step % 3) - 1;
    }
    drawLine(r, cx, 31, floatX, floatY, PAL.text);
    r.rect(floatX - 2, floatY - 1, 5, 6, PAL.line);
    r.rect(floatX - 1, floatY, 3, 2, base);
    r.rect(floatX - 1, floatY + 2, 3, 2, PAL.text);
    drawMarker(r, cx, 18, base);

    // 물속 고기 그림자: 입질이 가까워지면 다가온다
    if (a.state === 'wait' && a.timer < 1.2) {
      const dx = Math.round(a.timer * 12) * (a.seat % 2 === 0 ? 1 : -1);
      this.fishShadow(r, cx + dx, WATER_Y + 14, 3);
    } else if (a.state === 'bite' || a.state === 'reel') {
      this.fishShadow(r, floatX, WATER_Y + 8, a.fish?.big ? 6 : 3);
    }
    if (a.state === 'scared') r.text('!', cx + 6, WATER_Y - 14, PAL.red);
    if (a.state === 'escape') r.text('놓침', cx, WATER_Y - 18, PAL.text, 'center');
    if (a.state === 'catch' && a.fish) {
      // 잡힌 고기가 물 위로
      const fy = WATER_Y - 12 - Math.round((1 - a.timer / SHOW) * 10);
      r.rect(cx - 5, fy - 1, 11, 5, PAL.line);
      r.rect(cx - 4, fy, 8, 3, PAL.text);
      r.rect(cx + 4, fy - 1, 2, 5, PAL.text);
      r.text(`+${a.fish.weight}`, cx, fy - 11, PAL.yellow, 'center');
    }
    if (a.state === 'reel' && a.fish) {
      const need = tapsNeeded(a.fish);
      const w = a.lane.w - 12;
      const x = a.lane.x + 6;
      r.rect(x - 1, 150, w + 2, 6, PAL.line);
      r.rect(x, 151, Math.round((w * a.taps) / need), 4, base);
      r.rect(x, 151 + 3, Math.round((w * a.taps) / need), 1, shadow);
      r.text('연타!', a.lane.cx, 138, PAL.yellow, 'center');
    }
    r.text(String(a.total), cx, 4, base, 'center');
  }

  private fishShadow(r: Renderer, x: number, y: number, size: number): void {
    r.rect(x - size, y - 1, size * 2, 3, PAL.line);
    r.rect(x + size, y - 2, 2, 5, PAL.line);
  }
}

/** 입질을 보면 반응 시간 뒤에 낚아채고, 큰 고기는 난이도별 속도로 연타한다. */
class FishingAI implements AiController {
  private readonly hand: AiHand;
  private lastState: AnglerState = 'wait';
  private nextTap = 0;
  private readonly reaction: number;
  private readonly rate: number;
  private readonly fooled: number;
  private sawNibble = false;

  constructor(
    private readonly game: FishingDuel,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.reaction = byDifficulty(player.difficulty, { easy: 0.45, normal: 0.3, hard: 0.2 });
    this.rate = byDifficulty(player.difficulty, { easy: 4, normal: 5.5, hard: 7 });
    this.fooled = byDifficulty(player.difficulty, { easy: 0.35, normal: 0.18, hard: 0.07 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    if (this.game.finished) return;
    const a = this.game.anglers.find((x) => x.seat === this.player.seat)!;
    const rng = this.game.rng;
    if (this.game.nibbling(a) && !this.sawNibble) {
      // 속임 입질에 속아 성급하게 낚아챈다
      this.sawNibble = true;
      if (rng.next() < this.fooled) this.hand.tap(0, this.reaction);
    }
    if (a.state !== this.lastState) {
      this.lastState = a.state;
      if (a.state === 'wait') this.sawNibble = false;
      if (a.state === 'bite') this.hand.tap(0, Math.max(0.05, this.reaction + jitter(rng, this.reaction * 0.25)));
      if (a.state === 'reel') this.nextTap = 0.15;
    }
    if (a.state === 'reel') {
      this.nextTap -= dt;
      if (this.nextTap <= 0) {
        this.hand.tap(0, 0, 0.03);
        this.nextTap = 1 / this.rate + jitter(rng, 0.03);
      }
    }
  }
}

export const G53 = defineGame({
  code: 'G53',
  controls: 'one',
  create: () => new FishingDuel(),
  createAI: (game, player, controls) => new FishingAI(game, player, controls),
});
