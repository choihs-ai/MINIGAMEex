import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import type { Seat } from '../input/seats';
import { rectZone } from '../input/touch';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { DIGIT_SMALL, drawNumber, drawWord, WORD_HEIGHT } from '../ui/bigText';

export interface ResultAction {
  label: string;
  next: () => Scene;
}

export interface ResultRow {
  seat: Seat;
  /** 이 판의 점수(없으면 숫자를 안 보여준다) */
  score: number | null;
  isAI: boolean;
}

const BASELINE = 136;
const MAX_BAR = 72;
const MIN_BAR = 8;
const BAR_W = 40;
const GROW_TIME = 1.2;
const GROW_STEPS = 12;
const TAP_DELAY = 1.0;
const ACTION_W = 48;
const ACTION_H = 15;
const ACTION_Y = 160;

const actionRect = (i: number, n: number) => ({
  x: 160 - (n * ACTION_W + (n - 1) * 10) / 2 + i * (ACTION_W + 10),
  y: ACTION_Y,
  w: ACTION_W,
  h: ACTION_H,
});

/**
 * 결과 막대. 막대 높이는 순위로 정하고, 1위(공동 포함) 막대 위 캐릭터는 승리 포즈, 나머지는 막대 아래에서 패배 포즈.
 * 1인 모드에서는 AI를 CPU로 표시하고 사람만 강조한다. 아래 버튼(다시/메뉴 등)으로 다음 화면을 고른다.
 */
export class ResultScene implements Scene {
  private t = 0;
  private revealed = false;
  private revealedAt = 0;
  private leaving = false;
  private pressed = -1;
  private readonly rows: ResultRow[];

  constructor(
    private readonly game: Game,
    rows: readonly ResultRow[],
    private readonly ranking: readonly Seat[][],
    private readonly actions: readonly ResultAction[],
  ) {
    this.rows = [...rows].sort((a, b) => a.seat - b.seat);
  }

  enter(): void {
    this.game.input.setZones(this.actions.map((_, i) => rectZone(i, actionRect(i, this.actions.length))));
  }

  private rankIndex(seat: Seat): number {
    return this.ranking.findIndex((g) => g.includes(seat));
  }

  private isWinner(seat: Seat): boolean {
    return this.rankIndex(seat) === 0;
  }

  update(dt: number): void {
    this.t += dt;
    const { audio, fx, input, scenes } = this.game;
    if (!this.revealed && this.t >= GROW_TIME) {
      this.revealed = true;
      this.revealedAt = this.t;
      const humanWon = this.rows.some((r) => !r.isAI && this.isWinner(r.seat));
      if (humanWon || this.rows.every((r) => !r.isAI)) audio.win();
      else audio.lose();
      fx.shake(3, 0.2);
      this.game.slowmo(0.3);
      for (const row of this.rows) {
        if (this.isWinner(row.seat)) fx.burst(this.centerX(row.seat), BASELINE - MAX_BAR - 20, SEAT_COLORS[row.seat].base, 12);
      }
    }
    const ready = this.revealed && this.t - this.revealedAt > TAP_DELAY;
    for (const e of input.tracker.drain()) {
      if (!ready || this.leaving) continue;
      if (e.type === 'down') {
        this.pressed = e.touch.zone;
        audio.click();
      } else if (e.type === 'up' && e.touch.zone === this.pressed) {
        this.leaving = true;
        scenes.goto(this.actions[this.pressed].next());
      }
    }
  }

  private centerX(seat: Seat): number {
    const idx = this.rows.findIndex((e) => e.seat === seat);
    return Math.round((320 * (idx + 1)) / (this.rows.length + 1));
  }

  private barHeight(seat: Seat): number {
    const groups = Math.max(1, this.ranking.length);
    const idx = Math.max(0, this.rankIndex(seat));
    return Math.max(MIN_BAR, Math.round((MAX_BAR * (groups - idx)) / groups));
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    r.rect(24, BASELINE, 272, 1, PAL.line);
    const grow = this.revealed ? 1 : Math.floor((this.t / GROW_TIME) * GROW_STEPS) / GROW_STEPS;
    const soloMode = this.rows.some((row) => row.isAI);

    for (const { seat, score, isAI } of this.rows) {
      const c = SEAT_COLORS[seat];
      const cx = this.centerX(seat);
      const x = cx - BAR_W / 2;
      const h = Math.max(1, Math.round(this.barHeight(seat) * grow));
      const top = BASELINE - h;
      r.rect(x - 1, top - 1, BAR_W + 2, h + 1, PAL.line);
      r.rect(x, top, BAR_W, h, c.base);
      r.rect(x + BAR_W - 5, top, 5, h, c.shadow);

      const win = this.revealed && this.isWinner(seat);
      const since = this.t - this.revealedAt;
      if (win) drawCharacter(r.ctx, seat, 'win', since, cx - CHAR_SIZE / 2, top - CHAR_SIZE + 1);
      else if (this.revealed) drawCharacter(r.ctx, seat, 'lose', since, cx - CHAR_SIZE / 2, BASELINE - CHAR_SIZE);
      else drawCharacter(r.ctx, seat, 'move', this.t, cx - CHAR_SIZE / 2, top - CHAR_SIZE + 1);

      if (this.revealed) {
        let y = (win ? top - CHAR_SIZE : top) - 3;
        if (score !== null) {
          y -= DIGIT_SMALL.h;
          drawNumber(r, String(score), cx, y, DIGIT_SMALL, PAL.text, { align: 'center' });
          y -= 3;
        }
        if (win) drawWord(r, 'WIN', cx, y - WORD_HEIGHT, PAL.text, { shadow: PAL.line, align: 'center' });
      }
      const label = isAI ? 'CPU' : `${seat + 1}P`;
      if (soloMode && !isAI) r.frame(cx - 12, BASELINE + 5, 24, 13, c.base);
      r.text(label, cx, BASELINE + 7, isAI ? c.shadow : c.base, 'center');
    }

    if (this.revealed && this.t - this.revealedAt > TAP_DELAY) {
      this.actions.forEach((a, i) => {
        const b = actionRect(i, this.actions.length);
        const dy = this.pressed === i ? 2 : 0;
        r.rect(b.x, b.y + 2, b.w, b.h, PAL.line);
        r.rect(b.x, b.y + dy, b.w, b.h, PAL.line);
        r.rect(b.x + 1, b.y + 1 + dy, b.w - 2, b.h - 2, i === 0 ? PAL.text : PAL.bgMid);
        r.text(a.label, b.x + b.w / 2, b.y + 3 + dy, i === 0 ? PAL.line : PAL.text, 'center');
      });
    }
  }
}
