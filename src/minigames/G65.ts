import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawTimer } from './common';
import { bounceIn, collideMovers, DEFAULT_DRIVE, drawMover, drive, makeMover, MoverAI, type DriveOpts, type Mover } from './mover';
import { defineGame, type GameContext, type MiniGame } from './types';

// G65 2:2 미니 축구: 원버튼(떼면 제자리 회전, 누르면 돌진)으로 공을 몰아 상대 골에 넣는다.
// 4인은 왼쪽(1P·3P) 대 오른쪽(2P·4P), 3인은 1:2(혼자인 팀은 골대가 작다), 2인은 1:1. 1인은 사람+CPU 대 CPU 둘.
// 40초 동안 골 많은 팀, 같으면 골든골(최대 15초). 팀 점수는 두 사람 모두의 순위.

export const DURATION = 40;
export const GOLDEN = 15;
export const FIELD = { x0: 22, y0: 24, x1: 298, y1: 170 };
/** 골대 가운데와 반 높이(혼자인 팀은 SOLO_HALF) */
export const GOAL_Y = 97;
export const GOAL_HALF = 40;
export const SOLO_HALF = 26;
export const BALL_R = 5;
const BALL_FRICTION = 0.6;
const BALL_MASS = 0.25;
const KICKOFF_PAUSE = 1.2;
/** 축구는 조금 빨리 돈다(공을 다루기 쉽게) */
const SOCCER_DRIVE: DriveOpts = { ...DEFAULT_DRIVE, turnRate: 5.2, maxSpeed: 95 };
/** 모서리 둥근 반지름 */
const CORNER = 22;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SoccerTeam {
  seats: Seat[];
  /** 공격 방향(+1이면 오른쪽 골로) */
  dir: 1 | -1;
  goals: number;
  /** 이 팀이 지키는 골대의 반 높이 */
  half: number;
}

/** 참가 자리로 팀을 나눈다: 2명이면 1:1, 3~4명이면 짝수 자리(1P·3P) 대 홀수 자리(2P·4P) */
export function soccerTeams(seats: readonly Seat[]): Seat[][] {
  const sorted = [...seats].sort((a, b) => a - b);
  if (sorted.length <= 2) return sorted.map((s) => [s]);
  return [sorted.filter((s) => s % 2 === 0), sorted.filter((s) => s % 2 === 1)];
}

export class MiniSoccer implements MiniGame {
  readonly code = 'G65';
  t = 0;
  movers: Mover[] = [];
  teams: SoccerTeam[] = [];
  ball: Ball = { x: 160, y: 97, vx: 0, vy: 0 };
  /** 이 시각까지 킥오프 대기(아무도 못 움직인다) */
  pauseUntil = KICKOFF_PAUSE;
  lastGoal: { team: SoccerTeam; at: number } | null = null;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const groups = soccerTeams(ctx.players.map((p) => p.seat));
    this.teams = groups.map((seats, i) => ({
      seats,
      dir: i === 0 ? 1 : -1,
      goals: 0,
      half: seats.length === 1 && groups.some((g) => g.length === 2) ? SOLO_HALF : GOAL_HALF,
    }));
    this.kickoff();
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

  teamOf(seat: Seat): SoccerTeam {
    return this.teams.find((t) => t.seats.includes(seat))!;
  }

  /** 이 팀이 지키는 골의 x */
  ownGoalX(team: SoccerTeam): number {
    return team.dir === 1 ? FIELD.x0 : FIELD.x1;
  }

