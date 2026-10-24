import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { createCanvas, get2d } from '../render/canvas';
import { Grid } from '../render/grid';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawMarker } from './common';
import { homeDir } from './players';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G19 칼 뽑기 결투: 신호가 뜨는 순간 먼저 탭. 신호 전에 누르면 그 라운드 실격(자멸).
// 3라운드, 라운드마다 가장 빠른 1명 1점(같은 틱이면 공동). 동점은 평균 반응 시간이 빠른 쪽.

export const ROUNDS = 3;
const WAIT_MIN = 1.6;
const WAIT_MAX = 3.8;
/** 신호 뒤 아무도 안 누르면 이 시간 뒤 라운드 종료 */
export const SIGNAL_TIMEOUT = 2;
/** 승자 결정 후 다른 사람 반응을 기록하며 결과를 보여주는 시간 */
const REVEAL_TIME = 1.4;
/** 반응하지 못했거나 실격한 라운드의 반응 시간(평균 계산용) */
const PENALTY_TIME = SIGNAL_TIMEOUT;

export type Phase = 'wait' | 'signal' | 'reveal';
type Pose = 'ready' | 'slash' | 'down';

export class QuickDraw implements MiniGame {
  readonly code = 'G19';
  round = 0;
  phase: Phase = 'wait';
  /** 현재 단계가 시작된 뒤 지난 시간 */
  phaseT = 0;
  /** 신호가 뜬 뒤 지난 시간(신호 전에는 null) */
  sinceSignal: number | null = null;
  waitTime = 0;
  readonly wins = new Map<Seat, number>();
  /** 라운드별 반응 시간 */
  readonly reactions = new Map<Seat, number[]>();
  readonly fouled = new Set<Seat>();
  /** 1라운드(연습)에서 너무 빨리 누른 사람: 실격 대신 경고만 */
  readonly warned = new Map<Seat, number>();
  roundWinners: Seat[] = [];
  private readonly reacted = new Set<Seat>();
  private ctx!: GameContext;
  private done = false;
  private t = 0;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) {
      this.wins.set(p.seat, 0);
      this.reactions.set(p.seat, []);
    }
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
    return this.phase === 'signal' && !this.fouled.has(seat) && !this.done;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.wins) as Partial<Record<Seat, number>>;
  }

  averageReaction(seat: Seat): number {
    const list = this.reactions.get(seat) ?? [];
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : PENALTY_TIME;
  }

  getRanking(): Seat[][] {
    const seats = this.ctx.players.map((p) => p.seat);
    const key = (s: Seat) => [-(this.wins.get(s) ?? 0), this.averageReaction(s)] as const;
    seats.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1] || a - b);
    const groups: Seat[][] = [];
    for (const s of seats) {
      const prev = groups[groups.length - 1]?.[0];
      const same = prev !== undefined && key(prev)[0] === key(s)[0] && Math.abs(key(prev)[1] - key(s)[1]) < 1e-9;
      if (same) groups[groups.length - 1].push(s);
      else groups.push([s]);
    }
    return groups;
  }

  private startRound(): void {
    this.phase = 'wait';
    this.phaseT = 0;
    this.sinceSignal = null;
    this.waitTime = WAIT_MIN + this.ctx.rng.next() * (WAIT_MAX - WAIT_MIN);
    this.fouled.clear();
    this.warned.clear();
    this.reacted.clear();
    this.roundWinners = [];
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.sinceSignal !== null) this.sinceSignal += dt;

    const winnersThisTick: Seat[] = [];
    for (const p of this.ctx.players) {
      if (!this.ctx.controls.get(p.seat)!.justPressed()) continue;
      if (this.phase === 'wait') this.early(p);
      else if (!this.fouled.has(p.seat) && !this.reacted.has(p.seat)) {
        this.reacted.add(p.seat);
        this.reactions.get(p.seat)!.push(this.sinceSignal!);
        if (this.phase === 'signal') winnersThisTick.push(p.seat);
        else this.ctx.sfx.click();
      }
    }

    if (winnersThisTick.length > 0) {
      // 같은 틱(1/60초 안)에 누른 사람들은 공동 승리
      this.roundWinners = winnersThisTick;
      for (const s of winnersThisTick) this.wins.set(s, (this.wins.get(s) ?? 0) + 1);
      this.ctx.sfx.slash();
      this.ctx.fx.shake(3, 0.15);
      this.phase = 'reveal';
      this.phaseT = 0;
    }

    if (this.phase === 'wait' && this.phaseT >= this.waitTime) {
      this.phase = 'signal';
      this.phaseT = 0;
      this.sinceSignal = 0;
      this.ctx.sfx.signal();
      if (this.ctx.players.every((p) => this.fouled.has(p.seat))) this.phase = 'reveal';
    } else if (this.phase === 'signal' && this.phaseT >= SIGNAL_TIMEOUT) {
      this.phase = 'reveal';
      this.phaseT = 0;
    } else if (this.phase === 'reveal' && this.phaseT >= REVEAL_TIME) {
      this.endRound();
    }
  }

  private early(p: PlayerInfo): void {
    if (this.round === 0) {
      // 1라운드는 연습: 경고만 하고 계속 참가
      this.warned.set(p.seat, this.t);
      this.ctx.sfx.buzz();
      return;
    }
    if (this.fouled.has(p.seat)) return;
    this.fouled.add(p.seat);
    this.ctx.sfx.buzz();
    this.ctx.fx.shake(2, 0.1);
  }

  private endRound(): void {
    // 이번 라운드에 반응하지 못한(또는 실격한) 사람은 벌점 시간으로 기록
    for (const p of this.ctx.players) {
      if (!this.reacted.has(p.seat)) this.reactions.get(p.seat)!.push(PENALTY_TIME);
    }
    this.round++;
    if (this.round >= ROUNDS) this.done = true;
    else this.startRound();
  }

  /** 자리별 말 위치(화면 좌표, 발 기준 가운데) */
  private fighterPos(p: PlayerInfo): { x: number; y: number } {
    const d = homeDir(p, this.ctx.humanCount);
    // 모서리 버튼을 피해 안쪽에 세운다
    return { x: 160 + d.x * 72, y: 92 + d.y * 46 };
  }

  render(r: Renderer): void {
    // 신호가 떠 있는 동안 화면 전체가 밝아진다(어느 방향에서 봐도 바로 알 수 있게)
    r.clear(this.phase === 'signal' ? PAL.bgMid : PAL.bgDark);
    r.rect(0, 91, 320, 1, PAL.bgMid);

    for (const p of this.ctx.players) {
      const pos = this.fighterPos(p);
      const winner = this.roundWinners.includes(p.seat) && this.phase === 'reveal';
      const pose: Pose = this.fouled.has(p.seat) ? 'down' : winner ? 'slash' : 'ready';
      // 가운데를 보게 한다. 180도 돌려 그리는 위쪽 사람은 좌우도 뒤집히므로 반대로.
      const mirror = pos.x > 160 !== p.flipped;
      const draw = () => {
        const sx = Math.round(pos.x - FIGHTER / 2);
        const sy = Math.round(pos.y - FIGHTER);
        r.ctx.drawImage(fighterSprite(p.seat, p.color, pose, mirror), sx, sy);
        drawMarker(r, pos.x, sy - 2, p.color.base);
        // 이긴 라운드 표시
        for (let i = 0; i < ROUNDS; i++) {
          const filled = i < (this.wins.get(p.seat) ?? 0);
          const px = pos.x - (ROUNDS * 6) / 2 + i * 6;
          r.rect(px, pos.y + 3, 5, 4, PAL.line);
          r.rect(px + 1, pos.y + 4, 3, 2, filled ? p.color.base : PAL.bgDark);
        }
        const warned = this.warned.get(p.seat);
        if (warned !== undefined && this.t - warned < 0.8) r.text('아직!', pos.x, sy - 16, PAL.text, 'center');
        if (this.fouled.has(p.seat)) r.text('실격', pos.x, sy - 16, PAL.text, 'center');
        if (winner && this.sinceSignal !== null) {
          const list = this.reactions.get(p.seat)!;
          const ms = list[list.length - 1];
          r.text(`${ms.toFixed(2)}초`, pos.x, sy - 16, PAL.yellow, 'center');
        }
      };
      // 위쪽 사람의 말·글자는 그 사람 쪽에서 바로 보이게 180도 돌린다
      if (p.flipped) r.rotated180(pos.x - 30, pos.y - 30, 60, 60, draw);
      else draw();
    }

    if (this.phase === 'signal' || (this.phase === 'reveal' && this.roundWinners.length > 0 && this.phaseT < 0.4)) {
      drawBang(r, 160, 91);
    }
    r.rect(146, 0, 28, 11, PAL.line);
    r.text(`${Math.min(this.round + 1, ROUNDS)}/${ROUNDS}`, 160, 1, PAL.text, 'center');
  }
}

