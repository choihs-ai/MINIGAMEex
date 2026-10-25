import { BTN_DOWN, BTN_UP, type ControlLayout, type PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { Grid } from '../render/grid';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawMarker, drawTimer, facing } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G08 두 명이 한 우주선: 2인 1팀. 조종(위/아래 2버튼)과 사격(원버튼)을 나눠 맡아 운석을 부순다.
// 4인은 왼쪽 둘(1P·3P) 대 오른쪽 둘(2P·4P), 3인은 1:2(혼자인 팀은 자동 사격), 2인은 한 배로 협동해 목표 점수.
// 1인은 사람이 조종, CPU가 사격(상대 팀은 CPU 둘). 팀 점수는 두 사람 모두의 점수.

export const DURATION = 30;
/** 2인 협동 목표 점수 */
export const COOP_TARGET = 30;
export const SHIP_SPEED = 90;
export const BULLET_SPEED = 210;
export const FIRE_COOLDOWN = 0.3;
/** 누르고 있으면 이 간격으로 저절로 쏜다 */
const HOLD_REPEAT = 0.3;
const AUTO_FIRE = 0.45;
export const STUN_TIME = 1.5;
/** 운석에 부딪히면 멈추는 시간과 깎이는 팀 점수 */
export const CRASH_STUN = 1.2;
export const CRASH_PENALTY = 2;
const SHIP_MIN_Y = 18;
const SHIP_MAX_Y = 162;
export const LEFT_X = 58;
export const RIGHT_X = 262;
const SPAWN_RATE = 1.7;

export type Role = 'pilot' | 'gunner';

export interface Team {
  side: 'left' | 'right';
  pilot: Seat;
  /** 사격 담당(혼자인 팀은 null: 자동 사격) */
  gunner: Seat | null;
  x: number;
  y: number;
  dir: 1 | -1;
  score: number;
  cooldown: number;
  holdT: number;
  stunUntil: number;
}

export interface Rock {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  points: number;
  ufo: boolean;
  hitAt: number;
}

export interface Bullet {
  team: Team;
  x: number;
  y: number;
}

/** 참가 자리로 팀을 나눈다: 2명이면 한 팀(앞자리가 조종), 3~4명이면 왼쪽(1P·3P) 대 오른쪽(2P·4P). 팀에서 번호가 앞인 사람이 조종. */
export function teamSeats(seats: readonly Seat[]): Seat[][] {
  const sorted = [...seats].sort((a, b) => a - b);
  if (sorted.length <= 2) return [sorted];
  return [sorted.filter((s) => s % 2 === 0), sorted.filter((s) => s % 2 === 1)];
}

export function roleOf(seat: Seat, seats: readonly Seat[]): Role {
  const team = teamSeats(seats).find((t) => t.includes(seat))!;
  return team[0] === seat ? 'pilot' : 'gunner';
}

export class TwinShip implements MiniGame {
  readonly code = 'G08';
  t = 0;
  teams: Team[] = [];
  rocks: Rock[] = [];
  bullets: Bullet[] = [];
  coop = false;
  private ctx!: GameContext;
  private done = false;
  private nextId = 0;
  private spawnClock = 0.4;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const groups = teamSeats(ctx.players.map((p) => p.seat));
    this.coop = groups.length === 1;
    // 배는 조종 버튼이 있는 쪽에 둔다: 1~2인은 버튼이 오른쪽 아래라 1P 배가 오른쪽, 3~4인은 1P·3P 팀이 왼쪽
    const firstRight = ctx.humanCount <= 2;
    this.teams = groups.map((g, i) => {
      const left = (i === 0) !== firstRight;
      return {
        side: left ? 'left' : 'right',
        pilot: g[0],
        gunner: g[1] ?? null,
        x: left ? LEFT_X : RIGHT_X,
        y: 90,
        dir: left ? 1 : -1,
        score: 0,
        cooldown: 0,
        holdT: 0,
        stunUntil: -1,
      } satisfies Team;
    });
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

  teamOf(seat: Seat): Team {
    return this.teams.find((t) => t.pilot === seat || t.gunner === seat)!;
  }