  canPress(): boolean {
    return !this.done && this.t >= this.pauseUntil;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.ctx.players.map((p) => [p.seat, this.teamOf(p.seat).goals])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.ctx.players.map((p) => ({ seat: p.seat, score: this.teamOf(p.seat).goals })));
  }

  /** 모두 제자리로, 공은 가운데 */
  private kickoff(): void {
    this.ball = { x: 160, y: 97, vx: 0, vy: 0 };
    this.movers = [];
    for (const team of this.teams) {
      team.seats.forEach((seat, i) => {
        const x = 160 - team.dir * (team.seats.length === 2 ? (i === 0 ? 40 : 90) : 60);
        const y = team.seats.length === 2 ? (i === 0 ? 70 : 124) : 97;
        this.movers.push(makeMover(seat, x, y, 160, 97, 7));
      });
    }
    this.pauseUntil = this.t + KICKOFF_PAUSE;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    if (this.t < this.pauseUntil) return;
    for (const m of this.movers) {
      drive(m, this.ctx.controls.get(m.seat)!.isDown(), dt, SOCCER_DRIVE);
      bounceIn(m, FIELD.x0, FIELD.y0, FIELD.x1, FIELD.y1);
    }
    if (collideMovers(this.movers, 0.6, 30).length > 0) this.ctx.sfx.hit();
    this.moveBall(dt);
    const over = this.t >= DURATION;
    const [a, b] = this.teams;
    if (over && (a.goals !== b.goals || this.t >= DURATION + GOLDEN)) this.done = true;
  }

  private moveBall(dt: number): void {
    const ball = this.ball;
    const k = Math.exp(-BALL_FRICTION * dt);
    ball.vx *= k;
    ball.vy *= k;
    const v = Math.hypot(ball.vx, ball.vy);
    if (v > 220) {
      ball.vx *= 220 / v;
      ball.vy *= 220 / v;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    // 사람(말)과 부딪힘: 공이 가벼워 멀리 튄다
    for (const m of this.movers) this.kick(m.x, m.y, m.r, m.vx, m.vy, m);
    // 골
    const defender = this.teams.find((t) => (ball.x < 160 ? t.dir === 1 : t.dir === -1))!;
    const inMouth = Math.abs(ball.y - GOAL_Y) < defender.half - BALL_R;
    if (inMouth && (ball.x < FIELD.x0 - BALL_R || ball.x > FIELD.x1 + BALL_R)) {
      const scorer = this.teams.find((t) => (ball.x > FIELD.x1 ? t.dir === 1 : t.dir === -1))!;
      scorer.goals++;
      this.lastGoal = { team: scorer, at: this.t };
      this.ctx.sfx.coin();
      this.ctx.fx.shake(4, 0.25);
      this.ctx.fx.burst(ball.x, ball.y, PAL.text, 14);
      if (this.t >= DURATION) this.done = true;
      else this.kickoff();
      return;
    }
    // 벽(골문 앞은 열려 있다)
    if (!inMouth) {
      if (ball.x < FIELD.x0 + BALL_R) {
        ball.x = FIELD.x0 + BALL_R;
        ball.vx = Math.abs(ball.vx) * 0.8;
      } else if (ball.x > FIELD.x1 - BALL_R) {
        ball.x = FIELD.x1 - BALL_R;
        ball.vx = -Math.abs(ball.vx) * 0.8;
      }
    }
    this.corners();
    if (ball.y < FIELD.y0 + BALL_R) {
      ball.y = FIELD.y0 + BALL_R;
      ball.vy = Math.abs(ball.vy) * 0.8;
    } else if (ball.y > FIELD.y1 - BALL_R) {
      ball.y = FIELD.y1 - BALL_R;
      ball.vy = -Math.abs(ball.vy) * 0.8;
    }
  }

  /** 경기장 네 모서리는 둥글게: 공이 구석에 끼지 않는다 */
  private corners(): void {
    const ball = this.ball;
    const f = FIELD;
    const cx = ball.x < 160 ? f.x0 + CORNER : f.x1 - CORNER;
    const cy = ball.y < 97 ? f.y0 + CORNER : f.y1 - CORNER;
    if ((ball.x - cx) * (ball.x < 160 ? -1 : 1) <= 0 || (ball.y - cy) * (ball.y < 97 ? -1 : 1) <= 0) return;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const d = Math.hypot(dx, dy);
    if (d <= CORNER - BALL_R) return;
    const nx = dx / d;
    const ny = dy / d;
    ball.x = cx + nx * (CORNER - BALL_R);
    ball.y = cy + ny * (CORNER - BALL_R);
    const out = ball.vx * nx + ball.vy * ny;
    if (out > 0) {
      ball.vx -= nx * out * 1.8;
      ball.vy -= ny * out * 1.8;
    }
  }

  private kick(x: number, y: number, r: number, vx: number, vy: number, m: Mover | null): void {
    const ball = this.ball;
    const dx = ball.x - x;
    const dy = ball.y - y;
    const d = Math.hypot(dx, dy);
    if (d >= r + BALL_R || d === 0) return;
    const nx = dx / d;
    const ny = dy / d;
    ball.x = x + nx * (r + BALL_R);
    ball.y = y + ny * (r + BALL_R);
    const closing = (vx - ball.vx) * nx + (vy - ball.vy) * ny;
    if (closing <= 0) return;
    const imp = (1.5 * closing) / (1 + 1 / BALL_MASS);
    // 살짝 옆으로 튀는 맛(가운데서 둘이 맞밀 때 공이 빠져나간다)
    const side = (this.ctx.rng.next() - 0.5) * (closing * 0.5 + 20);
    ball.vx += nx * (imp / BALL_MASS + 10) - ny * side;
    ball.vy += ny * (imp / BALL_MASS + 10) + nx * side;
    if (m) {
      m.vx -= nx * imp;
      m.vy -= ny * imp;
    }
    if (closing > 30) this.ctx.sfx.tap();
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const f = FIELD;
    r.rect(f.x0 - 2, f.y0 - 2, f.x1 - f.x0 + 4, f.y1 - f.y0 + 4, PAL.text);
    r.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0, PAL.greenShadow);
    for (let x = f.x0; x < f.x1; x += 46) r.rect(x, f.y0, 23, f.y1 - f.y0, PAL.green);
    r.rect(159, f.y0, 2, f.y1 - f.y0, PAL.text);
    for (const team of this.teams) {
      const gx = this.ownGoalX(team);
      const color = this.ctx.players.find((p) => p.seat === team.seats[0])!.color;
      const x = team.dir === 1 ? gx - 12 : gx;
      r.rect(x, GOAL_Y - team.half, 12, team.half * 2, PAL.line);
      r.rect(x + (team.dir === 1 ? 0 : 2), GOAL_Y - team.half + 2, 10, team.half * 2 - 4, color.shadow);
    }
    for (const m of this.movers) {
      const p = this.ctx.players.find((pl) => pl.seat === m.seat)!;
      drawMover(r, m, p.color, { flash: m.stun > 0.15 });
    }
    r.disc(this.ball.x, this.ball.y, BALL_R + 1, PAL.line);
    r.disc(this.ball.x, this.ball.y, BALL_R, PAL.text);
    // 점수판
    const [a, b] = this.teams;
    const ca = this.ctx.players.find((p) => p.seat === a.seats[0])!.color;
    const cb = this.ctx.players.find((p) => p.seat === b.seats[0])!.color;
    r.rect(136, 2, 48, 13, PAL.line);
    r.text(String(a.goals), 148, 4, ca.base, 'center');
    r.text(':', 160, 4, PAL.text, 'center');
    r.text(String(b.goals), 172, 4, cb.base, 'center');
    const left = this.t < DURATION ? DURATION - this.t : DURATION + GOLDEN - this.t;
    drawTimer(r, left, 200, 4);
    if (this.t >= DURATION) r.text('골든골!', 112, 5, PAL.yellow, 'center');
    if (this.lastGoal && this.t - this.lastGoal.at < KICKOFF_PAUSE) r.textScaled('GOAL!', 160, 80, PAL.yellow, 2, 'center');
  }
}

