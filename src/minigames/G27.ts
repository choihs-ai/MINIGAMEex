import { BTN_LEFT, BTN_RIGHT, type PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import { Grid } from '../render/grid';
import { PAL, type SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { AiHand, byDifficulty, jitter } from './ai';
import { drawTimer } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G27 탱크 대전: 탱크는 저절로 앞으로 가고, 왼쪽 버튼을 누르고 있으면 제자리에서 돈다. 오른쪽 버튼은 발사.
// 포탄은 벽에 튕긴다(튕긴 포탄은 내 탱크도 맞는다). 3번 맞으면 탈락. 끝까지 남으면 남은 체력이 많은 순.

export const DURATION = 30;
export const TANK_R = 6;
export const DRIVE_SPEED = 36;
export const TURN_SPEED = 3.4;
export const BULLET_SPEED = 120;
export const BULLET_LIFE = 2.4;
export const MAX_BOUNCES = 3;
export const FIRE_COOLDOWN = 0.6;
export const MAX_BULLETS = 3;
export const HP = 3;
const INVULN = 0.6;
export const ROTATE = BTN_LEFT;
export const FIRE = BTN_RIGHT;

/** 벽: 모서리(버튼 자리) 넷 + 가운데 십자 조각 */
export const WALLS: readonly Rect[] = [
  { x: 0, y: 0, w: 88, h: 44 },
  { x: 232, y: 0, w: 88, h: 44 },
  { x: 0, y: 136, w: 88, h: 44 },
  { x: 232, y: 136, w: 88, h: 44 },
  { x: 150, y: 80, w: 20, h: 20 },
  { x: 98, y: 85, w: 32, h: 10 },
  { x: 190, y: 85, w: 32, h: 10 },
  { x: 155, y: 30, w: 10, h: 30 },
  { x: 155, y: 120, w: 10, h: 30 },
];

export function inWall(x: number, y: number, pad = 0): boolean {
  if (x < pad || y < pad || x >= 320 - pad || y >= 180 - pad) return true;
  return WALLS.some((w) => x >= w.x - pad && x < w.x + w.w + pad && y >= w.y - pad && y < w.y + w.h + pad);
}

export interface Tank {
  seat: Seat;
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  outAt: number | null;
  cooldown: number;
  hitAt: number;
  rotating: boolean;
}

export interface Shell {
  owner: Seat;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  bounces: number;
}

function startOf(seat: Seat, twoPlayer: boolean): { x: number; y: number; angle: number } {
  if (twoPlayer) return seat === 0 ? { x: 160, y: 164, angle: -Math.PI / 2 } : { x: 160, y: 16, angle: Math.PI / 2 };
  return [
    { x: 110, y: 58, angle: 0 },
    { x: 210, y: 58, angle: Math.PI },
    { x: 110, y: 122, angle: 0 },
    { x: 210, y: 122, angle: Math.PI },
  ][seat];
}

/** 한 단계 움직인 포탄(벽에 닿으면 그 축으로 튕긴다). 실제 진행과 AI 예측이 같은 계산을 쓴다. */
export function advanceShell(s: { x: number; y: number; vx: number; vy: number; bounces: number }, dt: number): void {
  const nx = s.x + s.vx * dt;
  const ny = s.y + s.vy * dt;
  if (!inWall(nx, ny)) {
    s.x = nx;
    s.y = ny;
    return;
  }
  const hitX = inWall(nx, s.y);
  const hitY = inWall(s.x, ny);
  if (hitX || !hitY) s.vx = -s.vx;
  if (hitY || !hitX) s.vy = -s.vy;
  s.bounces++;
}

export class TankBattle implements MiniGame {
  readonly code = 'G27';
  t = 0;
  tanks: Tank[] = [];
  shells: Shell[] = [];
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const two = ctx.players.length === 2;
    this.tanks = ctx.players.map((p) => {
      const s = startOf(p.seat, two);
      return { seat: p.seat, ...s, hp: HP, alive: true, outAt: null, cooldown: 0.5, hitAt: -9, rotating: false };
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

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.tanks.map((t) => [t.seat, t.hp])) as Partial<Record<Seat, number>>;
  }

  /** 살아남은 사람은 남은 체력 순, 탈락한 사람은 늦게 떨어진 순 */
  getRanking(): Seat[][] {
    const groups: Seat[][] = [];
    const alive = this.tanks.filter((t) => t.alive).sort((a, b) => b.hp - a.hp || a.seat - b.seat);
    let last: number | null = null;
    for (const t of alive) {
      if (t.hp === last) groups[groups.length - 1].push(t.seat);
      else groups.push([t.seat]);
      last = t.hp;
    }
    const out = this.tanks.filter((t) => !t.alive).sort((a, b) => b.outAt! - a.outAt! || a.seat - b.seat);
    last = null;
    for (const t of out) {
      if (t.outAt === last) groups[groups.length - 1].push(t.seat);
      else groups.push([t.seat]);
      last = t.outAt;
    }
    return groups;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    for (const tank of this.tanks) if (tank.alive) this.drive(tank, dt);
    this.separate();

    const kept: Shell[] = [];
    for (const s of this.shells) {
      s.age += dt;
      const sub = 3;
      let gone = false;
      for (let i = 0; i < sub && !gone; i++) {
        advanceShell(s, dt / sub);
        if (s.bounces > MAX_BOUNCES) gone = true;
        else if (this.hitTank(s)) gone = true;
      }
      if (!gone && s.age < BULLET_LIFE) kept.push(s);
    }
    this.shells = kept;

    const alive = this.tanks.filter((t) => t.alive).length;
    if (this.t >= DURATION || (this.tanks.length > 1 && alive <= 1)) this.done = true;
  }

  private drive(tank: Tank, dt: number): void {
    const c = this.ctx.controls.get(tank.seat)!;
    tank.cooldown = Math.max(0, tank.cooldown - dt);
    tank.rotating = c.isDown(ROTATE);
    if (tank.rotating) {
      tank.angle += TURN_SPEED * dt;
    } else {
      const nx = tank.x + Math.cos(tank.angle) * DRIVE_SPEED * dt;
      const ny = tank.y + Math.sin(tank.angle) * DRIVE_SPEED * dt;
      // 벽에 막히면 미끄러지듯 한 축만 움직인다
      if (!inWall(nx, tank.y, TANK_R)) tank.x = nx;
      if (!inWall(tank.x, ny, TANK_R)) tank.y = ny;
    }
    const mine = this.shells.filter((s) => s.owner === tank.seat).length;
    if (c.justPressed(FIRE) && tank.cooldown <= 0 && mine < MAX_BULLETS) {
      tank.cooldown = FIRE_COOLDOWN;
      const mx = tank.x + Math.cos(tank.angle) * (TANK_R + 3);
      const my = tank.y + Math.sin(tank.angle) * (TANK_R + 3);
      if (inWall(mx, my)) return;
      this.shells.push({
        owner: tank.seat,
        x: mx,
        y: my,
        vx: Math.cos(tank.angle) * BULLET_SPEED,
        vy: Math.sin(tank.angle) * BULLET_SPEED,
        age: 0,
        bounces: 0,
      });
      this.ctx.sfx.click();
    }
  }

  private separate(): void {
    const alive = this.tanks.filter((t) => t.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= TANK_R * 2 || d === 0) continue;
        const push = (TANK_R * 2 - d) / 2;
        const ax = a.x - (dx / d) * push;
        const ay = a.y - (dy / d) * push;
        const bx = b.x + (dx / d) * push;
        const by = b.y + (dy / d) * push;
        if (!inWall(ax, ay, TANK_R)) {
          a.x = ax;
          a.y = ay;
        }
        if (!inWall(bx, by, TANK_R)) {
          b.x = bx;
          b.y = by;
        }
      }
    }
  }

  /** 포탄이 탱크에 닿았는가. 내 포탄은 한 번 튕긴 뒤부터 나도 맞는다. */
  private hitTank(s: Shell): boolean {
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      if (tank.seat === s.owner && s.bounces === 0) continue;
      if (Math.hypot(tank.x - s.x, tank.y - s.y) > TANK_R + 1) continue;
      if (this.t - tank.hitAt < INVULN) return true;
      tank.hp--;
      tank.hitAt = this.t;
      this.ctx.sfx.hit();
      this.ctx.fx.shake(2, 0.12);
      const p = this.ctx.players.find((pl) => pl.seat === tank.seat)!;
      this.ctx.fx.burst(tank.x, tank.y, p.color.base, 8);
      if (tank.hp <= 0) {
        tank.alive = false;
        tank.outAt = this.t;
        this.ctx.sfx.lose();
        this.ctx.fx.burst(tank.x, tank.y, PAL.yellow, 14);
      }
      return true;
    }
    return false;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (let x = 4; x < 320; x += 16) for (let y = 4; y < 180; y += 16) r.rect(x, y, 1, 1, PAL.bgMid);
    for (const w of WALLS) {
      r.rect(w.x, w.y, w.w, w.h, PAL.line);
      r.frame(w.x, w.y, w.w, w.h, PAL.bgMid);
    }
    r.frame(0, 0, 320, 180, PAL.bgMid);
    for (const tank of this.tanks) this.drawTank(r, tank);
    for (const s of this.shells) {
      r.rect(s.x - 2, s.y - 2, 4, 4, PAL.line);
      r.rect(s.x - 1, s.y - 1, 2, 2, PAL.text);
    }
    drawTimer(r, DURATION - this.t, 160, 1);
  }

  private drawTank(r: Renderer, tank: Tank): void {
    const p = this.ctx.players.find((pl) => pl.seat === tank.seat)!;
    if (!tank.alive) {
      r.rect(tank.x - 5, tank.y - 4, 10, 8, PAL.line);
      r.rect(tank.x - 4, tank.y - 3, 8, 6, PAL.bgMid);
      return;
    }
    if (this.t - tank.hitAt < INVULN && Math.floor(this.t * 16) % 2 === 0) return;
    const frame = Math.round(((tank.angle % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 8)) % 16;
    const sprite = tankSprite(p.color, frame);
    r.ctx.drawImage(sprite, Math.round(tank.x - sprite.width / 2), Math.round(tank.y - sprite.height / 2));
    // 체력 칸
    for (let i = 0; i < HP; i++) {
      r.rect(tank.x - 6 + i * 4, tank.y - 12, 3, 3, PAL.line);
      if (i < tank.hp) r.rect(tank.x - 5 + i * 4, tank.y - 11, 1, 1, p.color.base);
    }
  }
}

