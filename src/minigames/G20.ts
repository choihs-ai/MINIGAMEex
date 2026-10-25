import { Grid } from '../render/grid';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { QuizAI, QuizGame } from './quiz';
import { defineGame } from './types';

// G20 가위바위보 스피드전: 가운데 뜬 손을 "이기는" 버튼을 가장 먼저 누른다(3버튼: 그 사람 기준 왼쪽부터 가위·바위·보).

export const DURATION = 25;
export type Hand = 0 | 1 | 2;
export const SCISSORS: Hand = 0;
export const ROCK: Hand = 1;
export const PAPER: Hand = 2;
/** h를 이기는 손: 가위←바위, 바위←보, 보←가위 */
export const beats = (h: Hand): Hand => ((h + 1) % 3) as Hand;

export class RpsSpeed extends QuizGame {
  readonly code = 'G20';
  readonly duration = DURATION;
  readonly choices = 3;
  shown: Hand = ROCK;

  protected newQuestion(): void {
    // 같은 손이 연달아 나오지 않게
    const next = ((this.shown + 1 + Math.floor(this.ctx.rng.next() * 2)) % 3) as Hand;
    this.shown = next;
    this.answer = beats(next);
  }

  protected drawQuestion(r: Renderer): void {
    const icon = handSprite(this.shown, 4);
    const x = 160 - icon.width / 2;
    const y = 90 - icon.height / 2;
    r.rect(x - 6, y - 6, icon.width + 12, icon.height + 12, PAL.line);
    r.frame(x - 6, y - 6, icon.width + 12, icon.height + 12, this.phase === 'reveal' ? PAL.yellow : PAL.text);
    r.ctx.drawImage(icon, x, y);
  }
}

const handCache = new Map<string, HTMLCanvasElement>();

/** 손 그림(가위·바위·보) 11×11 격자를 scale배로. 버튼 그림은 scale 1. */
export function handSprite(hand: Hand, scale = 1): HTMLCanvasElement {
  const key = `${hand}|${scale}`;
  const hit = handCache.get(key);
  if (hit) return hit;
  const g = new Grid(11 * scale + 2, 11 * scale + 2);
  const px = (x: number, y: number, w: number, h: number, c: (typeof PAL)[keyof typeof PAL]) =>
    g.rect(1 + x * scale, 1 + y * scale, w * scale, h * scale, c);
  const skin = PAL.text;
  const shade = PAL.yellowShadow;
  if (hand === ROCK) {
    // 주먹
    px(2, 3, 7, 6, skin);
    px(2, 3, 7, 1, shade);
    px(4, 3, 1, 3, shade);
    px(6, 3, 1, 3, shade);
    px(1, 5, 1, 3, skin);
    px(3, 9, 5, 2, skin);
  } else if (hand === PAPER) {
    // 편 손바닥
    for (const fx of [2, 4, 6, 8]) px(fx, fx === 2 || fx === 8 ? 1 : 0, 1, 5, skin);
    px(2, 5, 7, 4, skin);
    px(0, 4, 2, 2, skin);
    px(3, 9, 5, 2, skin);
  } else {
    // 가위: 두 손가락을 V자로
    px(2, 0, 1, 2, skin);
    px(3, 2, 1, 2, skin);
    px(7, 0, 1, 2, skin);
    px(6, 2, 1, 2, skin);
    px(3, 4, 5, 5, skin);
    px(4, 5, 3, 1, shade);
    px(2, 6, 1, 2, skin);
    px(4, 9, 4, 2, skin);
  }
  g.outline(PAL.line);
  const canvas = g.toCanvas();
  handCache.set(key, canvas);
  return canvas;
}

export const G20 = defineGame({
  code: 'G20',
  controls: 'three',
  padStyle: (_seat, index) => ({ icon: handSprite(index as Hand) }),
  create: () => new RpsSpeed(),
  createAI: (game, player, controls) =>
    new QuizAI(game, player, controls, {
      reaction: { easy: [0.75, 1.15], normal: [0.55, 0.85], hard: [0.42, 0.62] },
      wrong: { easy: 0.18, normal: 0.09, hard: 0.04 },
    }),
});
