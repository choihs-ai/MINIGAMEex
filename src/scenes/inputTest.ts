import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { rankByScore } from '../core/ranking';
import type { Seat } from '../input/seats';
import { rectZone } from '../input/touch';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { DIGIT_BIG, DIGIT_SMALL, drawNumber } from '../ui/bigText';
import { inSeat } from '../ui/seatDraw';
import { LobbyScene } from './lobby';
import { ResultScene } from './result';

const DURATION = 15;

/**
 * 2단계 확인용 임시 판(미니게임이 아님): 각자 구역을 눌러 탭 수를 센다.
 * 4명이 동시에 눌렀을 때 입력이 각자 구역으로 정확히 들어가는지 눈으로 본다.
 */
export class InputTestScene implements Scene {
  private left = DURATION;
  private readonly taps = new Map<Seat, number>();
  private done = false;

  constructor(private readonly game: Game) {}

  enter(): void {
    const { input, session } = this.game;
    session.players.forEach((p) => this.taps.set(p.seat, 0));
    input.setZones(session.players.map((p) => rectZone(p.seat, p.zone)));
  }

  update(dt: number): void {
    const { input, audio, fx } = this.game;
    this.left = Math.max(0, this.left - dt);
    for (const e of input.tracker.drain()) {
      if (e.type !== 'down') continue;
      const seat = e.touch.zone as Seat;
      this.taps.set(seat, (this.taps.get(seat) ?? 0) + 1);
      audio.tap();
      fx.shake(2, 0.08);
      fx.burst(e.touch.x, e.touch.y, SEAT_COLORS[seat].base, 6);
    }
    if (this.left <= 0 && !this.done) {
      this.done = true;
      const entries = [...this.taps].map(([seat, score]) => ({ seat, score }));
      const rows = entries.map((e) => ({ ...e, isAI: false }));
      this.game.scenes.goto(new ResultScene(this.game, rows, rankByScore(entries), () => new LobbyScene(this.game)));
    }
  }

  render(r: Renderer): void {
    const { session, input } = this.game;
    r.clear(PAL.bgDark);
    for (const slot of session.players) {
      const z = slot.zone;
      const c = SEAT_COLORS[slot.seat];
      r.frame(z.x + 2, z.y + 2, z.w - 4, z.h - 4, c.shadow);
      inSeat(r, slot, () => {
        r.text(`${slot.seat + 1}P`, z.x + 8, z.y + 8, c.base);
        r.text(`손가락 ${input.tracker.touchesIn(slot.seat).length}`, z.x + z.w - 8, z.y + 8, PAL.text, 'right');
        const text = String(this.taps.get(slot.seat) ?? 0);
        drawNumber(r, text, z.x + z.w / 2, z.y + z.h / 2 - DIGIT_BIG.h / 2, DIGIT_BIG, c.base, { shadow: c.shadow, align: 'center' });
        r.text('눌러 보세요', z.x + z.w / 2, z.y + z.h - 16, PAL.text, 'center');
      });
    }
    // 눌린 손가락 위치(구역 밖으로 끌려가도 시작한 사람 색)
    for (const t of input.tracker.all()) {
      const c = SEAT_COLORS[t.zone];
      r.rect(t.x - 5, t.y - 5, 11, 11, PAL.line);
      r.rect(t.x - 4, t.y - 4, 9, 9, c.base);
      r.rect(t.x - 1, t.y - 1, 3, 3, PAL.text);
    }
    r.rect(160 - 10, 0, 20, 17, PAL.line);
    drawNumber(r, String(Math.ceil(this.left)), 160, 3, DIGIT_SMALL, PAL.text, { align: 'center' });
  }
}