  stunned(team: Team): boolean {
    return team.stunUntil > this.t;
  }

  get cleared(): boolean {
    return this.coop && this.teams[0].score >= COOP_TARGET;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.ctx.players.map((p) => [p.seat, this.teamOf(p.seat).score])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    // 팀 점수를 두 사람이 똑같이 받는다. 협동(2인)은 늘 함께.
    return rankByScore(this.ctx.players.map((p) => ({ seat: p.seat, score: this.coop ? 0 : this.teamOf(p.seat).score })));
  }

  /** 운석이 나오는 가로 범위: 배가 다니는 줄까지(배도 운석을 피해야 한다) */
  private fieldX(): [number, number] {
    return [LEFT_X - 8, RIGHT_X + 8];
  }

  private spawn(): void {
    const rng = this.ctx.rng;
    const [x0, x1] = this.fieldX();
    const fromTop = rng.next() < 0.5;
    const roll = rng.next();
    const ufo = roll < 0.12;
    const big = !ufo && roll < 0.32;
    const speed = ufo ? 46 : big ? 22 + rng.next() * 10 : 30 + rng.next() * 20;
    this.rocks.push({
      id: this.nextId++,
      x: x0 + rng.next() * (x1 - x0),
      y: fromTop ? -8 : 188,
      vx: ufo ? 0 : (rng.next() - 0.5) * 10,
      vy: fromTop ? speed : -speed,
      r: big ? 8 : ufo ? 6 : 5,
      hp: big ? 3 : 1,
      points: big || ufo ? 3 : 1,
      ufo,
      hitAt: -1,
    });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;

    for (const team of this.teams) this.steer(team, dt);

    this.spawnClock -= dt;
    if (this.spawnClock <= 0) {
      this.spawnClock += 1 / SPAWN_RATE;
      this.spawn();
    }
    for (const rock of this.rocks) {
      rock.x += rock.vx * dt + (rock.ufo ? Math.cos(this.t * 4 + rock.id) * 40 * dt : 0);
      rock.y += rock.vy * dt;
    }
    this.rocks = this.rocks.filter((rk) => rk.y > -12 && rk.y < 192);
    for (const team of this.teams) this.crash(team);

    const kept: Bullet[] = [];
    for (const b of this.bullets) {
      b.x += b.team.dir * BULLET_SPEED * dt;
      if (b.x < 0 || b.x > 320) continue;
      if (this.hitRock(b) || this.hitShip(b)) continue;
      kept.push(b);
    }
    this.bullets = kept;

    if (this.t >= DURATION) this.done = true;
  }

  private steer(team: Team, dt: number): void {
    team.cooldown = Math.max(0, team.cooldown - dt);
    if (this.stunned(team)) return;
    const pilot = this.ctx.controls.get(team.pilot)!;
    const dy = (pilot.isDown(BTN_DOWN) ? 1 : 0) - (pilot.isDown(BTN_UP) ? 1 : 0);
    team.y = Math.max(SHIP_MIN_Y, Math.min(SHIP_MAX_Y, team.y + dy * SHIP_SPEED * dt));

    if (team.gunner === null) {
      if (team.cooldown <= 0) this.fire(team, AUTO_FIRE);
      return;
    }
    const gun = this.ctx.controls.get(team.gunner)!;
    if (gun.justPressed()) {
      team.holdT = 0;
      if (team.cooldown <= 0) this.fire(team, FIRE_COOLDOWN);
    } else if (gun.isDown()) {
      team.holdT += dt;
      if (team.holdT >= HOLD_REPEAT && team.cooldown <= 0) {
        team.holdT = 0;
        this.fire(team, FIRE_COOLDOWN);
      }
    }
  }

  private fire(team: Team, cooldown: number): void {
    team.cooldown = cooldown;
    this.bullets.push({ team, x: team.x + team.dir * 9, y: team.y });
    this.ctx.sfx.turn();
  }

