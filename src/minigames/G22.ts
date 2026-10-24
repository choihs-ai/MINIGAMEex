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
// 바구니는 각자 앉은 쪽 가장자리에 있다(아래쪽 사람은 아래, 위쪽 사람은 위).
// 양쪽에 사람이 있으면 별은 가운데 줄에서 생겨 각 쪽으로 떨어진다.

export const DURATION = 45;
export const BASKET_W = 24;
const BASKET_H = 7;
export const BASKET_SPEED = 120;
/** 아래쪽 바구니 윗면(별을 받는 선). 위쪽은 화면 기준으로 뒤집은 위치. */
export const CATCH_Y_BOTTOM = 156;
export const CATCH_Y_TOP = 180 - CATCH_Y_BOTTOM;
const STAR_SPEED_START = 55;
const STAR_SPEED_END = 95;
/** 그 쪽에 있는 사람 1명당 초당 별 수 */
const STARS_PER_PLAYER = 1.1;

export type Side = 'top' | 'bottom';

export interface Basket {
  seat: Seat;
  side: Side;
  /** 바구니 가운데 x */
  x: number;
  count: number;
  caughtAt: number;
}

export interface Star {
  x: number;
  y: number;
  side: Side;
  /** 떨어지는 방향(아래 +1, 위 -1) */
  dir: 1 | -1;
}

