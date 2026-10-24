import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import type { Seat } from '../input/seats';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';

const SHOW_TIME = 2;

/** 최종 1위가 동점일 때: 동점자를 보여주고 서든데스(칼 뽑기 1라운드)로 넘어간다. */
export class SuddenDeathScene implements Scene {
  private t = 0;
  private left = false;

  constructor(
    private readonly game: Game,
    private readonly tied: readonly Seat[],
    private readonly next: () => Scene,
  ) {}

  enter(): void {
    this.game.input.setZones([]);
    this.game.audio.signal();
    this.game.fx.shake(3, 0.2);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t >= SHOW_TIME && !this.left) {
      this.left = true;
      this.game.scenes.goto(this.next());
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const blink = Math.floor(this.t * 4) % 2 === 0;
    r.text('동점!', 160, 40, blink ? PAL.yellow : PAL.text, 'center');
    r.text('서든데스', 160, 54, PAL.text, 'center');
    this.tied.forEach((seat, i) => {
      const x = 160 + (i - (this.tied.length - 1) / 2) * 40 - CHAR_SIZE / 2;
      drawCharacter(r.ctx, seat, 'move', this.t + i * 0.1, x, 80);
      r.text(`${seat + 1}P`, x + CHAR_SIZE / 2, 108, SEAT_COLORS[seat].base, 'center');
    });
  }
}