/** 신호용 큰 느낌표(가로 8, 세로 34) */
function drawBang(r: Renderer, cx: number, cy: number): void {
  const x = cx - 4;
  const top = cy - 17;
  r.rect(x - 1, top - 1, 10, 25, PAL.line);
  r.rect(x - 1, top + 25, 10, 10, PAL.line);
  r.rect(x, top, 8, 23, PAL.yellow);
  r.rect(x + 6, top, 2, 23, PAL.yellowShadow);
  r.rect(x, top + 26, 8, 8, PAL.yellow);
  r.rect(x + 6, top + 26, 2, 8, PAL.yellowShadow);
}

const FIGHTER = 20;
const spriteCache = new Map<string, HTMLCanvasElement>();

/** 무사 말(오른쪽을 본다). mirror면 좌우 반전. */
function fighterSprite(seat: Seat, color: SeatColor, pose: Pose, mirror: boolean): HTMLCanvasElement {
  const key = `${seat}|${pose}|${mirror}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const g = new Grid(FIGHTER, FIGHTER);
  if (pose === 'down') {
    g.ellipse(11, 16, 7, 3, color.base, color.shadow);
    g.ellipse(3.5, 16, 3, 3, PAL.text);
    g.line(6, 19, 17, 19, PAL.bgMid);
  } else {
    const lean = pose === 'slash' ? 1 : 0;
    g.rect(6 + lean, 16, 2, 3, color.shadow);
    g.rect(11 + lean, 16, 2, 3, color.shadow);
    g.ellipse(9.5 + lean, 12, 5, 5, color.base, color.shadow);
    g.ellipse(9.5 + lean, 5.5, 3.5, 3.5, PAL.text);
    g.rect(6 + lean, 4, 7, 1, color.base);
    g.rect(9 + lean, 0, 2, 2, PAL.bgMid);
    if (pose === 'ready') {
      // 허리에 찬 칼집과 손잡이
      g.line(3, 16, 13, 11, PAL.bgMid);
      g.line(14, 11, 16, 10, PAL.yellowShadow);
    } else {
      // 뽑아 든 칼
      g.line(13, 10, 19, 2, PAL.text);
      g.line(12, 11, 13, 12, PAL.yellowShadow);
    }
  }
  g.outline(PAL.line);
  let canvas = g.toCanvas();
  if (mirror) {
    const m = createCanvas(FIGHTER, FIGHTER);
    const mctx = get2d(m);
    mctx.translate(FIGHTER, 0);
    mctx.scale(-1, 1);
    mctx.drawImage(canvas, 0, 0);
    canvas = m;
  }
  spriteCache.set(key, canvas);
  return canvas;
}

/** 신호를 보면 난이도별 반응 시간 뒤에 누른다. 가끔 성급하게 먼저 눌러 자멸한다. */
class QuickDrawAI implements AiController {
  private readonly hand: AiHand;
  private round = -1;
  private sawSignal = false;
  private readonly reaction: readonly [number, number];
  private readonly foulChance: number;

  constructor(
    private readonly game: QuickDraw,
    player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.reaction = byDifficulty(player.difficulty, { easy: [0.42, 0.62], normal: [0.28, 0.42], hard: [0.2, 0.28] });
    this.foulChance = byDifficulty(player.difficulty, { easy: 0.1, normal: 0.05, hard: 0.02 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    if (this.game.finished) return;
    const rng = this.game.rng;
    if (this.game.round !== this.round) {
      this.round = this.game.round;
      this.sawSignal = false;
      this.hand.reset();
      if (this.round > 0 && rng.next() < this.foulChance) this.hand.tap(0, 0.5 + rng.next() * 1.5);
    }
    if (this.game.phase === 'signal' && !this.sawSignal) {
      this.sawSignal = true;
      const [lo, hi] = this.reaction;
      this.hand.tap(0, lo + rng.next() * (hi - lo));
    }
  }
}

export const G19 = defineGame({
  code: 'G19',
  controls: 'one',
  create: () => new QuickDraw(),
  createAI: (game, player, controls) => new QuickDrawAI(game, player, controls),
});