const tankCache = new Map<string, HTMLCanvasElement>();

/** 위에서 본 탱크(16방향). 몸통 원 + 포신 */
function tankSprite(color: SeatColor, frame: number): HTMLCanvasElement {
  const key = `${color.base}|${frame}`;
  const hit = tankCache.get(key);
  if (hit) return hit;
  const g = new Grid(21, 21);
  const a = (frame * Math.PI) / 8;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // 궤도(몸통 양옆)
  for (let k = -5; k <= 5; k++) {
    for (const side of [-5, 5]) {
      g.set(10.5 + c * k - s * side - 0.5, 10.5 + s * k + c * side - 0.5, PAL.bgMid);
    }
  }
  g.ellipse(10.5, 10.5, 4.6, 4.6, color.base, color.shadow);
  for (let k = 2; k <= 9; k++) g.set(10.5 + c * k - 0.5, 10.5 + s * k - 0.5, PAL.text);
  g.ellipse(10.5, 10.5, 2, 2, color.shadow);
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  tankCache.set(key, canvas);
  return canvas;
}

/**
 * 지금 쏘면 상대에게 맞을지(벽에 튕기는 길까지) 미리 그려 보고 쏜다. 난이도가 높을수록 튕기는 길을 많이 본다.
 * 쏠 길이 없으면 돌면서 찾고, 가끔 앞으로 달려 자리를 바꾼다.
 */
