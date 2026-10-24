import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { cornerRect, layoutPlayers, SEATS, type Rect, type Seat } from '../input/seats';
import { circleZone, rectZone } from '../input/touch';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawArcadeButton, drawRingGauge } from '../ui/arcadeButton';
import { drawCharacter, CHAR_SIZE } from '../ui/characters';
import { CountdownScene } from './countdown';

const CENTER = 4;
const BTN_X = 160;
const BTN_Y = 90;
const BTN_R = 14;
/** 참가자 전원이 가운데 버튼을 누르고 있어야 하는 시간(초) */
const HOLD_TIME = 1.6;
const JOIN_POP = 0.5;

const panelRect = (seat: Seat): Rect => {
  const c = cornerRect(seat);
  return { x: c.x + 4, y: c.y + 4, w: c.w - 8, h: c.h - 8 };
};

/** "동전 넣기": 각자 자기 모서리를 탭해 참가하고, 모인 사람 전원이 가운데 버튼을 꾹 누르면 시작. */
export class LobbyScene implements Scene {
  private t = 0;
  private hold = 0;
  private lastStep = 0;
  private starting = false;
  private readonly joinedAt = new Map<Seat, number>();

  constructor(private readonly game: Game) {}

  enter(): void {
    const { input, session } = this.game;
    // 결과 화면에서 돌아왔을 때 참가자는 유지한다.
    session.joined.forEach((s) => this.joinedAt.set(s, -10));
    input.setZones([circleZone(CENTER, BTN_X, BTN_Y, BTN_R + 8), ...SEATS.map((s) => rectZone(s, cornerRect(s)))]);
  }

  update(dt: number): void {
    this.t += dt;
    const { input, audio, fx, session } = this.game;
    for (const e of input.tracker.drain()) {
      if (e.type !== 'down' || e.touch.zone === CENTER) continue;
      const seat = e.touch.zone as Seat;
      if (session.joined.includes(seat)) {
        audio.click();
        continue;
      }
      session.joined.push(seat);
      this.joinedAt.set(seat, this.t);
      audio.coin();
      audio.character(seat);
      fx.shake(2);
      const p = panelRect(seat);
      fx.burst(p.x + p.w / 2, p.y + p.h / 2, SEAT_COLORS[seat].base, 10);
    }

    const n = session.joined.length;
    const holding = n > 0 && input.tracker.count(CENTER) >= n;
    if (this.starting) return;
    if (holding) this.hold = Math.min(1, this.hold + dt / HOLD_TIME);
    else this.hold = Math.max(0, this.hold - dt * 2);

    const step = Math.floor(this.hold * 4);
    if (step > this.lastStep) audio.charge(step);
    this.lastStep = step;

    if (this.hold >= 1) {
      this.starting = true;
      session.players = layoutPlayers(session.joined);
      audio.go();
      this.game.scenes.goto(new CountdownScene(this.game));
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (const seat of SEATS) this.drawPanel(r, seat);
    this.drawStart(r);
  }

  private drawPanel(r: Renderer, seat: Seat): void {
    const { session } = this.game;
    const p = panelRect(seat);
    const color = SEAT_COLORS[seat];
    const joined = session.joined.includes(seat);
    const flipped = seat < 2;
    r.rect(p.x, p.y, p.w, p.h, joined ? PAL.bgMid : PAL.bgDark);
    r.frame(p.x, p.y, p.w, p.h, joined ? color.base : color.shadow);
    r.frame(p.x + 1, p.y + 1, p.w - 2, p.h - 2, PAL.line);

    const draw = () => {
      const cx = p.x + Math.floor(p.w / 2);
      if (joined) {
        const since = this.t - (this.joinedAt.get(seat) ?? -10);
        const popping = since < JOIN_POP;
        drawCharacter(r.ctx, seat, popping ? 'win' : 'idle', popping ? since : this.t, cx - CHAR_SIZE / 2, p.y + 12);
        r.text(`${seat + 1}P`, cx, p.y + 44, color.base, 'center');
      } else {
        if (Math.floor(this.t * 2) % 2 === 0) r.text('동전 넣기', cx, p.y + 22, PAL.text, 'center');
        r.text('여기를 탭', cx, p.y + 38, color.shadow, 'center');
      }
    };
    if (flipped) r.rotated180(p.x, p.y, p.w, p.h, draw);
    else draw();
  }

  private drawStart(r: Renderer): void {
    const n = this.game.session.joined.length;
    const holding = this.game.input.tracker.count(CENTER);
    const ready = n > 0;
    if (ready) {
      // 위·아래에 앉은 사람이 모두 읽을 수 있게 글자를 두 방향으로 놓는다.
      const label = '모두 꾹!';
      const w = r.textWidth(label);
      const down = () => {
        r.rect(BTN_X - w / 2 - 2, BTN_Y + BTN_R + 6, w + 4, 11, PAL.bgDark);
        r.text(label, BTN_X, BTN_Y + BTN_R + 8, PAL.text, 'center');
      };
      down();
      r.rotated180(BTN_X - 30, BTN_Y - BTN_R - 17, 60, 11, down);
    }
    drawRingGauge(r, BTN_X, BTN_Y, BTN_R + 5, this.hold);
    const color = ready ? { base: PAL.text, shadow: PAL.bgMid } : { base: PAL.bgMid, shadow: PAL.line };
    drawArcadeButton(r, BTN_X, BTN_Y, BTN_R, color, holding > 0);
    if (ready) r.text(`${Math.min(holding, n)}/${n}`, BTN_X, BTN_Y - 4, PAL.bgDark, 'center');
  }
}