export const G65 = defineGame({
  code: 'G65',
  controls: 'one',
  create: () => new MiniSoccer(),
  createAI: (game, player, controls) => {
    const me = () => game.movers.find((m) => m.seat === player.seat)!;
    return new MoverAI(
      me,
      () => {
        const m = me();
        const team = game.teamOf(player.seat);
        const ball = game.ball;
        const goalX = team.dir === 1 ? 312 : 8;
        const toGoal = Math.atan2(97 - ball.y, goalX - ball.x);
        // 같은 팀에서 공에 더 가까운 사람이 있으면 내 골 앞을 지킨다
        const mate = game.movers.find((o) => o !== m && team.seats.includes(o.seat));
        if (mate && Math.hypot(mate.x - ball.x, mate.y - ball.y) + 15 < Math.hypot(m.x - ball.x, m.y - ball.y)) {
          const own = game.ownGoalX(team);
          return { x: own + team.dir * 40, y: (ball.y + 97 * 2) / 3 };
        }
        // 공 뒤(골 반대쪽) 자리로 돌아간 뒤, 골 쪽으로 공을 뚫고 지나간다
        const ux = Math.cos(toGoal);
        const uy = Math.sin(toGoal);
        const tox = ball.x - m.x;
        const toy = ball.y - m.y;
        const dist = Math.hypot(tox, toy) || 1;
        const aligned = (tox * ux + toy * uy) / dist > 0.45;
        if (aligned) return { x: ball.x + ux * 10, y: ball.y + uy * 10 };
        const spot = { x: ball.x - ux * 18, y: ball.y - uy * 18 };
        // 공 앞에 있으면 공을 피해 옆으로 돌아간다
        if ((m.x - ball.x) * ux + (m.y - ball.y) * uy > -4) {
          const side = (m.x - ball.x) * -uy + (m.y - ball.y) * ux > 0 ? 1 : -1;
          return { x: ball.x - ux * 8 - uy * side * 20, y: ball.y - uy * 8 + ux * side * 20 };
        }
        return spot;
      },
      player.difficulty,
      controls,
      game,
    );
  },
});
