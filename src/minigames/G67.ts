import type { Seat } from '../input/seats';
import { rankByElimination } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawRing } from './common';
import { collideMovers, drawMover, drive, makeMover, MoverAI, type Mover } from './mover';
import { defineGame, type GameContext, type MiniGame } from './types';

// G67 의자 뺏기: 원버튼(떼면 제자리 회전, 누르면 돌진). 음악(북소리)이 나오는 동안은 가운데 의자 구역에 못 들어간다(밀려난다).
// 음악이 멈추면 사람 수보다 하나 적은 의자에 먼저 닿아 앉는다. 못 앉은 사람 탈락. 한 명 남을 때까지.

export const CX = 160;
export const CY = 96;
/** 음악 중엔 이 안으로 못 들어온다 */
export const KEEP_OUT = 34;
export const ARENA_R = 84;
const MUSIC_MIN = 3.5;
const MUSIC_MAX = 8;
const BEAT = 0.3;
/** 음악이 멈춘 뒤 이 안에 못 앉으면 아무 의자도 없는 사람은 탈락 */
export const GRAB_TIME = 4;
const RESULT_TIME = 1.2;
const CHAIR_R = 6;
const MAX_TIME = 90;

export type ChairPhase = 'music' | 'grab' | 'result';

export interface Chair {
  x: number;
  y: number;
  /** 앉은 사람 */
  seat: Seat | null;
}

