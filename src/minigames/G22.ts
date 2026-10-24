import { BTN_LEFT, BTN_RIGHT, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { Grid } from '../render/grid';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { rankByScore } from '../core/ranking';
import { AiHand, byDifficulty } from './ai';
import { drawMarker, drawTimer } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G22 별 받기: 바구니를 좌우로 움직여 떨어지는 별을 받는다. 남의 쪽 별도 가로챌 수 있다.
// 바구니는 모두 아래쪽 한 줄(위쪽에 앉은 사람도 같은 방향에서 받는다). 가운데 경기장 안에서만 움직인다.

export const DURATION = 20;
/** 경기장(모서리 버튼을 피한 가운데 띠) */
export const FIELD_X = 80;
export const FIELD_W = 160;
export const BASKET_W = 24;
const BASKET_H = 7;
export const BASKET_SPEED = 110;
/** 바구니 윗면(별을 받는 선) */
export const CATCH_Y = 150;
const STAR_SPEED_START = 60;
const STAR_SPEED_END = 95;
/** 참가자 1명당 초당 별 수 */
const STARS_PER_PLAYER = 0.9;

export interface Basket {
  seat: Seat;
  /** 바구니 가운데 x */
  x: number;
  count: number;
  caughtAt: number;
  /** 위쪽에 앉은 사람: 자기 기준 좌우가 화면과 반대 */
  flipped: boolean;
}

export interface Star {
  x: number;
  y: number;
}

export class StarCatch implements MiniGame {
  readonly code = 'G22';
  baskets: Basket[] = [];
  stars: Star[] = [];
  t = 0;
  private ctx!: GameContext;
  private done = false;
  private spawnClock = 0.3;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const ordered = [...ctx.players].sort((a, b) => a.seat - b.seat);
    this.baskets = ordered.map((p, i) => ({
      seat: p.seat,
      x: Math.round(FIELD_X + (FIELD_W * (i + 1)) / (ordered.length + 1)),
      count: 0,
      caughtAt: -1,
      flipped: p.flipped,
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

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.baskets.map((b) => [b.seat, b.count])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.baskets.map((b) => ({ seat: b.seat, score: b.count })));
  }

  starSpeed(): number {
    return STAR_SPEED_START + (STAR_SPEED_END - STAR_SPEED_START) * Math.min(1, this.t / DURATION);
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;

    for (const b of this.baskets) {
      const c = this.ctx.controls.get(b.seat)!;
      // 버튼은 플레이어 기준 좌/우. 위쪽에 앉은 사람은 화면을 거꾸로 보므로 자기 왼쪽 = 화면 오른쪽.
      const local = (c.isDown(BTN_RIGHT) ? 1 : 0) - (c.isDown(BTN_LEFT) ? 1 : 0);
      const dir = b.flipped ? -local : local;
      const min = FIELD_X + BASKET_W / 2;
      const max = FIELD_X + FIELD_W - BASKET_W / 2;
      b.x = Math.max(min, Math.min(max, b.x + dir * BASKET_SPEED * dt));
    }

    this.spawnClock -= dt;
    if (this.spawnClock <= 0) {
      this.spawnClock += 1 / (STARS_PER_PLAYER * this.baskets.length);
      this.stars.push({ x: FIELD_X + 6 + this.ctx.rng.next() * (FIELD_W - 12), y: -4 });
    }

    const speed = this.starSpeed();
    const kept: Star[] = [];
    for (const s of this.stars) {
      const before = s.y;
      s.y += speed * dt;
      if (before < CATCH_Y && s.y >= CATCH_Y && this.tryCatch(s)) continue;
      if (s.y > 190) continue;
      kept.push(s);
    }
    this.stars = kept;

    if (this.t >= DURATION) this.done = true;
  }

  /** 받는 선을 지나는 순간, 가장 가까운 바구니가 받는다. */
  private tryCatch(s: Star): boolean {
    let best: Basket | null = null;
    for (const b of this.baskets) {
      if (Math.abs(s.x - b.x) > BASKET_W / 2 + 2) continue;
      if (!best || Math.abs(s.x - b.x) < Math.abs(s.x - best.x)) best = b;
    }
    if (!best) return false;
    best.count++;
    best.caughtAt = this.t;
    this.ctx.sfx.catchStar();
    const p = this.ctx.players.find((pl) => pl.seat === best!.seat);
    if (p) this.ctx.fx.burst(s.x, s.y, p.color.base, 5);
    return true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 경기장 테두리
    r.rect(FIELD_X - 3, 0, 2, 180, PAL.bgMid);
    r.rect(FIELD_X + FIELD_W + 1, 0, 2, 180, PAL.bgMid);
    r.rect(FIELD_X, CATCH_Y + BASKET_H + 2, FIELD_W, 1, PAL.bgMid);

    for (const s of this.stars) {
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      for (let k = 6; k <= 14; k += 2) r.rect(x, y - k, 1, 1, PAL.bgMid);
      r.ctx.drawImage(starSprite(), x - 4, y - 4);
    }
    for (const b of this.baskets) this.drawBasket(r, b);
    drawTimer(r, DURATION - this.t, 160, 1);
  }

  private drawBasket(r: Renderer, b: Basket): void {
    const p = this.ctx.players.find((pl) => pl.seat === b.seat)!;
    const { base, shadow } = p.color;
    const x = Math.round(b.x - BASKET_W / 2);
    const y = CATCH_Y;
    const bump = this.t - b.caughtAt < 0.08 ? 1 : 0;
    r.rect(x - 1, y - 1 + bump, BASKET_W + 2, BASKET_H + 2, PAL.line);
    r.rect(x, y + bump, BASKET_W, 2, base);
    r.rect(x + 1, y + 2 + bump, BASKET_W - 2, BASKET_H - 2, shadow);
    for (let i = x + 3; i < x + BASKET_W - 2; i += 4) r.rect(i, y + 3 + bump, 2, BASKET_H - 4, base);
    drawMarker(r, b.x, y - 5, base);
    r.text(String(b.count), b.x, y + BASKET_H + 5, base, 'center');
  }
}

let starCache: HTMLCanvasElement | null = null;

/** 7×7 별(외곽선 포함 9×9) */
function starSprite(): HTMLCanvasElement {
  if (!starCache) {
    const g = new Grid(9, 9);
    const rows = ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && g.set(x + 1, y + 1, PAL.text)));
    g.outline(PAL.line);
    starCache = g.toCanvas();
  }
  return starCache;
}