  private hitRock(b: Bullet): boolean {
    const rock = this.rocks.find((rk) => Math.abs(rk.x - b.x) <= rk.r + 2 && Math.abs(rk.y - b.y) <= rk.r + 1);
    if (!rock) return false;
    rock.hp--;
    rock.hitAt = this.t;
    if (rock.hp <= 0) {
      this.rocks = this.rocks.filter((rk) => rk !== rock);
      b.team.score += rock.points;
      this.ctx.sfx.hit();
      this.ctx.fx.burst(rock.x, rock.y, rock.ufo ? PAL.green : PAL.yellow, rock.r + 3);
    } else {
      this.ctx.sfx.click();
    }
    return true;
  }

  /** 운석·UFO가 배에 부딪히면 그 배는 잠깐 멈추고 팀 점수가 깎인다 */
  private crash(team: Team): void {
    if (this.stunned(team)) return;
    const rock = this.rocks.find((rk) => Math.abs(rk.x - team.x) <= rk.r + 7 && Math.abs(rk.y - team.y) <= rk.r + 5);
    if (!rock) return;
    this.rocks = this.rocks.filter((rk) => rk !== rock);
    team.stunUntil = this.t + CRASH_STUN;
    team.score = Math.max(0, team.score - CRASH_PENALTY);
    this.ctx.sfx.hit();
    this.ctx.fx.shake(3, 0.2);
    this.ctx.fx.burst(team.x, team.y, PAL.red, 10);
  }

  /** 상대 배를 맞히면 잠깐 멈춘다(점수는 없음) */
  private hitShip(b: Bullet): boolean {
    const target = this.teams.find((t) => t !== b.team && Math.abs(t.x - b.x) <= 7 && Math.abs(t.y - b.y) <= 6);
    if (!target) return false;
    target.stunUntil = this.t + STUN_TIME;
    this.ctx.sfx.buzz();
    this.ctx.fx.shake(2, 0.15);
    return true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 별 배경
    for (let i = 0; i < 40; i++) {
      const sx = (i * 73) % 320;
      const sy = (i * 41 + Math.floor(this.t * (8 + (i % 3) * 6))) % 180;
      r.rect(sx, sy, 1, 1, PAL.bgMid);
    }
    for (const rock of this.rocks) {
      const sprite = rock.ufo ? ufoSprite() : rockSprite(rock.r, this.t - rock.hitAt < 0.08);
      r.ctx.drawImage(sprite, Math.round(rock.x - sprite.width / 2), Math.round(rock.y - sprite.height / 2));
    }
    for (const b of this.bullets) {
      r.rect(b.x - 3, b.y - 1, 6, 3, PAL.line);
      r.rect(b.x - 2, b.y, 5, 1, SEAT_COLORS[b.team.gunner ?? b.team.pilot].base);
    }
    for (const team of this.teams) this.drawShip(r, team);

    const flippedHuman = this.ctx.players.some((p) => p.flipped);
    for (const team of this.teams) {
      const x = team.side === 'left' ? 100 : 220;
      const label = this.coop ? `${team.score}/${COOP_TARGET}` : String(team.score);
      this.drawTeamScore(r, team, x, 168, label, false);
      if (flippedHuman) this.drawTeamScore(r, team, x, 4, label, true);
    }
    drawTimer(r, DURATION - this.t, 160, 1);
    if (this.done && this.coop) {
      r.rect(118, 84, 84, 13, PAL.line);
      r.text(this.cleared ? '목표 달성!' : '아쉽다!', 160, 86, this.cleared ? PAL.yellow : PAL.text, 'center');
    }
  }

  private drawTeamScore(r: Renderer, team: Team, x: number, y: number, label: string, flipped: boolean): void {
    facing(r, { flipped }, x, y + 4, () => {
      const w = r.textWidth(label) + 18;
      r.rect(x - w / 2, y - 1, w, 10, PAL.line);
      r.text(label, x + 4, y, PAL.text, 'center');
      const left = x - w / 2 + 2;
      r.rect(left, y + 1, 3, 6, SEAT_COLORS[team.pilot].base);
      r.rect(left + 4, y + 1, 3, 6, SEAT_COLORS[team.gunner ?? team.pilot].base);
    });
  }

