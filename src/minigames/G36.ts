import type { Seat } from '../input/seats';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { itemSprite, ITEM_KINDS } from './G54';
import { QuizAI, QuizGame } from './quiz';
import { defineGame, type PadStyle } from './types';

// G36 사라진 것 찾기: 물건 6개를 잠깐 보여 주고 깜깜해졌다가 다시 보여 줄 때 하나가 없다.
// 없어진 물건을 보기 3개(버튼 그림) 중에서 먼저 누른다. 맞히면 +1, 틀리면 -1.

export const DURATION = 25;
const SLOTS = 6;
const SHOW_START = 1.6;
const SHOW_END = 0.9;
const BLANK = 0.35;
const BOARD = { x: 100, y: 55, w: 120, h: 70 } as const;

export class MissingThing extends QuizGame {
  readonly code = 'G36';
  readonly duration = DURATION;
  readonly choices = 3;
  items: number[] = [];
  /** 사라진 칸 */
  gone = 0;
  options: number[] = [0, 1, 2];
  private showFor = SHOW_START;

  protected leadTime(): number {
    return this.showFor + BLANK;
  }

  protected newQuestion(): void {
    const rng = this.ctx.rng;
    const kinds = [...Array(ITEM_KINDS).keys()];
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    this.items = kinds.slice(0, SLOTS);
    this.gone = Math.floor(rng.next() * SLOTS);
    const missing = this.items[this.gone];
    // 보기: 사라진 것 + 판에 남아 있는 것 둘(헷갈리게)
    const stay = this.items.filter((_, i) => i !== this.gone);
    const opts = [missing, stay[Math.floor(rng.next() * stay.length)]];
    while (opts.length < 3) {
      const k = stay[Math.floor(rng.next() * stay.length)];
      if (!opts.includes(k)) opts.push(k);
    }
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    this.options = opts;
    this.answer = opts.indexOf(missing);
    this.showFor = SHOW_START + (SHOW_END - SHOW_START) * Math.min(1, this.t / DURATION);
  }

  padStyle(_seat: Seat, index: number): PadStyle | null {
    return this.answering ? { icon: itemSprite(this.options[index]) } : null;
  }

  private slotPos(i: number): { x: number; y: number } {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return { x: BOARD.x + 22 + col * 38, y: BOARD.y + 18 + row * 34 };
  }

  protected drawQuestion(r: Renderer): void {
    r.rect(BOARD.x, BOARD.y, BOARD.w, BOARD.h, PAL.line);
    r.frame(BOARD.x, BOARD.y, BOARD.w, BOARD.h, PAL.bgMid);
    const showing = this.phase === 'ask' && this.phaseT < this.showFor;
    const blank = this.phase === 'ask' && !showing && !this.answering;
    if (blank) return;
    this.items.forEach((item, i) => {
      const { x, y } = this.slotPos(i);
      if (!showing && i === this.gone) {
        r.text('?', x, y - 4, PAL.yellow, 'center');
        return;
      }
      const icon = itemSprite(item);
      r.ctx.drawImage(icon, x - icon.width / 2, y - icon.height / 2);
    });
  }
}

export const G36 = defineGame({
  code: 'G36',
  controls: 'three',
  create: () => new MissingThing(),
  createAI: (game, player, controls) =>
    new QuizAI(game, player, controls, {
      reaction: { easy: [0.9, 1.4], normal: [0.65, 1.0], hard: [0.45, 0.7] },
      wrong: { easy: 0.35, normal: 0.2, hard: 0.1 },
    }),
});
