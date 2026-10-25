import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { Grid } from '../render/grid';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawMarker, drawRing } from './common';
import { anyMoving, drawAim, flickVelocity, stepDiscs, type Disc } from './flick';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G25 빙판 컬링(차례제): 왼쪽 출발점의 내 돌을 누른 채 뒤로 당겼다 놓아 오른쪽 과녁으로 민다.
// 차례대로 한 개씩 던지고, 다 던진 뒤 과녁 중심에 가장 가까운 내 돌의 거리로 순위를 매긴다(가까운 순).
// 남의 돌을 쳐내도 된다. 기준선(점선)을 못 넘은 돌과 얼음 밖으로 나간 돌은 빠진다.

export const SHEET = { x: 16, y: 36, w: 292, h: 108 } as const;
export const HACK_X = 40;
export const HACK_Y = 90;
export const HOUSE_X = 246;
export const HOUSE_Y = 90;
export const HOUSE_R = 20;
/** 이 선을 넘지 못하고 멈춘 돌은 빠진다 */
export const HOG_X = 170;
export const STONE_R = 5;
export const MAX_DRAG = 40;
export const POWER = 5.6;
const DECEL = 55;
const RESTITUTION = 0.85;
export const MIN_DRAG = 6;
export const TURN_TIME = 6;
const GRAB_R = 22;

export type Phase = 'aim' | 'slide' | 'over';