  private drawShip(r: Renderer, team: Team): void {
    const stunned = this.stunned(team) && Math.floor(this.t * 12) % 2 === 0;
    const sprite = shipSprite(team.pilot, team.gunner ?? team.pilot, team.dir, stunned);
    r.ctx.drawImage(sprite, Math.round(team.x - sprite.width / 2), Math.round(team.y - sprite.height / 2));
    drawMarker(r, team.x, team.y - 9, SEAT_COLORS[team.pilot].base);
  }
}

const shipCache = new Map<string, HTMLCanvasElement>();

/** 옆에서 본 우주선(앞이 dir 쪽). 몸통은 조종사 색, 포탑은 사수 색 */
function shipSprite(pilot: Seat, gunner: Seat, dir: 1 | -1, stunned: boolean): HTMLCanvasElement {
  const key = `${pilot}|${gunner}|${dir}|${stunned}`;
  const hit = shipCache.get(key);
  if (hit) return hit;
  const g = new Grid(20, 14);
  const base = stunned ? PAL.bgMid : SEAT_COLORS[pilot].base;
  const shadow = stunned ? PAL.bgMid : SEAT_COLORS[pilot].shadow;
  const gun = SEAT_COLORS[gunner];
  const fx = (x: number) => (dir === 1 ? x : 19 - x);
  const row = (x0: number, x1: number, y: number, c: (typeof PAL)[keyof typeof PAL]) => {
    for (let x = x0; x <= x1; x++) g.set(fx(x), y, c);
  };
  row(2, 13, 5, base);
  row(1, 15, 6, base);
  row(1, 17, 7, base);
  row(2, 15, 8, shadow);
  row(4, 12, 9, shadow);
  row(9, 12, 4, PAL.text);
  row(10, 12, 3, PAL.text);
  row(14, 18, 6, gun.base);
  row(14, 18, 7, gun.shadow);
  row(0, 1, 5, PAL.yellow);
  row(0, 1, 8, PAL.yellow);
  row(3, 6, 3, base);
  row(3, 6, 10, shadow);
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  shipCache.set(key, canvas);
  return canvas;
}

const rockCache = new Map<string, HTMLCanvasElement>();

function rockSprite(radius: number, flash: boolean): HTMLCanvasElement {
  const key = `${radius}|${flash}`;
  const hit = rockCache.get(key);
  if (hit) return hit;
  const s = radius * 2 + 3;
  const g = new Grid(s, s);
  g.ellipse(s / 2, s / 2, radius, radius, flash ? PAL.text : PAL.yellowShadow, flash ? PAL.text : PAL.bgMid);
  if (!flash) {
    g.rect(Math.floor(s / 2) - 2, Math.floor(s / 2) - 1, 2, 2, PAL.bgMid);
    if (radius > 6) g.rect(Math.floor(s / 2) + 2, Math.floor(s / 2) + 2, 3, 2, PAL.bgMid);
  }
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  rockCache.set(key, canvas);
  return canvas;
}

let ufoCache: HTMLCanvasElement | null = null;

function ufoSprite(): HTMLCanvasElement {
  if (!ufoCache) {
    const g = new Grid(16, 10);
    g.ellipse(8, 3.5, 3.5, 3, PAL.text);
    g.ellipse(8, 6, 7, 2.5, PAL.green, PAL.greenShadow);
    g.rect(3, 6, 1, 1, PAL.yellow);
    g.rect(8, 7, 1, 1, PAL.yellow);
    g.rect(12, 6, 1, 1, PAL.yellow);
    g.outline(PAL.line);
    ufoCache = g.toCanvas();
  }
  return ufoCache;
}

/** 총알이 운석 x에 닿을 때 운석의 y */
function interceptY(team: Team, rock: Rock): { y: number; eta: number } {
  const eta = Math.abs(rock.x - team.x) / BULLET_SPEED;
  return { y: rock.y + rock.vy * eta, eta };
}

