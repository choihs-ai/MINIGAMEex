import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { rectZone } from '../input/touch';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawCharacter, CHAR_SIZE } from '../ui/characters';
import { LobbyScene } from './lobby';

/** 첫 화면. "INSERT COIN" 탭이 오디오 잠금 해제를 겸한다. */
export class TitleScene implements Scene {
  private t = 0;

  constructor(private readonly game: Game) {}

  enter(): void {
    this.game.input.setZones([rectZone(0, { x: 0, y: 0, w: 320, h: 180 })]);
  }

  update(dt: number): void {
    this.t += dt;
    const { input, audio, scenes } = this.game;
    for (const e of input.tracker.drain()) {
      if (e.type !== 'down') continue;
      audio.unlock();
      audio.coin();
      scenes.goto(new LobbyScene(this.game));
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (let i = 0; i < 4; i++) {
      const x = 160 + (i - 1.5) * 44 - CHAR_SIZE / 2;
      drawCharacter(r.ctx, i as 0 | 1 | 2 | 3, 'idle', this.t + i * 0.17, x, 38);
    }
    r.text('4인용게임EX', 161, 79, PAL.line, 'center');
    r.text('4인용게임EX', 160, 78, PAL.text, 'center');
    if (Math.floor(this.t * 2) % 2 === 0) r.text('INSERT COIN', 160, 128, PAL.yellow, 'center');
    r.text('화면을 탭하세요', 160, 150, PAL.text, 'center');
  }
}
