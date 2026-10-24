import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { DIGIT_BIG, drawNumber, drawWord, WORD_HEIGHT } from '../ui/bigText';
import { InputTestScene } from './inputTest';

const STEP_TIME = 0.8;
/** 3 → 2 → 1 → GO! */
const STEPS = ['3', '2', '1', 'GO!'] as const;

/** `3, 2, 1` 후 바로 시작. (미니게임 아이콘 표시는 3단계에서 게임이 생기면 붙인다.) */
export class CountdownScene implements Scene {
  private t = 0;
  private step = -1;

  constructor(private readonly game: Game) {}

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
    if (this.t >= STEP_TIME * STEPS.length) this.game.scenes.goto(new InputTestScene(this.game));
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (const slot of this.game.session.players) {
      const z = slot.zone;
      const c = SEAT_COLORS[slot.seat];
      r.frame(z.x + 3, z.y + 3, z.w - 6, z.h - 6, c.base);
    }
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