export class StarCatch implements MiniGame {
  readonly code = 'G22';
  baskets: Basket[] = [];
  stars: Star[] = [];
  t = 0;
  private ctx!: GameContext;
  private done = false;
  private spawnClock = new Map<Side, number>();
  private sides: Side[] = [];

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const side of ['bottom', 'top'] as Side[]) {
      // 같은 쪽 사람들을 화면 왼쪽부터 고르게 배치
      const onSide = ctx.players
        .filter((p) => sideOf(p) === side)
        .sort((a, b) => screenOrder(a, ctx.humanCount) - screenOrder(b, ctx.humanCount));
      onSide.forEach((p, i) => {
        this.baskets.push({ seat: p.seat, side, x: Math.round((320 * (i + 1)) / (onSide.length + 1)), count: 0, caughtAt: -1 });
      });
      if (onSide.length > 0) {
        this.sides.push(side);
        this.spawnClock.set(side, 0.4);
      }
    }
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

  /** 별이 처음 생기는 y(양쪽에 사람이 있으면 가운데 줄, 한쪽뿐이면 반대편 끝) */
  spawnY(side: Side): number {
    if (this.sides.length === 2) return 90;
    return side === 'bottom' ? -4 : 184;
  }

  starSpeed(): number {
    return STAR_SPEED_START + (STAR_SPEED_END - STAR_SPEED_START) * Math.min(1, this.t / DURATION);
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;

    for (const b of this.baskets) {
      const c = this.ctx.controls.get(b.seat)!;
      // 버튼은 플레이어 기준 좌/우. 위쪽 사람은 화면에서 좌우가 반대다.
      const local = (c.isDown(BTN_RIGHT) ? 1 : 0) - (c.isDown(BTN_LEFT) ? 1 : 0);
      const dir = b.side === 'top' ? -local : local;
      b.x = Math.max(BASKET_W / 2, Math.min(320 - BASKET_W / 2, b.x + dir * BASKET_SPEED * dt));
    }

    for (const side of this.sides) {
      const count = this.baskets.filter((b) => b.side === side).length;
      let clock = (this.spawnClock.get(side) ?? 0) - dt;
      if (clock <= 0) {
        clock += 1 / (STARS_PER_PLAYER * count);
        this.stars.push({ x: 8 + this.ctx.rng.next() * 304, y: this.spawnY(side), side, dir: side === 'bottom' ? 1 : -1 });
      }
      this.spawnClock.set(side, clock);
    }

    const speed = this.starSpeed();
    const kept: Star[] = [];
    for (const s of this.stars) {
      const before = s.y;
      s.y += s.dir * speed * dt;
      const line = s.side === 'bottom' ? CATCH_Y_BOTTOM : CATCH_Y_TOP;
      const crossed = s.dir > 0 ? before < line && s.y >= line : before > line && s.y <= line;
      if (crossed && this.tryCatch(s)) continue;
      if (s.y < -10 || s.y > 190) continue;
      kept.push(s);
    }
    this.stars = kept;

    if (this.t >= DURATION) this.done = true;
  }

  /** 받는 선을 지나는 순간, 그 쪽 바구니 중 가장 가까운 것이 받는다. */
  private tryCatch(s: Star): boolean {
    let best: Basket | null = null;
    for (const b of this.baskets) {
      if (b.side !== s.side || Math.abs(s.x - b.x) > BASKET_W / 2 + 2) continue;
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
    if (this.sides.length === 2) {
      for (let x = 0; x < 320; x += 6) r.rect(x, 90, 3, 1, PAL.bgMid);
    }
    for (const s of this.stars) {
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      // 지나온 자취
      for (let k = 6; k <= 14; k += 2) r.rect(x, y - s.dir * k, 1, 1, PAL.bgMid);
      r.ctx.drawImage(starSprite(), x - 4, y - 4);
    }
    for (const b of this.baskets) this.drawBasket(r, b);
    drawTimer(r, DURATION - this.t, 160, this.sides.length === 2 ? 84 : 1);
  }

  private drawBasket(r: Renderer, b: Basket): void {
    const p = this.ctx.players.find((pl) => pl.seat === b.seat)!;
    const { base, shadow } = p.color;
    const x = Math.round(b.x - BASKET_W / 2);
    const y = CATCH_Y_BOTTOM;
    const draw = () => {
      // 받은 직후 한 프레임 눌린다
      const bump = this.t - b.caughtAt < 0.08 ? 1 : 0;
      r.rect(x - 1, y - 1 + bump, BASKET_W + 2, BASKET_H + 2, PAL.line);
      r.rect(x, y + bump, BASKET_W, 2, base);
      r.rect(x + 1, y + 2 + bump, BASKET_W - 2, BASKET_H - 2, shadow);
      for (let i = x + 3; i < x + BASKET_W - 2; i += 4) r.rect(i, y + 3 + bump, 2, BASKET_H - 4, base);
      drawMarker(r, b.x, y - 5, base);
      r.text(String(b.count), b.x + 6, y - 13, base);
    };
    // 위쪽 바구니는 화면 가운데를 향하도록 180도 돌린다(x 대칭이 되므로 기준을 맞춘다)
    if (b.side === 'top') r.rotated180(b.x - 40, 45, 80, 90, draw);
    else draw();
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

function sideOf(p: PlayerInfo): Side {
  return p.flipped ? 'top' : 'bottom';
}

/** 같은 쪽에서의 화면상 왼쪽→오른쪽 순서. 1인(AI 셋과 함께 모두 아래쪽)이면 1P~4P 순서. */
function screenOrder(p: PlayerInfo, humanCount: number): number {
  if (humanCount === 1) return p.seat;
  return p.seat % 2 === 0 ? p.seat : p.seat + 10;
}

/** 닿을 수 있는 별 중 가장 가까운 별을 쫓는다. */
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
    const line = me.side === 'bottom' ? CATCH_Y_BOTTOM : CATCH_Y_TOP;
    const speed = this.game.starSpeed();
    const candidates = this.game.stars
      .filter((s) => s.side === me.side)
      .map((s) => ({ s, eta: (line - s.y) / (s.dir * speed) }))
      .filter((c) => c.eta > 0 && Math.abs(c.s.x - me.x) / BASKET_SPEED <= c.eta + 0.1)
      // 가장 가까운 별 우선, 곧 떨어질 별은 조금 더 우선. 다른 바구니가 더 가까운 별은 뒤로 미뤄 한곳에 몰리지 않게 한다.
      .map((c) => {
        const mine = Math.abs(c.s.x - me.x);
        const contested = this.game.baskets.some((b) => b !== me && b.side === me.side && Math.abs(c.s.x - b.x) < mine);
        return { ...c, cost: mine + c.eta * 25 + (contested ? 60 : 0) };
      })
      .sort((a, b) => a.cost - b.cost);
    let target = candidates[0]?.s;
    if (candidates.length > 1 && this.game.rng.next() < this.misjudge) target = candidates[1].s;

    let screenDir: -1 | 0 | 1 = 0;
    if (target && Math.abs(target.x - me.x) > 3) screenDir = target.x > me.x ? 1 : -1;
    // 버튼은 플레이어 기준 좌우
    const local = (me.side === 'top' ? -screenDir : screenDir) as -1 | 0 | 1;
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