export class MusicalChairs implements MiniGame {
  readonly code = 'G67';
  t = 0;
  movers: Mover[] = [];
  chairs: Chair[] = [];
  phase: ChairPhase = 'music';
  phaseT = 0;
  musicLen = 5;
  private beatClock = 0;
  private beat = 0;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const n = ctx.players.length;
    const start = ctx.rng.next() * Math.PI * 2;
    this.movers = ctx.players.map((p, i) => {
      const a = start + (i * Math.PI * 2) / n;
      const m = makeMover(p.seat, CX + Math.cos(a) * 60, CY + Math.sin(a) * 50, CX, CY, 7);
      // 처음엔 판을 따라 도는 쪽을 보게
      m.heading = a + Math.PI / 2;
      return m;
    });
    this.startMusic();
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
    return !this.done && !!this.movers.find((m) => m.seat === seat)?.alive && !this.chairs.some((c) => c.seat === seat);
  }

  getRanking(): Seat[][] {
    return rankByElimination(this.movers.map((m) => ({ seat: m.seat, outAt: m.outAt })));
  }

  private startMusic(): void {
    this.phase = 'music';
    this.phaseT = 0;
    this.musicLen = MUSIC_MIN + this.ctx.rng.next() * (MUSIC_MAX - MUSIC_MIN);
    const n = this.alive.length - 1;
    const start = this.ctx.rng.next() * Math.PI * 2;
    this.chairs = Array.from({ length: n }, (_, i) => {
      const a = start + (i * Math.PI * 2) / n;
      const rr = n === 1 ? 0 : 16;
      return { x: CX + Math.cos(a) * rr, y: CY + Math.sin(a) * rr, seat: null };
    });
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    this.phaseT += dt;
    for (const m of this.alive) {
      const chair = this.chairs.find((c) => c.seat === m.seat);
      if (chair) {
        // 앉은 사람은 의자에 붙어 있다
        m.x = chair.x;
        m.y = chair.y;
        m.vx = 0;
        m.vy = 0;
        continue;
      }
      drive(m, this.ctx.controls.get(m.seat)!.isDown(), dt);
      this.fence(m);
    }
    if (collideMovers(this.alive.filter((m) => !this.chairs.some((c) => c.seat === m.seat)), 0.9, 40).length > 0) this.ctx.sfx.hit();
    if (this.phase === 'music') {
      this.beatClock -= dt;
      if (this.beatClock <= 0) {
        this.beatClock += BEAT;
        this.ctx.sfx.drum(this.beat++ % 4 === 0 ? 0 : 2);
      }
      if (this.phaseT >= this.musicLen) {
        this.phase = 'grab';
        this.phaseT = 0;
        this.ctx.sfx.signal();
      }
    } else if (this.phase === 'grab') {
      for (const c of this.chairs) {
        if (c.seat !== null) continue;
        const m = this.alive.find((mv) => !this.chairs.some((ch) => ch.seat === mv.seat) && Math.hypot(mv.x - c.x, mv.y - c.y) < mv.r + CHAIR_R);
        if (!m) continue;
        c.seat = m.seat;
        this.ctx.sfx.coin();
      }
      if (this.chairs.every((c) => c.seat !== null) || this.phaseT >= GRAB_TIME) {
        for (const m of this.alive) {
          if (this.chairs.some((c) => c.seat === m.seat)) continue;
          m.alive = false;
          m.outAt = this.t;
          this.ctx.sfx.lose();
          this.ctx.fx.shake(3, 0.2);
        }
        this.phase = 'result';
        this.phaseT = 0;
      }
    } else if (this.phaseT >= RESULT_TIME) {
      if (this.alive.length <= 1) this.done = true;
      else {
        // 의자에서 일어나 바깥으로
        for (const m of this.alive) {
          const a = Math.atan2(m.y - CY, m.x - CX) || this.ctx.rng.next() * 6;
          m.x = CX + Math.cos(a) * 58;
          m.y = CY + Math.sin(a) * 48;
          m.heading = a + Math.PI / 2;
        }
        this.startMusic();
      }
    }
    if (this.t >= MAX_TIME) this.done = true;
  }

  /** 바깥 울타리와, 음악 중엔 가운데 금지 구역 */
  private fence(m: Mover): void {
    const dx = m.x - CX;
    const dy = m.y - CY;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;
    if (d > ARENA_R - m.r) {
      m.x = CX + nx * (ARENA_R - m.r);
      m.y = CY + ny * (ARENA_R - m.r);
      const out = m.vx * nx + m.vy * ny;
      if (out > 0) {
        m.vx -= nx * out * 1.6;
        m.vy -= ny * out * 1.6;
      }
    }
    if (this.phase !== 'grab' && d < KEEP_OUT + m.r) {
      // 벽처럼 밀어낸다
      m.x = CX + nx * (KEEP_OUT + m.r);
      m.y = CY + ny * (KEEP_OUT + m.r);
      const inward = -(m.vx * nx + m.vy * ny);
      if (inward > 0) {
        m.vx += nx * inward * 1.6;
        m.vy += ny * inward * 1.6;
      }
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.disc(CX, CY, ARENA_R + 2, PAL.line);
    r.disc(CX, CY, ARENA_R, PAL.bgMid);
    const music = this.phase !== 'grab';
    drawRing(r, CX, CY, KEEP_OUT, music ? PAL.redShadow : PAL.bgDark);
    for (const c of this.chairs) {
      const x = Math.round(c.x);
      const y = Math.round(c.y);
      const col = c.seat !== null ? this.ctx.players.find((p) => p.seat === c.seat)!.color.shadow : music ? PAL.yellowShadow : PAL.yellow;
      r.rect(x - CHAIR_R, y - CHAIR_R, CHAIR_R * 2, CHAIR_R * 2, PAL.line);
      r.rect(x - CHAIR_R + 1, y - CHAIR_R + 1, CHAIR_R * 2 - 2, CHAIR_R * 2 - 2, col);
      r.rect(x - CHAIR_R + 1, y - CHAIR_R + 1, CHAIR_R * 2 - 2, 3, PAL.line);
    }
    for (const m of this.movers) {
      if (!m.alive) continue;
      const p = this.ctx.players.find((pl) => pl.seat === m.seat)!;
      drawMover(r, m, p.color, { flash: m.stun > 0.15 });
    }
    // 음악 표시: 음표가 통통 튄다
    if (this.phase === 'music') {
      const hop = Math.floor(this.t / BEAT) % 2;
      r.rect(18, 12 - hop * 2, 2, 8, PAL.text);
      r.rect(14, 18 - hop * 2, 5, 4, PAL.text);
      r.rect(20, 12 - hop * 2, 4, 2, PAL.text);
    } else if (this.phase === 'grab') r.textScaled('앉아!', 160, 6, PAL.yellow, 2, 'center');
    // 탈락자는 왼쪽 위에 회색으로
    const out = this.movers.filter((m) => !m.alive);
    out.forEach((m, i) => r.disc(300 - i * 12, 12, 4, this.ctx.players.find((p) => p.seat === m.seat)!.color.shadow));
  }
}

export const G67 = defineGame({
  code: 'G67',
  controls: 'one',
  create: () => new MusicalChairs(),
  createAI: (game, player, controls) => {
    const me = () => game.movers.find((m) => m.seat === player.seat)!;
    return new MoverAI(
      me,
      () => {
        const m = me();
        if (game.chairs.some((c) => c.seat === m.seat)) return null;
        if (game.phase === 'grab') {
          const free = game.chairs
            .filter((c) => c.seat === null)
            .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
          return free ?? null;
        }
        if (game.phase === 'result') return null;
        // 음악 중엔 금지 구역 바로 바깥을 따라 돈다(가운데에 가까이 있어야 빨리 앉는다)
        const a = Math.atan2(m.y - CY, m.x - CX) + 0.6 * m.spin;
        return { x: CX + Math.cos(a) * (KEEP_OUT + 14), y: CY + Math.sin(a) * (KEEP_OUT + 14) };
      },
      player.difficulty,
      controls,
      game,
    );
  },
});
