import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import type { ScoreEntry } from '../core/ranking';
import type { Seat } from '../input/seats';
import { rectZone } from '../input/touch';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { DIGIT_SMALL, drawNumber, drawWord, WORD_HEIGHT } from '../ui/bigText';
import { LobbyScene } from './lobby';

const BASELINE = 150;
const MAX_BAR = 80;
const MIN_BAR = 6;
const BAR_W = 40;
const GROW_TIME = 1.2;
const GROW_STEPS = 12;
const TAP_DELAY = 1.2;

/** 결과 막대. 1위 막대 위에서 캐릭터가 승리 포즈, 나머지는 막대 아래에서 패배 포즈. */
export class ResultScene implements Scene {
  private t = 0;
  private revealed = false;
  private revealedAt = 0;
  private leaving = false;
  private readonly winners: Seat[];

  constructor(
    private readonly game: Game,
    private readonly entries: readonly ScoreEntry[],
    ranking: readonly Seat[][],
  ) {
    this.winners = ranking[0] ?? [];
  }

  enter(): void {
    this.game.input.setZones([rectZone(0, { x: 0, y: 0, w: 320, h: 180 })]);
  }

  update(dt: number): void {
    this.t += dt;
    const { audio, fx, input, scenes } = this.game;
    if (!this.revealed && this.t >= GROW_TIME) {
      this.revealed = true;
      this.revealedAt = this.t;
      audio.win();
      fx.shake(3, 0.2);
      this.game.slowmo(0.3);
      for (const seat of this.winners) fx.burst(this.centerX(seat), BASELINE - MAX_BAR - 20, SEAT_COLORS[seat].base, 12);
    }
    for (const e of input.tracker.drain()) {
      if (e.type === 'down' && this.revealed && this.t - this.revealedAt > TAP_DELAY && !this.leaving) {
        this.leaving = true;
        audio.click();
        scenes.goto(new LobbyScene(this.game));
      }
    }
  }

  private centerX(seat: Seat): number {
    const idx = this.entries.findIndex((e) => e.seat === seat);
    return Math.round((320 * (idx + 1)) / (this.entries.length + 1));
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(24, BASELINE, 272, 1, PAL.line);
    const max = Math.max(1, ...this.entries.map((e) => e.score));
    const grow = this.revealed ? 1 : Math.floor((this.t / GROW_TIME) * GROW_STEPS) / GROW_STEPS;

    for (const { seat, score } of this.entries) {
      const c = SEAT_COLORS[seat];
      const cx = this.centerX(seat);
      const x = cx - BAR_W / 2;
      const full = Math.max(MIN_BAR, Math.round((score / max) * MAX_BAR));
      const h = Math.max(1, Math.round(full * grow));
      const top = BASELINE - h;
      r.rect(x - 1, top - 1, BAR_W + 2, h + 1, PAL.line);
      r.rect(x, top, BAR_W, h, c.base);
      r.rect(x + BAR_W - 5, top, 5, h, c.shadow);

      const win = this.revealed && this.winners.includes(seat);
      const since = this.t - this.revealedAt;
      if (win) {
        drawCharacter(r.ctx, seat, 'win', since, cx - CHAR_SIZE / 2, top - CHAR_SIZE + 1);
      } else if (this.revealed) {
        drawCharacter(r.ctx, seat, 'lose', since, cx - CHAR_SIZE / 2, BASELINE - CHAR_SIZE);
      } else {
        drawCharacter(r.ctx, seat, 'move', this.t, cx - CHAR_SIZE / 2, top - CHAR_SIZE + 1);
      }

      if (this.revealed) {
        const numY = (win ? top - CHAR_SIZE : top) - DIGIT_SMALL.h - 3;
        drawNumber(r, String(score), cx, numY, DIGIT_SMALL, PAL.text, { align: 'center' });
        if (win) drawWord(r, 'WIN', cx, numY - WORD_HEIGHT - 3, PAL.text, { shadow: PAL.line, align: 'center' });
      }
      r.text(`${seat + 1}P`, cx, BASELINE + 8, c.base, 'center');
    }

    if (this.revealed && this.t - this.revealedAt > TAP_DELAY && Math.floor(this.t * 2) % 2 === 0) {
      r.text('탭하면 로비로', 160, 168, PAL.text, 'center');
    }
  }
}
