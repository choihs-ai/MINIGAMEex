import type { Rng } from '../core/rng';
import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { Grid } from '../render/grid';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty } from './ai';
import { drawMarker } from './common';
import type { AiController, Difficulty } from './types';

// 몸싸움 게임 공통: 원버튼으로 움직이는 말(누르고 있으면 앞으로 달리고, 떼면 제자리에서 빙글 돈다)과
// 같은 무게끼리 튕기는 충돌. 레퍼런스 앱의 "돌다가 누르면 돌진" 조작.

export interface Mover {
  seat: Seat;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  /** 도는 방향(1 시계, -1 반시계) */
  spin: 1 | -1;
  r: number;
  /** 무게(무거울수록 덜 밀린다) */
  mass: number;
  /** 부딪힌 뒤 잠깐 조종이 안 먹는 시간 */
  stun: number;
  alive: boolean;
  outAt: number | null;
}

export interface DriveOpts {
  turnRate: number;
  thrust: number;
  maxSpeed: number;
  /** 초당 속도 감소 비율(0~) */
  friction: number;
  /** 손을 떼고 돌 때의 감속(브레이크) */
  brake: number;
}

export const DEFAULT_DRIVE: DriveOpts = { turnRate: 3.4, thrust: 260, maxSpeed: 85, friction: 2.2, brake: 4.5 };

export function makeMover(seat: Seat, x: number, y: number, towardX: number, towardY: number, r = 7): Mover {
  return {
    seat,
    x,
    y,
    vx: 0,
    vy: 0,
    heading: Math.atan2(towardY - y, towardX - x),
    // 대각선 자리끼리 같은 방향: 좌우·위아래로 마주 보는 사람은 거울처럼 반대로 돈다
    spin: seat === 0 || seat === 3 ? 1 : -1,
    r,
    mass: 1,
    stun: 0,
    alive: true,
    outAt: null,
  };
}

/** 한 틱 움직이기: held면 앞으로 가속, 아니면 제자리 회전. 마찰로 서서히 멈춘다. */
export function drive(m: Mover, held: boolean, dt: number, o: DriveOpts = DEFAULT_DRIVE): void {
  m.stun = Math.max(0, m.stun - dt);
  if (m.stun <= 0) {
    if (held) {
      m.vx += Math.cos(m.heading) * o.thrust * dt;
      m.vy += Math.sin(m.heading) * o.thrust * dt;
    } else m.heading += m.spin * o.turnRate * dt;
  }
  const k = Math.exp(-(held && m.stun <= 0 ? o.friction : o.brake) * dt);
  m.vx *= k;
  m.vy *= k;
  const v = Math.hypot(m.vx, m.vy);
  // 부딪혀 튕겨 나갈 때는 최고 속도를 넘어도 된다(밀려나는 맛)
  if (held && v > o.maxSpeed && m.stun <= 0) {
    m.vx *= o.maxSpeed / v;
    m.vy *= o.maxSpeed / v;
  }
  m.x += m.vx * dt;
  m.y += m.vy * dt;
}

/** 살아 있는 말끼리 부딪힘: 겹친 만큼 떼고, 무게를 따진 반발. 부딪힌 쌍을 돌려준다. */
export function collideMovers(list: readonly Mover[], restitution = 1.1, minKnock = 40): Array<[Mover, Mover, number]> {
  const hits: Array<[Mover, Mover, number]> = [];
  const alive = list.filter((m) => m.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d >= min || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      const overlap = min - d;
      const total = a.mass + b.mass;
      a.x -= nx * overlap * (b.mass / total);
      a.y -= ny * overlap * (b.mass / total);
      b.x += nx * overlap * (a.mass / total);
      b.y += ny * overlap * (a.mass / total);
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing <= 0) continue;
      const imp = ((1 + restitution) * closing) / (1 / a.mass + 1 / b.mass);
      const ka = Math.max(imp / a.mass, minKnock / a.mass);
      const kb = Math.max(imp / b.mass, minKnock / b.mass);
      a.vx -= nx * ka;
      a.vy -= ny * ka;
      b.vx += nx * kb;
      b.vy += ny * kb;
      a.stun = 0.25;
      b.stun = 0.25;
      hits.push([a, b, closing]);
    }
  }
  return hits;
}