export class IceCurling implements MiniGame {
  readonly code = 'G25';
  t = 0;
  stones: Disc[] = [];
  /** 던지는 순서(자리 번호를 돌아가며) */
  throws: Seat[] = [];
  thrown = 0;
  phase: Phase = 'aim';
  phaseT = 0;
  /** 지금 출발점에 놓인 돌 */
  ready: Disc | null = null;
  aiming = false;
  private ctx!: GameContext;
  private nextId = 0;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const seats = ctx.players.map((p) => p.seat).sort((a, b) => a - b);
    // 2인은 3개씩, 그 밖에는 2개씩
    const each = seats.length === 2 ? 3 : 2;
    for (let i = 0; i < each; i++) this.throws.push(...seats);
    this.placeStone();
  }

  get rng() {
    return this.ctx.rng;
  }

  get finished(): boolean {
    return this.phase === 'over';
  }

  isFinished(): boolean {
    return this.phase === 'over';
  }

  get current(): Seat {
    return this.throws[Math.min(this.thrown, this.throws.length - 1)];
  }

  activeSeat(): Seat | null {
    return this.phase === 'aim' ? this.current : null;
  }

  private placeStone(): void {
    this.ready = { id: this.nextId++, owner: this.current, x: HACK_X, y: HACK_Y, vx: 0, vy: 0, r: STONE_R, out: false };
    this.stones.push(this.ready);
  }

  /** 이 사람의 돌 중 과녁 중심에 가장 가까운 거리(돌이 없으면 Infinity) */
  bestDistance(seat: Seat): number {
    let best = Infinity;
    for (const s of this.stones) {
      if (s.out || s.owner !== seat || s === this.ready) continue;
      best = Math.min(best, Math.hypot(s.x - HOUSE_X, s.y - HOUSE_Y));
    }
    return best;
  }

  getScores(): Partial<Record<Seat, number>> {
    // 결과 막대 위 숫자: 과녁 안에 든 돌 수
    const inHouse = (seat: Seat) =>
      this.stones.filter((s) => !s.out && s.owner === seat && s !== this.ready && Math.hypot(s.x - HOUSE_X, s.y - HOUSE_Y) <= HOUSE_R + STONE_R).length;
    return Object.fromEntries(this.ctx.players.map((p) => [p.seat, inHouse(p.seat)])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    const seats = this.ctx.players.map((p) => p.seat);
    const sorted = [...seats].sort((a, b) => this.bestDistance(a) - this.bestDistance(b) || a - b);
    const groups: Seat[][] = [];
    let last: number | null = null;
    for (const s of sorted) {
      const d = this.bestDistance(s);
      if (last !== null && (d === last || Math.abs(d - last) < 1e-6)) groups[groups.length - 1].push(s);
      else groups.push([s]);
      last = d;
    }
    return groups;
  }

  update(dt: number): void {
    if (this.phase === 'over') return;
    this.t += dt;
    this.phaseT += dt;
    if (this.phase === 'aim') this.aim();
    else this.slide(dt);
  }

  private aim(): void {
    const stone = this.ready!;
    const c = this.ctx.controls.get(this.current)!;
    if (c.drag && !this.aiming && Math.hypot(c.drag.startX - stone.x, c.drag.startY - stone.y) <= GRAB_R) this.aiming = true;
    for (const rel of c.releasesThisTick) {
      if (!this.aiming) continue;
      this.aiming = false;
      const v = flickVelocity(rel, MAX_DRAG, POWER);
      if (v.len < MIN_DRAG) continue;
      stone.vx = v.vx;
      stone.vy = v.vy;
      this.ready = null;
      this.phase = 'slide';
      this.phaseT = 0;
      this.ctx.sfx.dash();
      return;
    }
    if (!c.drag) this.aiming = false;
    if (this.phaseT >= TURN_TIME) {
      // 시간 안에 못 던진 돌은 빠진다
      stone.out = true;
      this.ready = null;
      this.endThrow();
    }
  }

  private slide(dt: number): void {
    const sub = 4;
    for (let i = 0; i < sub; i++) {
      if (stepDiscs(this.stones, dt / sub, DECEL, RESTITUTION) > 0) this.ctx.sfx.click();
    }
    for (const s of this.stones) {
      if (s.out) continue;
      const inside = s.x >= SHEET.x && s.x <= SHEET.x + SHEET.w && s.y >= SHEET.y && s.y <= SHEET.y + SHEET.h;
      if (!inside) {
        s.out = true;
        this.ctx.sfx.splash();
      }
    }
    if (!anyMoving(this.stones, 1.5) || this.phaseT > 9) {
      for (const s of this.stones) {
        s.vx = 0;
        s.vy = 0;
        // 기준선을 못 넘은 돌은 빠진다
        if (!s.out && s.x < HOG_X) s.out = true;
      }
      this.endThrow();
    }
  }

  private endThrow(): void {
    this.thrown++;
    this.aiming = false;
    if (this.thrown >= this.throws.length) {
      this.phase = 'over';
      return;
    }
    this.phase = 'aim';
    this.phaseT = 0;
    this.placeStone();
    this.ctx.sfx.turn();
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 얼음판
    r.rect(SHEET.x - 2, SHEET.y - 2, SHEET.w + 4, SHEET.h + 4, PAL.line);
    r.rect(SHEET.x, SHEET.y, SHEET.w, SHEET.h, PAL.text);
    r.disc(HOUSE_X, HOUSE_Y, HOUSE_R, PAL.blue);
    r.disc(HOUSE_X, HOUSE_Y, HOUSE_R - 7, PAL.text);
    r.disc(HOUSE_X, HOUSE_Y, HOUSE_R - 13, PAL.red);
    r.disc(HOUSE_X, HOUSE_Y, 3, PAL.text);
    r.rect(SHEET.x, HOUSE_Y, SHEET.w, 1, PAL.bgMid);
    for (let y = SHEET.y; y < SHEET.y + SHEET.h; y += 4) r.rect(HOG_X, y, 1, 2, PAL.redShadow);
    drawRing(r, HACK_X, HACK_Y, 8, PAL.bgMid);

    // 가장 가까운 돌에 표시
    let leader: Disc | null = null;
    for (const s of this.stones) {
      if (s.out || s === this.ready) continue;
      if (!leader || Math.hypot(s.x - HOUSE_X, s.y - HOUSE_Y) < Math.hypot(leader.x - HOUSE_X, leader.y - HOUSE_Y)) leader = s;
    }
    for (const s of this.stones) {
      if (s.out) continue;
      const p = this.ctx.players.find((pl) => pl.seat === s.owner)!;
      r.ctx.drawImage(stoneSprite(p.color), Math.round(s.x - 7), Math.round(s.y - 7));
      if (s === leader && this.phase !== 'slide') drawMarker(r, s.x, s.y - 7, p.color.base);
    }
    if (this.ready && this.phase === 'aim') {
      const p = this.ctx.players.find((pl) => pl.seat === this.current)!;
      if (Math.floor(this.t * 4) % 2 === 0 || this.aiming) drawRing(r, this.ready.x, this.ready.y, STONE_R + 3, p.color.base);
      const c = this.ctx.controls.get(this.current);
      if (this.aiming && c?.drag) drawAim(r, this.ready, c.drag, MAX_DRAG);
      const left = Math.max(0, Math.ceil(TURN_TIME - this.phaseT));
      if (left <= 3) r.text(String(left), HACK_X, HACK_Y + 12, PAL.line, 'center');
    }

    // 남은 돌(던질 순서): 위·아래 띠에 한 줄로, 위쪽 사람용은 돌려서
    const flipped = this.ctx.players.some((p) => p.flipped);
    this.drawQueue(r, 172);
    if (flipped) r.rotated180(160, 4, 0, 0, () => this.drawQueue(r, 4));
  }

  private drawQueue(r: Renderer, y: number): void {
    const n = this.throws.length;
    const x0 = 160 - ((n - 1) * 12) / 2;
    this.throws.forEach((seat, i) => {
      const p = this.ctx.players.find((pl) => pl.seat === seat)!;
      const x = x0 + i * 12;
      const used = i < this.thrown;
      r.disc(x, y, 4, PAL.line);
      r.disc(x, y, 3, used ? PAL.bgMid : p.color.base);
      if (i === this.thrown && this.phase === 'aim') r.rect(x - 1, y - 8, 3, 2, PAL.text);
    });
  }
}

