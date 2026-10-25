import { BTN_LEFT, BTN_RIGHT, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { AiHand, byDifficulty } from './ai';
import { drawMarker, drawTimer } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G03 폭탄 피하기: 떨어지는 폭탄을 좌우로 피해 버틴다. 한 번 맞으면 탈락, 탈락 역순.
// 가끔 아이템이 떨어진다. 먹으면 "먹은 사람 빼고 나머지"가 3초 동안 조작 반전 또는 느려진다.
// 모두 아래쪽 한 줄에서(위쪽에 앉은 사람도 같은 방향으로 본다). 좌우 버튼은 그 사람 기준.

export const DURATION = 30;
export const FIELD_X = 80;
export const FIELD_W = 160;
export const GROUND_Y = 152;
export const RUN_SPEED = 92;
/** 폭탄이 이 높이(머리)까지 오면 맞았는지 본다 */
const HEAD_Y = GROUND_Y - 16;
export const HIT_HALF_W = 8;
const BOMB_SPEED_START = 70;
const BOMB_SPEED_END = 125;
const BOMB_RATE_START = 1.3;
const BOMB_RATE_END = 4.0;
export const EFFECT_TIME = 3;
const SLOW_FACTOR = 0.45;
const ITEM_EVERY = 4.5;

export type ItemKind = 'reverse' | 'slow';

export interface Dodger {
  seat: Seat;
  x: number;
  flipped: boolean;
  alive: boolean;
  outAt: number | null;
  reverseUntil: number;
  slowUntil: number;
  moving: -1 | 0 | 1;
}

export interface Drop {
  x: number;
  y: number;
  speed: number;
  item: ItemKind | null;
}

export class BombDodge implements MiniGame {
  readonly code = 'G03';
  t = 0;
  dodgers: Dodger[] = [];
  drops: Drop[] = [];
  private ctx!: GameContext;
  private done = false;
  private bombClock = 0.8;
  private itemClock = ITEM_EVERY;
  private blasts: Array<{ x: number; t: number }> = [];

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const ordered = [...ctx.players].sort((a, b) => a.seat - b.seat);
    this.dodgers = ordered.map((p, i) => ({
      seat: p.seat,
      x: Math.round(FIELD_X + (FIELD_W * (i + 1)) / (ordered.length + 1)),
      flipped: p.flipped,
      alive: true,
      outAt: null,
      reverseUntil: -1,
      slowUntil: -1,
      moving: 0,
    }));
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

  getRanking(): Seat[][] {
    return rankByElimination(this.dodgers.map((d) => ({ seat: d.seat, outAt: d.outAt })));
  }

  progress(): number {
    return Math.min(1, this.t / DURATION);
  }

  bombSpeed(): number {
    return BOMB_SPEED_START + (BOMB_SPEED_END - BOMB_SPEED_START) * this.progress();
  }

  reversed(d: Dodger): boolean {
    return d.reverseUntil > this.t;
  }

  slowed(d: Dodger): boolean {
    return d.slowUntil > this.t;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    const rng = this.ctx.rng;

    for (const d of this.dodgers) {
      if (!d.alive) continue;
      const c = this.ctx.controls.get(d.seat)!;
      // 그 사람 기준 좌우 → 위쪽 사람은 화면과 반대. 반전 중이면 한 번 더 뒤집는다.
      let local = (c.isDown(BTN_RIGHT) ? 1 : 0) - (c.isDown(BTN_LEFT) ? 1 : 0);
      if (this.reversed(d)) local = -local;
      const dir = (d.flipped ? -local : local) as -1 | 0 | 1;
      d.moving = dir;
      const speed = RUN_SPEED * (this.slowed(d) ? SLOW_FACTOR : 1);
      d.x = Math.max(FIELD_X + 6, Math.min(FIELD_X + FIELD_W - 6, d.x + dir * speed * dt));
    }

    this.bombClock -= dt;
    while (this.bombClock <= 0) {
      const k = this.progress();
      this.bombClock += 1 / (BOMB_RATE_START + (BOMB_RATE_END - BOMB_RATE_START) * k);
      this.drops.push({ x: FIELD_X + 5 + rng.next() * (FIELD_W - 10), y: -8, speed: this.bombSpeed() * (0.9 + rng.next() * 0.2), item: null });
    }
    this.itemClock -= dt;
    if (this.itemClock <= 0) {
      this.itemClock = ITEM_EVERY * (0.8 + rng.next() * 0.4);
      this.drops.push({ x: FIELD_X + 10 + rng.next() * (FIELD_W - 20), y: -8, speed: 55, item: rng.next() < 0.5 ? 'reverse' : 'slow' });
    }

    const kept: Drop[] = [];
    for (const drop of this.drops) {
      const before = drop.y;
      drop.y += drop.speed * dt;
      if (before < HEAD_Y && drop.y >= HEAD_Y && this.landOn(drop)) continue;
      if (drop.y >= GROUND_Y) {
        if (!drop.item) this.blasts.push({ x: drop.x, t: this.t });
        continue;
      }
      kept.push(drop);
    }
    this.drops = kept;
    this.blasts = this.blasts.filter((b) => this.t - b.t < 0.25);

    const alive = this.dodgers.filter((d) => d.alive).length;
    if (alive <= 1 || this.t >= DURATION) this.done = true;
  }

  /** 머리 높이를 지나는 순간 닿은 사람이 있으면 터지거나(폭탄) 먹는다(아이템) */
  private landOn(drop: Drop): boolean {
    const hit = this.dodgers.filter((d) => d.alive && Math.abs(d.x - drop.x) <= HIT_HALF_W + (drop.item ? 3 : 0));
    if (hit.length === 0) return false;
    if (drop.item) {
      // 가장 가까운 한 명만 먹는다. 효과는 먹은 사람 빼고 나머지 모두에게.
      const eater = hit.sort((a, b) => Math.abs(a.x - drop.x) - Math.abs(b.x - drop.x))[0];
      for (const d of this.dodgers) {
        if (d === eater || !d.alive) continue;
        if (drop.item === 'reverse') d.reverseUntil = this.t + EFFECT_TIME;
        else d.slowUntil = this.t + EFFECT_TIME;
      }
      this.ctx.sfx.coin();
      const p = this.ctx.players.find((pl) => pl.seat === eater.seat)!;
      this.ctx.fx.burst(drop.x, HEAD_Y, p.color.base, 8);
      return true;
    }
    for (const d of hit) {
      d.alive = false;
      d.outAt = this.t;
    }
    this.blasts.push({ x: drop.x, t: this.t });
    this.ctx.sfx.hit();
    this.ctx.fx.shake(4, 0.25);
    this.ctx.fx.burst(drop.x, HEAD_Y, PAL.yellow, 14);
    return true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(FIELD_X - 3, 0, 2, 180, PAL.bgMid);
    r.rect(FIELD_X + FIELD_W + 1, 0, 2, 180, PAL.bgMid);
    r.rect(FIELD_X, GROUND_Y, FIELD_W, 2, PAL.bgMid);

    // 떨어질 자리 그림자(가까울수록 진하게)
    for (const drop of this.drops) {
      if (drop.item) continue;
      const near = drop.y > GROUND_Y - 70;
      r.rect(drop.x - 4, GROUND_Y + 3, 9, 1, near ? PAL.redShadow : PAL.bgMid);
    }
    for (const drop of this.drops) {
      const sprite = drop.item ? itemSprite(drop.item) : bombSprite();
      r.ctx.drawImage(sprite, Math.round(drop.x - sprite.width / 2), Math.round(drop.y - sprite.height / 2));
    }
    for (const b of this.blasts) {
      const k = (this.t - b.t) / 0.25;
      r.disc(b.x, GROUND_Y - 4, Math.round(4 + k * 7), k < 0.5 ? PAL.yellow : PAL.red);
    }
    for (const d of this.dodgers) {
      const p = this.ctx.players.find((pl) => pl.seat === d.seat)!;
      const pose = !d.alive ? 'lose' : d.moving !== 0 ? 'move' : 'idle';
      const x = d.x - CHAR_SIZE / 2;
      const y = GROUND_Y - CHAR_SIZE + 2;
      drawCharacter(r.ctx, d.seat, pose, this.t + d.seat * 0.25, x, y);
      if (!d.alive) continue;
      drawMarker(r, d.x, y - 2, p.color.base);
      if (this.reversed(d)) r.ctx.drawImage(itemSprite('reverse'), Math.round(d.x - 5), GROUND_Y + 6);
      else if (this.slowed(d)) r.ctx.drawImage(itemSprite('slow'), Math.round(d.x - 5), GROUND_Y + 6);
    }
    drawTimer(r, DURATION - this.t, 160, 1);
  }
}

let bombCache: HTMLCanvasElement | null = null;

function bombSprite(): HTMLCanvasElement {
  if (!bombCache) {
    const g = new Grid(13, 15);
    g.ellipse(6.5, 9, 5.5, 5.5, PAL.bgMid, PAL.line);
    g.rect(5, 2, 3, 2, PAL.bgMid);
    g.line(7, 1, 9, 0, PAL.yellowShadow);
    g.set(10, 0, PAL.yellow);
    g.rect(3, 6, 2, 2, PAL.text);
    g.outline(PAL.line);
    bombCache = g.toCanvas();
  }
  return bombCache;
}

const itemCache = new Map<ItemKind, HTMLCanvasElement>();

/** 아이템 상자: 반전(⇄ 노랑), 감속(달팽이 파랑) */
export function itemSprite(kind: ItemKind): HTMLCanvasElement {
  let c = itemCache.get(kind);
  if (c) return c;
  const g = new Grid(11, 11);
  if (kind === 'reverse') {
    g.rect(0, 0, 11, 11, PAL.yellow);
    g.rect(2, 3, 6, 1, PAL.line);
    g.rect(6, 2, 1, 3, PAL.line);
    g.rect(3, 7, 6, 1, PAL.line);
    g.rect(4, 6, 1, 3, PAL.line);
  } else {
    g.rect(0, 0, 11, 11, PAL.blue);
    g.ellipse(6, 5, 3, 3, PAL.text, PAL.bgMid);
    g.rect(1, 8, 9, 1, PAL.text);
    g.rect(1, 6, 1, 2, PAL.text);
  }
  g.outline(PAL.line);
  c = g.toCanvas();
  itemCache.set(kind, c);
  return c;
}

/** 머리 위로 떨어질 폭탄을 보고 가까운 안전한 자리로 피한다. 반전 중에는 난이도만큼 헷갈린다. */
class BombDodgeAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private dir: -1 | 0 | 1 = 0;
  private readonly interval: number;
  private readonly lookAhead: number;
  private readonly confusion: number;
  private reverseSeen = -1;

  constructor(
    private readonly game: BombDodge,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.26, normal: 0.17, hard: 0.1 });
    this.lookAhead = byDifficulty(player.difficulty, { easy: 0.45, normal: 0.6, hard: 0.8 });
    this.confusion = byDifficulty(player.difficulty, { easy: 1.4, normal: 0.8, hard: 0.35 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    const me = g.dodgers.find((d) => d.seat === this.player.seat)!;
    if (!me.alive) {
      if (this.dir !== 0) this.release();
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;

    const speed = RUN_SPEED * (g.slowed(me) ? SLOW_FACTOR : 1);
    // 곧 머리 높이에 올 폭탄들의 위치
    const threats = g.drops
      .filter((d) => !d.item)
      .map((d) => ({ x: d.x, eta: (HEAD_Y - d.y) / d.speed }))
      .filter((d) => d.eta > -0.05 && d.eta < this.lookAhead + 0.4);
    const danger = (x: number, eta: number) => threats.some((th) => Math.abs(th.x - x) <= HIT_HALF_W + 3 && Math.abs(th.eta - eta) < 0.35);
    // 후보 자리마다 "가는 동안 안 맞고, 도착해서도 안전한가"
    let best = me.x;
    let bestCost = Infinity;
    for (let x = FIELD_X + 6; x <= FIELD_X + FIELD_W - 6; x += 4) {
      const travel = Math.abs(x - me.x) / speed;
      let cost = travel;
      const steps = 4;
      for (let i = 0; i <= steps; i++) {
        const tt = (travel * i) / steps;
        const px = me.x + (x - me.x) * (i / steps);
        if (danger(px, tt)) cost += 10;
      }
      if (danger(x, travel + 0.2)) cost += 6;
      // 아이템은 가까우면 노린다
      for (const it of g.drops) {
        if (!it.item) continue;
        const eta = (HEAD_Y - it.y) / it.speed;
        if (eta > travel && Math.abs(it.x - x) < 5) cost -= 0.4;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = x;
      }
    }
    let screenDir: -1 | 0 | 1 = 0;
    if (Math.abs(best - me.x) > 2) screenDir = best > me.x ? 1 : -1;
    let local = (me.flipped ? -screenDir : screenDir) as -1 | 0 | 1;
    if (g.reversed(me)) {
      if (this.reverseSeen < 0) this.reverseSeen = g.t;
      // 반전을 알아차리기 전까지는 원래대로 눌러 엉뚱하게 간다
      if (g.t - this.reverseSeen >= this.confusion) local = -local as -1 | 0 | 1;
    } else this.reverseSeen = -1;
    if (local === this.dir) return;
    this.release();
    if (local !== 0) this.hand.pressIn(local < 0 ? BTN_LEFT : BTN_RIGHT);
    this.dir = local;
  }

  private release(): void {
    if (this.dir !== 0) this.hand.releaseIn(this.dir < 0 ? BTN_LEFT : BTN_RIGHT);
    this.dir = 0;
  }
}

export const G03 = defineGame({
  code: 'G03',
  controls: 'leftRight',
  create: () => new BombDodge(),
  createAI: (game, player, controls) => new BombDodgeAI(game, player, controls),
});
