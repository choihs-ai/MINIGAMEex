import type { Seat } from '../input/seats';
import { Grid } from '../render/grid';
import { PAL, type Color } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { glyphIcon } from '../ui/padIcons';
import { QuizAI, QuizGame } from './quiz';
import { defineGame, type PadStyle } from './types';

// G16 개수 세기(G38 개수 세기 흡수): 물건들이 잠깐 번쩍 보였다 사라진다.
// 물음표 옆에 그림이 나오면 그 물건만, "전부"면 모두의 개수를 보기 3개(버튼) 중에서 먼저 맞힌다.

export const DURATION = 25;
const KINDS = 3;
/** 보여 주는 시간: 문제가 거듭될수록 짧아진다 */
const SHOW_START = 1.3;
const SHOW_END = 0.7;
/** 물건을 흩뿌리는 가운데 판(사람 캐릭터를 피한 자리) */
const BOARD = { x: 100, y: 55, w: 120, h: 70 } as const;

export interface Thing {
  x: number;
  y: number;
  kind: number;
}

export class CountQuick extends QuizGame {
  readonly code = 'G16';
  readonly duration = DURATION;
  readonly choices = 3;
  things: Thing[] = [];
  /** 물어보는 물건(null이면 전부) */
  ask: number | null = null;
  options: number[] = [1, 2, 3];
  private showFor = SHOW_START;

  protected leadTime(): number {
    return this.showFor + 0.15;
  }

  protected newQuestion(): void {
    const rng = this.ctx.rng;
    const n = 6 + Math.floor(rng.next() * (5 + Math.min(6, this.question)));
    this.things = [];
    // 서로 겹치지 않게 가운데 판에 흩뿌린다
    for (let tries = 0; this.things.length < n && tries < 400; tries++) {
      const x = BOARD.x + 8 + rng.next() * (BOARD.w - 16);
      const y = BOARD.y + 7 + rng.next() * (BOARD.h - 14);
      if (this.things.some((t) => Math.abs(t.x - x) < 13 && Math.abs(t.y - y) < 13)) continue;
      this.things.push({ x, y, kind: Math.floor(rng.next() * KINDS) });
    }
    this.ask = rng.next() < 0.35 ? null : Math.floor(rng.next() * KINDS);
    const right = this.ask === null ? this.things.length : this.things.filter((t) => t.kind === this.ask).length;
    // 오답 보기는 정답 근처(±1~2)
    const set = new Set([right]);
    while (set.size < 3) {
      const d = (rng.next() < 0.5 ? -1 : 1) * (1 + Math.floor(rng.next() * 2));
      if (right + d >= 0) set.add(right + d);
    }
    this.options = [...set].sort((a, b) => a - b);
    this.answer = this.options.indexOf(right);
    this.showFor = SHOW_START + (SHOW_END - SHOW_START) * Math.min(1, this.t / DURATION);
  }

  padStyle(_seat: Seat, index: number): PadStyle | null {
    return this.answering ? { icon: glyphIcon(String(this.options[index])) } : null;
  }

  protected drawQuestion(r: Renderer): void {
    r.rect(BOARD.x, BOARD.y, BOARD.w, BOARD.h, PAL.line);
    r.frame(BOARD.x, BOARD.y, BOARD.w, BOARD.h, PAL.bgMid);
    if (!this.answering && this.phase === 'ask') {
      for (const t of this.things) r.ctx.drawImage(thingSprite(t.kind), Math.round(t.x - 5), Math.round(t.y - 5));
      return;
    }
    // 질문: 그림(또는 "전부") + ? 를 위·아래 두 방향으로
    const q = (y: number) => {
      if (this.ask === null) r.text('전부 몇 개?', 160, y, PAL.yellow, 'center');
      else {
        r.ctx.drawImage(thingSprite(this.ask), 132, y - 1);
        r.text('몇 개?', 166, y, PAL.yellow, 'center');
      }
    };
    q(98);
    if (this.ctx.players.some((p) => p.flipped)) r.rotated180(160, 90, 0, 0, () => q(98));
  }
}

const COLORS: ReadonlyArray<[Color, Color]> = [
  [PAL.red, PAL.redShadow],
  [PAL.blue, PAL.blueShadow],
  [PAL.yellow, PAL.yellowShadow],
];
const spriteCache = new Map<number, HTMLCanvasElement>();

/** 동그라미(빨강)·네모(파랑)·세모(노랑) 10×10 */
export function thingSprite(kind: number): HTMLCanvasElement {
  let c = spriteCache.get(kind);
  if (c) return c;
  const g = new Grid(11, 11);
  const [base, shadow] = COLORS[kind];
  if (kind === 0) g.ellipse(5.5, 5.5, 4.5, 4.5, base, shadow);
  else if (kind === 1) {
    g.rect(1, 1, 9, 9, base);
    g.rect(1, 8, 9, 2, shadow);
  } else {
    for (let y = 1; y < 10; y++) {
      const half = Math.floor(y / 2);
      g.rect(5 - half, y, half * 2 + 1, 1, y > 7 ? shadow : base);
    }
  }
  g.outline(PAL.line);
  c = g.toCanvas();
  spriteCache.set(kind, c);
  return c;
}

export const G16 = defineGame({
  code: 'G16',
  controls: 'three',
  create: () => new CountQuick(),
  createAI: (game, player, controls) =>
    new QuizAI(game, player, controls, {
      reaction: { easy: [0.9, 1.4], normal: [0.6, 1.0], hard: [0.45, 0.7] },
      wrong: { easy: 0.35, normal: 0.2, hard: 0.1 },
    }),
});
