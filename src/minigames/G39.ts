import { stickOf, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { sensors } from '../core/sensors';
import { rankByScore } from '../core/ranking';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawRing, drawScoreTag, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G39 흔들지 마(차례제, 기울기): 자기 차례에 폰을 쟁반처럼 들고 가운데 구슬이 쟁반 밖으로 안 나가게 버틴다.
// 화면을 한 번 누르면 시작. 쟁반은 점점 작아지고 바람이 분다. 오래 버틴 순(최대 8초).
// 기울기를 못 쓰는 기기(또는 권한 거부)는 화면을 누른 채 끄는 방향으로 기울인다.

export const TURN_MAX = 8;
const TRAY_START = 50;
const TRAY_END = 16;
const ACCEL = 150;
const FRICTION = 0.6;
/** 누르지 않으면 이 시간 뒤 저절로 시작 */
const AUTO_START = 3;
const RESULT_TIME = 1;

export type TiltPhase = 'ready' | 'hold' | 'result';

export class SteadyTray implements MiniGame {
  readonly code = 'G39';
  t = 0;
  order: Seat[] = [];
  turn = 0;
  phase: TiltPhase = 'ready';
  phaseT = 0;
  ball = { x: 160, y: 90, vx: 0, vy: 0 };
  readonly times = new Map<Seat, number>();
  private wind = { x: 0, y: 0 };
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.order = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    sensors.requestMotion();
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

  trayR(): number {
    return this.phase === 'hold' ? TRAY_START + (TRAY_END - TRAY_START) * Math.min(1, this.phaseT / TURN_MAX) : TRAY_START;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.order.map((s) => [s, Math.floor(this.times.get(s) ?? 0)])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.order.map((seat) => ({ seat, score: Math.round((this.times.get(seat) ?? 0) * 10) })));
  }

  /** 지금 차례인 사람의 기울기(-1~1): 사람은 기울기 센서, 없으면 화면 끌기 */
  private tilt(): { x: number; y: number } {
    const p = this.ctx.players.find((pl) => pl.seat === this.current)!;
    if (!p.isAI && sensors.motion === 'on') return sensors.tilt;
    return stickOf(this.ctx.controls.get(this.current)!);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    const c = this.ctx.controls.get(this.current)!;
    if (this.phase === 'ready') {
      if (c.tapsThisTick.length > 0 || this.phaseT >= AUTO_START) {
        this.phase = 'hold';
        this.phaseT = 0;
        this.ball = { x: 160, y: 90, vx: 0, vy: 0 };
        this.wind = { x: 0, y: 0 };
        this.ctx.sfx.go();
      }
      return;
    }
    if (this.phase === 'hold') {
      const k = Math.min(1, this.phaseT / TURN_MAX);
      // 바람: 시간이 갈수록 세고 자주 바뀐다
      if (this.ctx.rng.next() < dt * (0.8 + k * 2)) {
        const a = this.ctx.rng.next() * Math.PI * 2;
        const s = 40 + 110 * k;
        this.wind = { x: Math.cos(a) * s, y: Math.sin(a) * s };
      }
      const tl = this.tilt();
      const b = this.ball;
      b.vx += (tl.x * ACCEL + this.wind.x) * dt;
      b.vy += (tl.y * ACCEL + this.wind.y) * dt;
      b.vx *= Math.exp(-FRICTION * dt);
      b.vy *= Math.exp(-FRICTION * dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const out = Math.hypot(b.x - 160, b.y - 90) > this.trayR();
      if (out || this.phaseT >= TURN_MAX) {
        this.times.set(this.current, Math.min(TURN_MAX, this.phaseT));
        if (out) this.ctx.sfx.lose();
        else this.ctx.sfx.coin();
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
    const tr = Math.round(this.trayR());
    r.disc(160, 90, tr + 3, PAL.line);
    r.disc(160, 90, tr + 1, col.shadow);
    r.disc(160, 90, tr - 1, PAL.bgMid);
    drawRing(r, 160, 90, 6, PAL.bgDark);
    if (this.phase !== 'ready') {
      r.disc(this.ball.x, this.ball.y, 5, PAL.line);
      r.disc(this.ball.x, this.ball.y, 4, PAL.text);
      r.rect(this.ball.x - 2, this.ball.y - 2, 2, 1, PAL.yellow);
    }
    if (this.phase === 'ready') {
      r.rect(118, 84, 84, 12, PAL.line);
      r.text('누르면 시작', 160, 86, col.base, 'center');
    } else if (this.phase === 'hold') {
      r.text(this.phaseT.toFixed(1), 160, 30, PAL.text, 'center');
    }
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      const ax = a.x < 160 ? Math.min(a.x, 70) : Math.max(a.x, 250);
      const t = this.times.get(p.seat);
      drawScoreTag(r, p, ax, a.y - 4, t === undefined ? (p.seat === this.current ? '차례' : '-') : `${t.toFixed(1)}초`);
    }
  }
}

/** 구슬이 가운데로 돌아오게 기운다(속도까지 보며). 난이도가 낮으면 늦게·덜 정확하게 */
class TrayAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private readonly interval: number;
  private readonly noise: number;
  private readonly gain: number;

  constructor(
    private readonly game: SteadyTray,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.2, hard: 0.12 });
    this.noise = byDifficulty(player.difficulty, { easy: 0.7, normal: 0.5, hard: 0.3 });
    this.gain = byDifficulty(player.difficulty, { easy: 0.6, normal: 0.8, hard: 1 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.current !== this.player.seat) return;
    if (g.phase === 'ready' && g.phaseT > 0.6 && !this.hand.busy) this.hand.tapAt(160, 150);
    if (g.phase !== 'hold') return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;
    const b = g.ball;
    const rng = g.rng;
    const fx = (-(b.x - 160) * 0.05 - b.vx * 0.04) * this.gain + jitter(rng, this.noise);
    const fy = (-(b.y - 90) * 0.05 - b.vy * 0.04) * this.gain + jitter(rng, this.noise);
    this.hand.stick(Math.max(-1, Math.min(1, fx)), Math.max(-1, Math.min(1, fy)));
  }
}

export const G39 = defineGame({
  code: 'G39',
  controls: 'pointer',
  pointer: 'turn',
  create: () => new SteadyTray(),
  createAI: (game, player, controls) => new TrayAI(game, player, controls),
});