/** 닿을 수 있는 별 중 가장 가까운 별을 쫓는다. 다른 바구니가 더 가까운 별은 뒤로 미룬다. */
class StarCatchAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private dir: -1 | 0 | 1 = 0;
  private readonly interval: number;
  private readonly misjudge: number;

  constructor(
    private readonly game: StarCatch,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.15, hard: 0.06 });
    this.misjudge = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.1, hard: 0 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    if (this.game.finished) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;

    const me = this.game.baskets.find((b) => b.seat === this.player.seat)!;
    const speed = this.game.starSpeed();
    const candidates = this.game.stars
      .map((s) => ({ s, eta: (CATCH_Y - s.y) / speed }))
      .filter((c) => c.eta > 0 && Math.abs(c.s.x - me.x) / BASKET_SPEED <= c.eta + 0.1)
      .map((c) => {
        const mine = Math.abs(c.s.x - me.x);
        const contested = this.game.baskets.some((b) => b !== me && Math.abs(c.s.x - b.x) < mine);
        return { ...c, cost: mine + c.eta * 25 + (contested ? 60 : 0) };
      })
      .sort((a, b) => a.cost - b.cost);
    let target = candidates[0]?.s;
    if (candidates.length > 1 && this.game.rng.next() < this.misjudge) target = candidates[1].s;

    let screenDir: -1 | 0 | 1 = 0;
    if (target && Math.abs(target.x - me.x) > 3) screenDir = target.x > me.x ? 1 : -1;
    const local = (me.flipped ? -screenDir : screenDir) as -1 | 0 | 1;
    if (local === this.dir) return;
    if (this.dir !== 0) this.hand.releaseIn(this.dir < 0 ? BTN_LEFT : BTN_RIGHT);
    if (local !== 0) this.hand.pressIn(local < 0 ? BTN_LEFT : BTN_RIGHT);
    this.dir = local;
  }
}

export const G22 = defineGame({
  code: 'G22',
  controls: 'leftRight',
  create: () => new StarCatch(),
  createAI: (game, player, controls) => new StarCatchAI(game, player, controls),
});
