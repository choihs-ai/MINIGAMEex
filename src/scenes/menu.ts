import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { layoutPlayers, type Seat } from '../input/seats';
import { rectZone, type Zone } from '../input/touch';
import { READY_GAMES } from '../minigames/registry';
import { playArcade } from '../modes/arcade';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { gameIcon, ICON_SIZE } from '../ui/icons';

const COUNTS = [1, 2, 3, 4] as const;
const TAB_W = 40;
const TAB_H = 16;
const TAB_Y = 5;
const TILE = 30;
const TILE_GAP = 6;
const COLS = 8;
const GRID_Y = 68;
const TAB_ID = 100;

const tabRect = (i: number) => ({ x: 160 + (i - 1.5) * (TAB_W + 6) - TAB_W / 2, y: TAB_Y, w: TAB_W, h: TAB_H });
const tileRect = (i: number) => {
  const x0 = Math.floor((320 - (COLS * TILE + (COLS - 1) * TILE_GAP)) / 2);
  return { x: x0 + (i % COLS) * (TILE + TILE_GAP), y: GRID_Y + Math.floor(i / COLS) * (TILE + TILE_GAP), w: TILE, h: TILE };
};

/**
 * 메인 메뉴(아케이드): 위에서 인원 수를 고르고, 게임 아이콘을 누르면 바로 시작.
 * 게임 이름·설명은 보여주지 않는다.
 */
export class MenuScene implements Scene {
  private t = 0;
  private pressedTile = -1;
  private leaving = false;

  constructor(private readonly game: Game) {}

  enter(): void {
    const zones: Zone[] = COUNTS.map((_, i) => rectZone(TAB_ID + i, tabRect(i)));
    READY_GAMES.forEach((_, i) => zones.push(rectZone(i, tileRect(i))));
    this.game.input.setZones(zones);
  }

  update(dt: number): void {
    this.t += dt;
    const { input, audio, session, scenes } = this.game;
    for (const e of input.tracker.drain()) {
      if (e.type === 'down') {
        audio.unlock();
        if (e.touch.zone >= TAB_ID) {
          const count = COUNTS[e.touch.zone - TAB_ID];
          session.playerCount = count;
          audio.character((count - 1) as Seat);
        } else {
          this.pressedTile = e.touch.zone;
          audio.click();
        }
      } else if (e.type === 'up' && e.touch.zone === this.pressedTile && !this.leaving) {
        // 아이콘은 눌렀다 뗄 때 시작(실수로 스치는 것 방지)
        this.leaving = true;
        const joined = ([0, 1, 2, 3] as Seat[]).slice(0, session.playerCount);
        session.joined = joined;
        session.players = layoutPlayers(joined);
        audio.coin();
        scenes.goto(playArcade(this.game, READY_GAMES[this.pressedTile]));
      }
    }
    if (!input.tracker.all().some((t) => t.zone === this.pressedTile)) this.pressedTile = this.leaving ? this.pressedTile : -1;
  }

  render(r: Renderer): void {
    const { session } = this.game;
    r.clear(PAL.bgDark);
    r.text('4인용게임EX', 6, 8, PAL.text);

    COUNTS.forEach((count, i) => {
      const t = tabRect(i);
      const on = session.playerCount === count;
      r.rect(t.x, t.y, t.w, t.h, PAL.line);
      r.rect(t.x + 1, t.y + 1, t.w - 2, t.h - 2, on ? PAL.text : PAL.bgMid);
      r.text(`${count}인`, t.x + t.w / 2, t.y + 4, on ? PAL.line : PAL.text, 'center');
    });

    // 고른 인원만큼 캐릭터(1인이면 1P + CPU 셋을 어둡게)
    for (let seat = 0; seat < 4; seat++) {
      const x = 160 + (seat - 1.5) * 34 - CHAR_SIZE / 2;
      const human = seat < session.playerCount;
      const cpu = session.playerCount === 1 && seat > 0;
      if (!human && !cpu) continue;
      drawCharacter(r.ctx, seat as Seat, 'idle', this.t + seat * 0.21, x, 28);
      r.text(cpu ? 'CPU' : `${seat + 1}P`, x + CHAR_SIZE / 2, 53, cpu ? SEAT_COLORS[seat].shadow : SEAT_COLORS[seat].base, 'center');
    }

    READY_GAMES.forEach((code, i) => {
      const t = tileRect(i);
      const down = this.pressedTile === i;
      const dy = down ? 2 : 0;
      r.rect(t.x, t.y + 2, t.w, t.h, PAL.line);
      r.rect(t.x, t.y + dy, t.w, t.h, PAL.line);
      r.rect(t.x + 1, t.y + 1 + dy, t.w - 2, t.h - 2, PAL.bgMid);
      r.ctx.drawImage(gameIcon(code), t.x + (t.w - ICON_SIZE) / 2, t.y + (t.h - ICON_SIZE) / 2 + dy);
    });
  }
}
