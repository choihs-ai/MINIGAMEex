import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { bounceIn, collideMovers, DEFAULT_DRIVE, drawMover, drive, makeMover, MoverAI, type DriveOpts, type Mover } from './mover';
import { homeDir } from './players';
import { defineGame, type GameContext, type MiniGame } from './types';

// G68 뜨거운 감자: 원버튼(떼면 제자리 회전, 누르면 돌진). 폭탄을 든 사람이 다른 사람에게 부딪히면 폭탄이 넘어간다.
// 심지 길이는 안 보인다(매번 다름). 터질 때 들고 있던 사람 탈락, 남은 사람 중 아무에게나 새 폭탄. 한 명 남을 때까지.
// 폭탄 든 사람은 조금 빠르다. 받은 직후엔 바로 되돌려 줄 수 없다.

export const ARENA = { x0: 14, y0: 16, x1: 306, y1: 174 };
export const FUSE_MIN = 5;
export const FUSE_MAX = 11;
/** 넘겨받은 뒤 이 시간 동안은 다시 넘길 수 없다 */
export const PASS_GUARD = 0.5;
const BOOM_PAUSE = 1.4;
const MAX_TIME = 90;
const CARRIER_DRIVE: DriveOpts = { ...DEFAULT_DRIVE, maxSpeed: DEFAULT_DRIVE.maxSpeed * 1.12, thrust: DEFAULT_DRIVE.thrust * 1.1 };

export class HotPotato implements MiniGame {
  readonly code = 'G68';
  t = 0;
  movers: Mover[] = [];
  carrier: Seat | null = null;
  /** 이 시각에 터진다(안 보여 준다) */
  boomAt = 0;
  passAt = -9;
  /** 터진 뒤 쉬는 중이면 다음 폭탄 시각 */
  nextBombAt: number | null = null;
  lastBoom: { x: number; y: number; at: number } | null = null;
  private tickClock = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.movers = ctx.players.map((p) => {
      const d = homeDir(p, ctx.humanCount);
      return makeMover(p.seat, 160 + d.x * 105, 95 + d.y * 50, 160, 95, 7);
    });
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

  get alive(): Mover[] {
    return this.movers.filter((m) => m.alive);
  }

