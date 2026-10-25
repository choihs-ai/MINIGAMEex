import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { DIGIT_BIG, drawNumber, drawWord, WORD_HEIGHT } from '../ui/bigText';
import { padButtons } from '../input/padButtons';
import type { PlayerSlot, Seat } from '../input/seats';
import { drawPadButtons } from '../minigames/common';
import { buildPlayers } from '../minigames/players';
import { GAMES } from '../minigames/registry';
import { controlLayout } from '../minigames/types';
import { gameIcon, ICON_SIZE } from '../ui/icons';

const STEP_TIME = 0.8;
/** 3 → 2 → 1 → GO! */
const STEPS = ['3', '2', '1', 'GO!'] as const;

/** 미니게임 아이콘만 보여주고 `3, 2, 1` 후 바로 시작(이름·설명 없음). 아이콘은 각자 자기 쪽에서 바로 보이게 그린다. */
export class CountdownScene implements Scene {
  private t = 0;
  private step = -1;
  private left = false;

  constructor(
    private readonly game: Game,
    private readonly code: string,
    private readonly next: () => Scene,
    /** 이 판에 참가하는 사람(없으면 전원) */
    private readonly slots?: readonly PlayerSlot[],
  ) {}

  enter(): void {
    this.game.input.setZones([]);
  }

  update(dt: number): void {
    this.t += dt;
    const step = Math.min(STEPS.length - 1, Math.floor(this.t / STEP_TIME));
    if (step !== this.step) {
      this.step = step;
      if (step < 3) this.game.audio.beep();
      else this.game.audio.go();
      this.game.fx.shake(2, 0.1);
    }
    if (this.t >= STEP_TIME * STEPS.length && !this.left) {
      this.left = true;
      this.game.scenes.goto(this.next());
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const { session } = this.game;
    const humans = this.slots ?? session.players;
    // 각자 누를 버튼을 미리 보여준다. 화면을 직접 만지는 게임은 자기 구역을 테두리로 알려 준다.
    const entry = GAMES[this.code];
    const players = buildPlayers(humans, session.difficulty);
    const seats = players.map((p) => p.seat);
    const layoutOf = (seat: Seat) => controlLayout(entry, seat, seats);
    if (humans.length > 1 && (entry.pointer ?? 'area') === 'area') {
      for (const h of humans) {
        if (layoutOf(h.seat) !== 'pointer') continue;
        r.frame(h.zone.x + 1, h.zone.y + 1, h.zone.w - 2, h.zone.h - 2, SEAT_COLORS[h.seat].base);
      }
    }
    drawPadButtons(r, padButtons(humans, layoutOf), players, null, this.t, { style: entry.padStyle });
    // 게임 아이콘(이름·설명 없음): 가운데 위, 위쪽에 앉은 사람용으로 180도 돌린 것을 아래에
    const drawIcon = (y: number) => {
      const ix = 160 - ICON_SIZE / 2;
      r.rect(ix - 3, y - 3, ICON_SIZE + 6, ICON_SIZE + 6, PAL.line);
      r.frame(ix - 3, y - 3, ICON_SIZE + 6, ICON_SIZE + 6, PAL.text);
      r.ctx.drawImage(gameIcon(this.code), ix, y);
    };
    drawIcon(36);
    if (humans.some((p) => p.flipped)) r.rotated180(144, 128, 32, 32, () => drawIcon(136));
    const cx = 160;
    const cy = 90;
    const text = STEPS[Math.max(0, this.step)];
    if (text === 'GO!') {
      drawWord(r, text, cx, cy - Math.floor(WORD_HEIGHT / 2), PAL.yellow, { shadow: PAL.line, align: 'center' });
    } else {
      drawNumber(r, text, cx, cy - DIGIT_BIG.h / 2, DIGIT_BIG, PAL.text, { shadow: PAL.line, align: 'center' });
    }
  }
}
