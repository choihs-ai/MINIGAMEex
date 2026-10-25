import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { sensors } from '../core/sensors';
import { rankByScore } from '../core/ranking';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawScoreTag, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G40 소리 크기 대결(차례제, 마이크): 자기 차례에 화면을 누르면 3초 동안 소리를 질러 게이지를 채운다. 가장 높이 찍은 순.
// 마이크를 못 쓰면(권한 거부·지원 안 함) 그 3초 동안 화면을 빠르게 연타한 만큼 게이지가 찬다.

export const SHOUT_TIME = 3;
const AUTO_START = 3;
const RESULT_TIME = 1;
/** 연타 대체: 최근 0.5초 동안 이만큼 치면 게이지 끝까지 */
const TAPS_FULL = 7;

export type ShoutPhase = 'ready' | 'shout' | 'result';

export class LoudVoice implements MiniGame {
  readonly code = 'G40';
  t = 0;
  order: Seat[] = [];
  turn = 0;
  phase: ShoutPhase = 'ready';
  phaseT = 0;
  level = 0;
  peak = 0;
  readonly best = new Map<Seat, number>();
  private tapTimes: number[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.order = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    sensors.requestMic();
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

  get current(): Seat {
    return this.order[this.turn];
  }

  activeSeat(): Seat | null {
    return this.done ? null : this.current;
  }

  /** 이 차례에 마이크를 쓰는가(사람이고 마이크가 켜졌을 때) */
  usingMic(): boolean {
    const p = this.ctx.players.find((pl) => pl.seat === this.current)!;
    return !p.isAI && sensors.mic === 'on';
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.order.map((s) => [s, Math.round((this.best.get(s) ?? 0) * 100)])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.order.map((seat) => ({ seat, score: Math.round((this.best.get(seat) ?? 0) * 1000) })));
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    const c = this.ctx.controls.get(this.current)!;
    if (this.phase === 'ready') {
      if (c.tapsThisTick.length > 0 || this.phaseT >= AUTO_START) {
        this.phase = 'shout';
        this.phaseT = 0;
        this.peak = 0;
        this.level = 0;
        this.tapTimes = [];
        this.ctx.sfx.go();
      }
      return;
    }
    if (this.phase === 'shout') {
      let level: number;
      if (this.usingMic()) level = sensors.sampleMic();
      else {
        for (let i = 0; i < c.tapsThisTick.length; i++) this.tapTimes.push(this.t);
        this.tapTimes = this.tapTimes.filter((x) => this.t - x < 0.5);
        level = Math.min(1, this.tapTimes.length / TAPS_FULL);
      }
      // 게이지는 부드럽게 따라간다
      this.level += (level - this.level) * Math.min(1, dt * 10);
      this.peak = Math.max(this.peak, this.level);
      if (this.phaseT >= SHOUT_TIME) {
        this.best.set(this.current, this.peak);
        this.ctx.sfx.coin();
        this.phase = 'result';
        this.phaseT = 0;
      }
      return;
    }
    if (this.phaseT >= RESULT_TIME) {
      this.turn++;
      if (this.turn >= this.order.length) this.done = true;
      else {
        this.phase = 'ready';
        this.phaseT = 0;
      }
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const col = SEAT_COLORS[this.current];
    // 세로 게이지
    const gx = 148;
    const gy = 30;
    const gh = 120;
    r.rect(gx - 2, gy - 2, 28, gh + 4, PAL.line);
    r.rect(gx, gy, 24, gh, PAL.bgMid);
    const fill = Math.round(gh * this.level);
    r.rect(gx, gy + gh - fill, 24, fill, this.level > 0.85 ? PAL.red : col.base);
    const peakY = gy + gh - Math.round(gh * this.peak);
    if (this.phase !== 'ready') r.rect(gx - 4, peakY, 32, 1, PAL.yellow);
    if (this.phase === 'ready') {
      r.rect(112, 84, 96, 12, PAL.line);
      r.text('누르고 소리 질러!', 160, 86, col.base, 'center');
    } else if (this.phase === 'shout') {
      r.text(this.usingMic() ? '으아아!' : '연타!', 160, 16, PAL.yellow, 'center');
    }
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      const ax = a.x < 160 ? Math.min(a.x, 80) : Math.max(a.x, 240);
      const b = this.best.get(p.seat);
      drawScoreTag(r, p, ax, a.y - 4, b === undefined ? (p.seat === this.current ? '차례' : '-') : Math.round(b * 100));
    }
  }
}

/** 차례가 오면 누르고, 난이도만큼 빠르게 연타한다(마이크 대신) */
class VoiceAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private pace = 8;
  private readonly rate: readonly [number, number];

  constructor(
    private readonly game: LoudVoice,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.rate = byDifficulty(player.difficulty, { easy: [6, 9], normal: [8, 12], hard: [10, 14] });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.current !== this.player.seat) return;
    if (g.phase === 'ready') {
      if (g.phaseT > 0.5 && !this.hand.busy) this.hand.tapAt(160, 150);
      return;
    }
    if (g.phase !== 'shout') return;
    this.wait -= dt;
    if (this.wait > 0) return;
    // 차례마다 힘이 조금씩 다르다
    const [lo, hi] = this.rate;
    if (g.phaseT < 0.05) this.pace = lo + g.rng.next() * (hi - lo);
    this.wait = 1 / (this.pace * (0.8 + g.rng.next() * 0.4));
    this.hand.tapAt(150 + g.rng.next() * 20, 140 + g.rng.next() * 20);
  }
}

export const G40 = defineGame({
  code: 'G40',
  controls: 'pointer',
  pointer: 'turn',
  create: () => new LoudVoice(),
  createAI: (game, player, controls) => new VoiceAI(game, player, controls),
});