/** 조종 AI: 맞히기 쉬운 운석의 높이로 배를 옮긴다 */
class PilotAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private dir: -1 | 0 | 1 = 0;
  private readonly interval: number;
  private readonly slop: number;
  private readonly dodge: number;

  constructor(
    private readonly game: TwinShip,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.interval = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.17, hard: 0.08 });
    this.slop = byDifficulty(player.difficulty, { easy: 7, normal: 4, hard: 2 });
    this.dodge = byDifficulty(player.difficulty, { easy: 0.5, normal: 0.8, hard: 0.95 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;
    const team = g.teamOf(this.player.seat);
    const ahead = (rk: Rock) => (rk.x - team.x) * team.dir > 10;
    // 배가 다니는 줄로 오는 운석: 그 운석이 지나갈 높이 근처는 피한다
    const threats = g.rocks.filter((rk) => Math.abs(rk.x - team.x) <= rk.r + 10);
    const unsafe = (y: number) =>
      threats.some((rk) => {
        const eta = (y - rk.y) / rk.vy;
        return eta > -0.2 && eta < 1.2 && Math.abs(y - rk.y) < 40 + rk.r;
      });
    const best = g.rocks
      .filter(ahead)
      .map((rk) => {
        const { y } = interceptY(team, rk);
        const travel = Math.abs(y - team.y) / SHIP_SPEED;
        return { rk, y, cost: travel - rk.points * 0.25 };
      })
      .filter((c) => c.y > 14 && c.y < 166 && !unsafe(c.y))
      .sort((a, b) => a.cost - b.cost)[0];
    let targetY = best ? best.y + jitter(g.rng, this.slop) : team.y;
    if (unsafe(team.y) && (!best || this.game.rng.next() < this.dodge)) {
      // 지금 자리가 위험하면 가까운 안전한 높이로
      for (let d = 12; d < 160; d += 12) {
        if (team.y - d > 18 && !unsafe(team.y - d)) {
          targetY = team.y - d;
          break;
        }
        if (team.y + d < 162 && !unsafe(team.y + d)) {
          targetY = team.y + d;
          break;
        }
      }
    }
    let want: -1 | 0 | 1 = 0;
    if (targetY < team.y - 3) want = -1;
    else if (targetY > team.y + 3) want = 1;
    if (want === this.dir) return;
    if (this.dir !== 0) this.hand.releaseIn(this.dir < 0 ? BTN_UP : BTN_DOWN);
    if (want !== 0) this.hand.pressIn(want < 0 ? BTN_UP : BTN_DOWN);
    this.dir = want;
  }
}

/** 사격 AI: 배 높이에서 맞을 운석(또는 상대 배)이 있으면 반응 시간 뒤에 쏜다 */
class GunnerAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private readonly reaction: number;
  private readonly trigger: number;

  constructor(
    private readonly game: TwinShip,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.reaction = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.18, hard: 0.1 });
    this.trigger = byDifficulty(player.difficulty, { easy: 0.55, normal: 0.75, hard: 0.92 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    this.wait -= dt;
    if (this.wait > 0 || this.hand.busy) return;
    this.wait = 0.06;
    const team = g.teamOf(this.player.seat);
    if (team.cooldown > this.reaction || g.stunned(team)) return;
    const lined = g.rocks.some((rk) => {
      if ((rk.x - team.x) * team.dir < 8) return false;
      const { y } = interceptY(team, rk);
      return Math.abs(y - team.y) <= rk.r;
    });
    const enemy = g.teams.find((t) => t !== team && Math.abs(t.y - team.y) < 5);
    if ((lined || enemy) && g.rng.next() < this.trigger) {
      this.hand.tap(0, this.reaction * (0.6 + g.rng.next() * 0.8));
      this.wait = this.reaction + 0.1;
    }
  }
}

export const G08 = defineGame({
  code: 'G08',
  controls: (seat, seats): ControlLayout => (roleOf(seat, seats) === 'pilot' ? 'upDown' : 'one'),
  create: () => new TwinShip(),
  createAI: (game, player, controls) =>
    game.teamOf(player.seat).pilot === player.seat ? new PilotAI(game, player, controls) : new GunnerAI(game, player, controls),
});