class TankAI implements AiController {
  private readonly hand: AiHand;
  private wait = 0;
  private mode: 'drive' | 'rotate' = 'rotate';
  private modeLeft = 0.6;
  private readonly bounces: number;
  private readonly interval: number;
  private readonly aimError: number;

  constructor(
    private readonly game: TankBattle,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.bounces = byDifficulty(player.difficulty, { easy: 0, normal: 1, hard: 2 });
    this.interval = byDifficulty(player.difficulty, { easy: 0.18, normal: 0.1, hard: 0.05 });
    this.aimError = byDifficulty(player.difficulty, { easy: 0.12, normal: 0.06, hard: 0.03 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    const me = g.tanks.find((t) => t.seat === this.player.seat)!;
    if (!me.alive) {
      this.hand.reset();
      return;
    }
    this.modeLeft -= dt;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.interval;
    const rng = g.rng;

    if (me.cooldown <= 0 && this.wouldHit(me, me.angle + jitter(rng, this.aimError))) {
      this.hand.tap(FIRE, 0, 0.04);
    }
    // 앞이 막혔으면 돈다
    const ahead = inWall(me.x + Math.cos(me.angle) * 14, me.y + Math.sin(me.angle) * 14, TANK_R);
    if (this.modeLeft <= 0 || (ahead && this.mode === 'drive')) {
      this.mode = ahead || this.mode === 'drive' ? 'rotate' : 'drive';
      this.modeLeft = this.mode === 'rotate' ? 0.3 + rng.next() * 1.4 : 0.4 + rng.next() * 0.9;
    }
    const rotating = this.mode === 'rotate';
    if (rotating !== me.rotating) {
      if (rotating) this.hand.pressIn(ROTATE);
      else this.hand.releaseIn(ROTATE);
    }
  }

  /** angle로 쏜 포탄이 튕김 수 안에서 상대에게 닿고, 나에게 돌아오지 않는가 */
  private wouldHit(me: Tank, angle: number): boolean {
    const g = this.game;
    const s = {
      x: me.x + Math.cos(angle) * (TANK_R + 3),
      y: me.y + Math.sin(angle) * (TANK_R + 3),
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
      bounces: 0,
    };
    if (inWall(s.x, s.y)) return false;
    const step = 1 / 90;
    for (let t = 0; t < BULLET_LIFE; t += step) {
      advanceShell(s, step);
      if (s.bounces > this.bounces) return false;
      if (s.bounces > 0 && Math.hypot(me.x - s.x, me.y - s.y) < TANK_R + 4) return false;
      for (const o of g.tanks) {
        if (o === me || !o.alive) continue;
        if (Math.hypot(o.x - s.x, o.y - s.y) < TANK_R + 2) return true;
      }
    }
    return false;
  }
}

/** 버튼 그림: 회전 화살표 / 포탄 */
const padIcons = new Map<number, HTMLCanvasElement>();
function padIcon(index: number): HTMLCanvasElement {
  let c = padIcons.get(index);
  if (c) return c;
  const g = new Grid(11, 11);
  if (index === ROTATE) {
    for (let a = 0.4; a < Math.PI * 1.7; a += 0.12) g.set(5 + Math.cos(a) * 4, 5 + Math.sin(a) * 4, PAL.text);
    g.rect(8, 0, 3, 1, PAL.text);
    g.rect(10, 0, 1, 3, PAL.text);
  } else {
    g.ellipse(5.5, 5.5, 3.5, 3.5, PAL.text);
  }
  c = g.toCanvas();
  padIcons.set(index, c);
  return c;
}

export const G27 = defineGame({
  code: 'G27',
  controls: 'leftRight',
  padStyle: (_seat, index) => ({ icon: padIcon(index) }),
  create: () => new TankBattle(),
  createAI: (game, player, controls) => new TankAI(game, player, controls),
});