/** 네모 경기장 벽에서 튕기기 */
export function bounceIn(m: Mover, x0: number, y0: number, x1: number, y1: number, keep = 0.8): void {
  if (m.x < x0 + m.r) {
    m.x = x0 + m.r;
    m.vx = Math.abs(m.vx) * keep;
  } else if (m.x > x1 - m.r) {
    m.x = x1 - m.r;
    m.vx = -Math.abs(m.vx) * keep;
  }
  if (m.y < y0 + m.r) {
    m.y = y0 + m.r;
    m.vy = Math.abs(m.vy) * keep;
  } else if (m.y > y1 - m.r) {
    m.y = y1 - m.r;
    m.vy = -Math.abs(m.vy) * keep;
  }
}

const bodyCache = new Map<string, HTMLCanvasElement>();

/** 위에서 본 동그란 말 + 바라보는 쪽 코(돌고 있는 방향을 보여 준다) */
export function drawMover(r: Renderer, m: Mover, color: SeatColor, opts: { marker?: boolean; flash?: boolean } = {}): void {
  const size = m.r * 2 + 3;
  const key = `${color.base}|${m.r}|${opts.flash ?? false}`;
  let body = bodyCache.get(key);
  if (!body) {
    const g = new Grid(size, size);
    g.ellipse(size / 2, size / 2, m.r, m.r, opts.flash ? PAL.text : color.base, opts.flash ? PAL.text : color.shadow);
    g.outline(PAL.line);
    body = g.toCanvas();
    bodyCache.set(key, body);
  }
  r.ctx.drawImage(body, Math.round(m.x - size / 2), Math.round(m.y - size / 2));
  const nx = m.x + Math.cos(m.heading) * (m.r - 2);
  const ny = m.y + Math.sin(m.heading) * (m.r - 2);
  r.rect(Math.round(nx) - 1, Math.round(ny) - 1, 3, 3, PAL.line);
  r.rect(Math.round(nx), Math.round(ny), 1, 1, PAL.text);
  if (opts.marker !== false) drawMarker(r, m.x, m.y - m.r - 3, color.base);
}

/** AI: 목표 방향을 바라보고 있으면 누르고(달리고), 아니면 떼서 돈다. 돌다가 지나치지 않게 여유를 둔다. */
export function aimHeld(m: Mover, tx: number, ty: number, tolerance = 0.35): boolean {
  let diff = Math.atan2(ty - m.y, tx - m.x) - m.heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(diff) < tolerance;
}

/**
 * 원버튼 말 AI: target()이 주는 곳을 바라보면 누르고, 아니면 떼서 돈다.
 * 난이도가 낮으면 늦게 반응하고 조준이 무디다. target()이 null이면 쉰다(돌기만).
 * 반응 간격은 매번 조금씩 흔들려서 판마다 결과가 달라진다.
 */
export class MoverAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private held = false;
  private readonly interval: number;
  private readonly tolerance: number;

  constructor(
    private readonly me: () => Mover,
    private readonly target: () => { x: number; y: number } | null,
    difficulty: Difficulty,
    controls: PlayerControls,
    private readonly game: { readonly finished: boolean; readonly rng: Rng },
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(difficulty, { easy: 0.16, normal: 0.09, hard: 0.04 });
    this.tolerance = byDifficulty(difficulty, { easy: 0.6, normal: 0.42, hard: 0.3 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const m = this.me();
    if (this.game.finished || !m.alive) {
      if (this.held) this.hand.releaseIn(0);
      this.held = false;
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval * (0.5 + this.game.rng.next());
    const t = this.target();
    const want = t !== null && aimHeld(m, t.x, t.y, this.tolerance);
    if (want === this.held) return;
    this.held = want;
    if (want) this.hand.pressIn(0);
    else this.hand.releaseIn(0);
  }
}
