import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { layoutPlayers, type Rect, type Seat } from '../input/seats';
import { rectZone, type Zone } from '../input/touch';
import { READY_GAMES } from '../minigames/registry';
import { playArcade } from '../modes/arcade';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { drawGameTile, ScrollGrid } from '../ui/gameGrid';
import { drawUiButton } from '../ui/uiButton';
import { TournamentSetupScene } from './tournamentSetup';

const COUNTS = [1, 2, 3, 4] as const;
const TAB_W = 40;
const TAB_H = 16;
const TAB_Y = 5;
const TAB_ID = 100;
const TOURNAMENT_ID = 200;
const GRID_ID = 300;
const TOURNAMENT_BTN: Rect = { x: 110, y: 156, w: 100, h: 17 };

const tabRect = (i: number): Rect => ({ x: 160 + (i - 1.5) * (TAB_W + 6) - TAB_W / 2, y: TAB_Y, w: TAB_W, h: TAB_H });

/**
 * 메인 메뉴(아케이드): 위에서 인원 수를 고르고, 게임 아이콘을 누르면 바로 시작.
 * 2인 이상이면 아래 토너먼트 버튼으로 여러 판 연속. 게임 이름·설명은 보여주지 않는다.
 */
export class MenuScene implements Scene {
  private t = 0;
  /** 누르고 있는 아이콘·버튼(뗄 때 실행해 스치는 실수를 막는다) */
  private pressed = -1;
  private leaving = false;
  /** 게임 아이콘 격자(위아래로 끌어 넘긴다) */
  private readonly grid = new ScrollGrid({ x: 0, y: 62, w: 320, h: 90 }, () => READY_GAMES.length, GRID_ID);

  constructor(private readonly game: Game) {}

  enter(): void {
    const zones: Zone[] = COUNTS.map((_, i) => rectZone(TAB_ID + i, tabRect(i)));
    zones.push(this.grid.zone());
    zones.push(rectZone(TOURNAMENT_ID, TOURNAMENT_BTN));
    this.game.input.setZones(zones);
  }

  private get tournamentOk(): boolean {
    return this.game.session.playerCount >= 2;
  }

  update(dt: number): void {
    this.t += dt;
    const { input, audio, session } = this.game;
    for (const e of input.tracker.drain()) {
      if (this.leaving) break;
      const zone = e.touch.zone;
      if (zone === GRID_ID) {
        if (e.type === 'down') {
          audio.unlock();
          this.grid.down(e.touch);
          if (this.grid.pressed >= 0) audio.click();
        } else if (e.type === 'move') this.grid.move(e.touch);
        else {
          const picked = this.grid.up(e.touch);
          if (picked >= 0) this.openGame(picked);
        }
        continue;
      }
      if (e.type === 'down') {
        audio.unlock();
        if (zone >= TAB_ID && zone < TOURNAMENT_ID) {
          const count = COUNTS[zone - TAB_ID];
          session.playerCount = count;
          audio.character((count - 1) as Seat);
        } else if (zone === TOURNAMENT_ID && !this.tournamentOk) {
          audio.buzz();
        } else {
          this.pressed = zone;
          audio.click();
        }
      } else if (e.type === 'up') {
        if (zone === this.pressed) this.open(zone);
        this.pressed = -1;
      }
    }
  }

  /** 고른 인원으로 자리를 정한다 */
  private seatPlayers(): void {
    const { session } = this.game;
    this.leaving = true;
    const joined = ([0, 1, 2, 3] as Seat[]).slice(0, session.playerCount);
    session.joined = joined;
    session.players = layoutPlayers(joined);
  }

  private open(zone: number): void {
    if (zone !== TOURNAMENT_ID) return;
    this.seatPlayers();
    this.game.scenes.goto(new TournamentSetupScene(this.game));
  }

  private openGame(index: number): void {
    this.seatPlayers();
    this.game.audio.coin();
    this.game.scenes.goto(playArcade(this.game, READY_GAMES[index]));
  }

  render(r: Renderer): void {
    const { session } = this.game;
    r.clear(PAL.bgDark);
    r.text('4인용게임EX', 6, 8, PAL.text);

    COUNTS.forEach((count, i) => {
      const on = session.playerCount === count;
      drawUiButton(r, tabRect(i), `${count}인`, { primary: on });
    });

    // 고른 인원만큼 캐릭터(1인이면 1P + CPU 셋)
    for (let seat = 0; seat < 4; seat++) {
      const x = 160 + (seat - 1.5) * 34 - CHAR_SIZE / 2;
      const human = seat < session.playerCount;
      const cpu = session.playerCount === 1 && seat > 0;
      if (!human && !cpu) continue;
      drawCharacter(r.ctx, seat as Seat, 'idle', this.t + seat * 0.21, x, 28);
      r.text(cpu ? 'CPU' : `${seat + 1}P`, x + CHAR_SIZE / 2, 53, cpu ? SEAT_COLORS[seat].shadow : SEAT_COLORS[seat].base, 'center');
    }

    this.grid.render(r, (i, rect, pressed) => drawGameTile(r, rect, READY_GAMES[i], { pressed }));

    drawUiButton(r, TOURNAMENT_BTN, this.tournamentOk ? '토너먼트' : '토너먼트(2인 이상)', {
      primary: this.tournamentOk,
      pressed: this.pressed === TOURNAMENT_ID,
      disabled: !this.tournamentOk,
    });
  }
}
