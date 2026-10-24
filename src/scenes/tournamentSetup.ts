import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import type { Rect } from '../input/seats';
import { rectZone, type Zone } from '../input/touch';
import { Tournament, tournamentPool } from '../modes/tournament';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { drawGameTile, tileRect, type TileMark } from '../ui/gameGrid';
import { drawUiButton } from '../ui/uiButton';
import { MenuScene } from './menu';

export const ROUND_OPTIONS = [3, 5, 7, 10] as const;
const GRID_Y = 60;
const ROUND_ID = 100;
const RANDOM_ID = 200;
const BACK_ID = 201;
const START_ID = 202;

const roundRect = (i: number): Rect => ({ x: 62 + i * 34, y: 22, w: 30, h: 15 });
const RANDOM_BTN: Rect = { x: 6, y: 156, w: 70, h: 17 };
const BACK_BTN: Rect = { x: 178, y: 156, w: 56, h: 17 };
const START_BTN: Rect = { x: 242, y: 156, w: 72, h: 17 };

/**
 * 토너먼트 설정: 판 수, 그리고 게임마다 랜덤 후보 → 확정 → 밴을 눌러서 고른다.
 * 아무것도 안 고르면 완전 랜덤.
 */
export class TournamentSetupScene implements Scene {
  private pressed = -1;
  private leaving = false;
  private readonly codes: string[];

  constructor(private readonly game: Game) {
    this.codes = tournamentPool(game.session.deniedGames).map((g) => g.code);
  }

  private get settings() {
    return this.game.session.tournament;
  }

  enter(): void {
    const zones: Zone[] = ROUND_OPTIONS.map((_, i) => rectZone(ROUND_ID + i, roundRect(i)));
    this.codes.forEach((_, i) => zones.push(rectZone(i, tileRect(i, GRID_Y))));
    zones.push(rectZone(RANDOM_ID, RANDOM_BTN), rectZone(BACK_ID, BACK_BTN), rectZone(START_ID, START_BTN));
    this.game.input.setZones(zones);
  }

  private mark(code: string): TileMark {
    if (this.settings.banned.includes(code)) return 'banned';
    if (this.settings.fixed.includes(code)) return 'fixed';
    return 'none';
  }

  private get canStart(): boolean {
    return this.codes.some((c) => !this.settings.banned.includes(c));
  }

  update(): void {
    const { input, audio } = this.game;
    for (const e of input.tracker.drain()) {
      if (this.leaving) break;
      const zone = e.touch.zone;
      if (e.type === 'down') {
        this.pressed = zone;
        if (zone >= ROUND_ID && zone < RANDOM_ID) this.setRounds(ROUND_OPTIONS[zone - ROUND_ID]);
        else if (zone < ROUND_ID) this.cycle(this.codes[zone]);
        else audio.click();
      } else if (e.type === 'up') {
        if (zone === this.pressed) this.button(zone);
        this.pressed = -1;
      }
    }
  }

  private setRounds(rounds: number): void {
    // 확정한 게임보다 적은 판 수는 고를 수 없다
    if (rounds < this.settings.fixed.length) {
      this.game.audio.buzz();
      return;
    }
    this.settings.rounds = rounds;
    this.game.audio.click();
  }

  /** 랜덤 후보 → 확정 → 밴 → 랜덤 후보. 확정이 판 수만큼 찼으면 확정은 건너뛴다. */
  private cycle(code: string): void {
    const s = this.settings;
    const mark = this.mark(code);
    if (mark === 'none') {
      if (s.fixed.length < s.rounds) {
        s.fixed.push(code);
        this.game.audio.coin();
      } else {
        s.banned.push(code);
        this.game.audio.buzz();
      }
    } else if (mark === 'fixed') {
      s.fixed = s.fixed.filter((c) => c !== code);
      s.banned.push(code);
      this.game.audio.lose();
    } else {
      s.banned = s.banned.filter((c) => c !== code);
      this.game.audio.click();
    }
  }

  private button(zone: number): void {
    const { scenes, audio } = this.game;
    if (zone === RANDOM_ID) {
      this.settings.fixed = [];
      this.settings.banned = [];
    } else if (zone === BACK_ID) {
      this.leaving = true;
      scenes.goto(new MenuScene(this.game));
    } else if (zone === START_ID) {
      if (!this.canStart) {
        audio.buzz();
        return;
      }
      this.leaving = true;
      audio.coin();
      scenes.goto(Tournament.start(this.game));
    }
  }

  render(r: Renderer): void {
    const s = this.settings;
    r.clear(PAL.bgDark);
    r.text('토너먼트', 6, 6, PAL.text);
    r.text(`${this.game.session.players.length}인`, 62, 6, PAL.yellow);

    r.text('판 수', 6, 25, PAL.text);
    ROUND_OPTIONS.forEach((n, i) =>
      drawUiButton(r, roundRect(i), String(n), { primary: s.rounds === n, disabled: n < s.fixed.length }),
    );

    r.text('누를 때마다  랜덤 → 확정 → 밴', 6, 45, PAL.text);
    this.codes.forEach((code, i) =>
      drawGameTile(r, tileRect(i, GRID_Y), code, { pressed: this.pressed === i, mark: this.mark(code) }),
    );

    const random = this.codes.length - s.fixed.length - s.banned.length;
    r.text(`확정 ${s.fixed.length}  밴 ${s.banned.length}  랜덤 ${random}`, 6, 140, PAL.text);
    if (!this.canStart) r.text('전부 밴하면 시작할 수 없어요', 314, 140, PAL.red, 'right');

    drawUiButton(r, RANDOM_BTN, '완전 랜덤', { pressed: this.pressed === RANDOM_ID });
    drawUiButton(r, BACK_BTN, '뒤로', { pressed: this.pressed === BACK_ID });
    drawUiButton(r, START_BTN, '시작', { primary: true, pressed: this.pressed === START_ID, disabled: !this.canStart });
  }
}
