import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import type { Seat } from '../input/seats';
import { rectZone } from '../input/touch';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { gameIcon, ICON_SIZE } from '../ui/icons';

const SLOT = 26;
const GAP = 4;
const SLOT_Y = 74;
/** 릴 아이콘이 바뀌는 간격(초) */
const SPIN_STEP = 0.07;
const FIRST_STOP = 0.7;
const STOP_GAP = 0.3;
const HOLD_AFTER = 1.4;

/**
 * 토너먼트 시작 전, 슬롯머신처럼 이번에 할 게임 아이콘을 하나씩 멈추며 공개한다.
 * 화면을 누르면 바로 다 멈추고, 다 멈춘 뒤 누르면(또는 잠시 뒤) 첫 판으로 간다.
 */
export class SlotRevealScene implements Scene {
  private t = 0;
  private stopped = 0;
  private left = false;

  constructor(
    private readonly game: Game,
    private readonly codes: readonly string[],
    /** 돌아가는 동안 보여줄 아이콘들 */
    private readonly reel: readonly string[],
    private readonly next: () => Scene,
  ) {}

  enter(): void {
    this.game.input.setZones([rectZone(0, { x: 0, y: 0, w: 320, h: 180 })]);
  }

  private stopTime(i: number): number {
    return FIRST_STOP + i * STOP_GAP;
  }

  update(dt: number): void {
    this.t += dt;
    const { audio, fx, input } = this.game;
    const allStopTime = this.stopTime(this.codes.length - 1);
    for (const e of input.tracker.drain()) {
      if (e.type !== 'down') continue;
      if (this.t < allStopTime) this.t = allStopTime;
      else this.go();
    }
    while (this.stopped < this.codes.length && this.t >= this.stopTime(this.stopped)) {
      this.stopped++;
      audio.click();
      if (this.stopped === this.codes.length) {
        audio.coin();
        fx.shake(2, 0.1);
      }
    }
    if (this.t >= allStopTime + HOLD_AFTER) this.go();
  }

  private go(): void {
    if (this.left) return;
    this.left = true;
    this.game.scenes.goto(this.next());
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    const { session } = this.game;
    session.players.forEach((p, i) => {
      const x = 160 + (i - (session.players.length - 1) / 2) * 34 - CHAR_SIZE / 2;
      drawCharacter(r.ctx, p.seat as Seat, this.stopped === this.codes.length ? 'win' : 'idle', this.t + i * 0.2, x, 24);
    });

    const n = this.codes.length;
    const x0 = Math.round(160 - (n * SLOT + (n - 1) * GAP) / 2);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (SLOT + GAP);
      const done = i < this.stopped;
      r.rect(x - 1, SLOT_Y - 1, SLOT + 2, SLOT + 2, PAL.line);
      r.rect(x, SLOT_Y, SLOT, SLOT, done ? PAL.bgMid : PAL.bgDark);
      r.frame(x, SLOT_Y, SLOT, SLOT, done ? PAL.text : PAL.bgMid);
      const code = done ? this.codes[i] : this.reel[(Math.floor(this.t / SPIN_STEP) + i) % this.reel.length];
      // 돌아가는 동안은 한 칸씩 위로 밀려 올라가는 느낌(프레임 단위)
      const shift = done ? 0 : (Math.floor(this.t / SPIN_STEP) % 2) * 2;
      r.ctx.drawImage(gameIcon(code), x + (SLOT - ICON_SIZE) / 2, SLOT_Y + (SLOT - ICON_SIZE) / 2 - shift);
      r.text(String(i + 1), x + SLOT / 2, SLOT_Y + SLOT + 4, done ? PAL.text : PAL.bgMid, 'center');
    }
  }
}