  canPress(seat: Seat): boolean {
    return !this.done && !!this.movers.find((m) => m.seat === seat)?.alive;
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.movers.map((m) => ({ seat: m.seat, outAt: m.outAt })));
  }

  private newBomb(): void {
    const alive = this.alive;
    this.carrier = alive[Math.floor(this.ctx.rng.next() * alive.length)].seat;
    this.boomAt = this.t + FUSE_MIN + this.ctx.rng.next() * (FUSE_MAX - FUSE_MIN);
    this.passAt = this.t;
    this.nextBombAt = null;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const m of this.alive) {
      drive(m, this.ctx.controls.get(m.seat)!.isDown(), dt, m.seat === this.carrier ? CARRIER_DRIVE : DEFAULT_DRIVE);
      bounceIn(m, ARENA.x0, ARENA.y0, ARENA.x1, ARENA.y1);
    }
    for (const [a, b] of collideMovers(this.alive)) {
      this.ctx.sfx.hit();
      if (this.carrier === null || this.t - this.passAt < PASS_GUARD) continue;
      if (a.seat === this.carrier) this.pass(b.seat);
      else if (b.seat === this.carrier) this.pass(a.seat);
    }
    if (this.carrier !== null) {
      // 똑딱 소리는 늘 같은 빠르기(언제 터질지 모른다)
      this.tickClock -= dt;
      if (this.tickClock <= 0) {
        this.tickClock += 0.5;
        this.ctx.sfx.click();
      }
      if (this.t >= this.boomAt) this.explode();
    } else if (this.nextBombAt !== null && this.t >= this.nextBombAt) this.newBomb();
    if (this.t >= MAX_TIME) this.done = true;
  }

  private pass(seat: Seat): void {
    this.carrier = seat;
    this.passAt = this.t;
    this.ctx.sfx.tap();
  }

  private explode(): void {
    const m = this.movers.find((mv) => mv.seat === this.carrier)!;
    m.alive = false;
    m.outAt = this.t;
    this.carrier = null;
    this.lastBoom = { x: m.x, y: m.y, at: this.t };
    this.ctx.sfx.lose();
    this.ctx.fx.shake(5, 0.3);
    this.ctx.fx.burst(m.x, m.y, PAL.red, 18);
    this.ctx.fx.burst(m.x, m.y, PAL.yellow, 12);
    // 폭발에 가까운 사람은 밀려난다
    for (const o of this.alive) {
      const dx = o.x - m.x;
      const dy = o.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 50) {
        o.vx += (dx / d) * (50 - d) * 4;
        o.vy += (dy / d) * (50 - d) * 4;
        o.stun = 0.3;
      }
    }
    if (this.alive.length <= 1) this.done = true;
    else this.nextBombAt = this.t + BOOM_PAUSE;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(ARENA.x0 - 2, ARENA.y0 - 2, ARENA.x1 - ARENA.x0 + 4, ARENA.y1 - ARENA.y0 + 4, PAL.line);
    r.rect(ARENA.x0, ARENA.y0, ARENA.x1 - ARENA.x0, ARENA.y1 - ARENA.y0, PAL.bgMid);
    if (this.lastBoom && this.t - this.lastBoom.at < 0.4) {
      const k = (this.t - this.lastBoom.at) / 0.4;
      r.disc(this.lastBoom.x, this.lastBoom.y, Math.round(8 + k * 30), k < 0.5 ? PAL.yellow : PAL.redShadow);
    }
    for (const m of this.alive) {
      const p = this.ctx.players.find((pl) => pl.seat === m.seat)!;
      drawMover(r, m, p.color, { marker: m.seat !== this.carrier, flash: m.stun > 0.15 });
    }
    if (this.carrier !== null) {
      const m = this.movers.find((mv) => mv.seat === this.carrier)!;
      drawBomb(r, Math.round(m.x), Math.round(m.y) - 14, this.t, this.t - this.passAt < PASS_GUARD);
    }
    const out = this.movers.filter((m) => !m.alive);
    out.forEach((m, i) => r.disc(300 - i * 12, 8, 4, this.ctx.players.find((p) => p.seat === m.seat)!.color.shadow));
  }
}

/** 심지에 불꽃이 튀는 폭탄. guard면 반짝(아직 못 넘김). */
export function drawBomb(r: Renderer, cx: number, cy: number, t: number, guard = false): void {
  r.disc(cx, cy, 6, PAL.line);
  r.disc(cx, cy, 5, guard && Math.floor(t * 12) % 2 === 0 ? PAL.text : PAL.bgDark);
  r.rect(cx - 3, cy - 3, 2, 2, PAL.text);
  r.rect(cx + 2, cy - 8, 2, 3, PAL.yellowShadow);
  const spark = Math.floor(t * 15) % 3;
  r.rect(cx + 3 + (spark === 1 ? 1 : 0), cy - 10 - (spark === 2 ? 1 : 0), 2, 2, spark === 0 ? PAL.yellow : PAL.red);
}

export const G68 = defineGame({
  code: 'G68',
  controls: 'one',
  create: () => new HotPotato(),
  createAI: (game, player, controls) => {
    const me = () => game.movers.find((m) => m.seat === player.seat)!;
    return new MoverAI(
      me,
      () => {
        const m = me();
        if (game.carrier === null) return null;
        const carrier = game.movers.find((mv) => mv.seat === game.carrier)!;
        if (carrier === m) {
          // 가장 가까운 사람에게 떠넘긴다
          const near = game.alive
            .filter((o) => o !== m)
            .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
          return near ?? null;
        }
        // 폭탄에서 멀리 도망
        const d = Math.hypot(m.x - carrier.x, m.y - carrier.y) || 1;
        if (d > 110) return null;
        const x = Math.max(ARENA.x0 + 20, Math.min(ARENA.x1 - 20, m.x + ((m.x - carrier.x) / d) * 60));
        const y = Math.max(ARENA.y0 + 20, Math.min(ARENA.y1 - 20, m.y + ((m.y - carrier.y) / d) * 60));
        if (Math.hypot(x - m.x, y - m.y) < 25) return { x: 160 + (160 - m.x) * 0.6, y: 95 + (95 - m.y) * 0.6 };
        return { x, y };
      },
      player.difficulty,
      controls,
      game,
    );
  },
});