const stoneCache = new Map<string, HTMLCanvasElement>();

/** 컬링 돌(위에서): 회색 테두리 + 진영색 손잡이 */
function stoneSprite(color: SeatColor): HTMLCanvasElement {
  let c = stoneCache.get(color.base);
  if (!c) {
    const g = new Grid(15, 15);
    g.ellipse(7.5, 7.5, STONE_R + 1.5, STONE_R + 1.5, PAL.bgMid, PAL.line);
    g.ellipse(7.5, 7.5, STONE_R - 1, STONE_R - 1, color.base, color.shadow);
    g.rect(6, 5, 3, 1, PAL.text);
    g.outline(PAL.line);
    c = g.toCanvas();
    stoneCache.set(color.base, c);
  }
  return c;
}

/**
 * 과녁 한가운데로 미끄러질 힘을 계산해 던진다. 상대 돌이 중심 가까이 있으면 가끔 그 돌을 노려 쳐낸다.
 * 난이도만큼 방향·힘이 흔들린다.
 */
class CurlingAI implements AiController {
  private readonly hand: AiHand;
  private planned = -1;
  private readonly aimError: number;
  private readonly powerError: number;
  private readonly takeout: number;

  constructor(
    private readonly game: IceCurling,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.aimError = byDifficulty(player.difficulty, { easy: 0.06, normal: 0.032, hard: 0.015 });
    this.powerError = byDifficulty(player.difficulty, { easy: 0.12, normal: 0.06, hard: 0.03 });
    this.takeout = byDifficulty(player.difficulty, { easy: 0.2, normal: 0.45, hard: 0.7 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.phase !== 'aim' || g.current !== this.player.seat || !g.ready) return;
    if (this.planned === g.thrown) return;
    this.planned = g.thrown;
    const rng = g.rng;
    const stone = g.ready;
    let tx = HOUSE_X;
    let ty = HOUSE_Y;
    let extra = 0;
    const rival = g.stones
      .filter((s) => !s.out && s !== stone && s.owner !== this.player.seat)
      .sort((a, b) => Math.hypot(a.x - HOUSE_X, a.y - HOUSE_Y) - Math.hypot(b.x - HOUSE_X, b.y - HOUSE_Y))[0];
    if (rival && Math.hypot(rival.x - HOUSE_X, rival.y - HOUSE_Y) < HOUSE_R && rng.next() < this.takeout) {
      // 쳐내기: 그 돌을 향해 세게
      tx = rival.x;
      ty = rival.y;
      extra = 40;
    }
    const dist = Math.hypot(tx - stone.x, ty - stone.y) + extra;
    const speed = Math.sqrt(2 * DECEL * dist) * (1 + jitter(rng, this.powerError));
    const ang = Math.atan2(ty - stone.y, tx - stone.x) + jitter(rng, this.aimError);
    const pull = Math.min(MAX_DRAG, Math.max(MIN_DRAG + 1, speed / POWER));
    this.hand.drag(stone.x, stone.y, stone.x - Math.cos(ang) * pull, stone.y - Math.sin(ang) * pull, 0.6 + rng.next() * 0.6, 0.35);
  }
}

export const G25 = defineGame({
  code: 'G25',
  controls: 'pointer',
  pointer: 'turn',
  create: () => new IceCurling(),
  createAI: (game, player, controls) => new CurlingAI(game, player, controls),
});
