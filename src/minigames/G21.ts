import { Grid } from '../render/grid';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { createCanvas, get2d } from '../render/canvas';
import { QuizAI, QuizGame } from './quiz';
import { defineGame } from './types';

// G21 색깔·손 함정(G20 가위바위보 흡수): 두 가지 문제가 섞여 나온다.
// - 색 이름 글자: 글자 "내용"이 아니라 "글씨 색"의 버튼
// - 손 그림: 그 손을 "이기는" 손 버튼(빨강=가위, 파랑=바위, 노랑=보. 초록은 손 문제에선 늘 오답)
// 버튼 4개: 빨강·파랑·노랑·초록(그 사람 기준 왼쪽부터, 2×2면 윗줄 먼저).

export const DURATION = 25;
export const COLOR_NAMES = ['빨강', '파랑', '노랑', '초록'] as const;
/** 글자 내용과 글씨 색이 같은 문제의 비율(함정이 아닌 문제도 섞는다) */
const SAME_CHANCE = 0.15;
/** 손 문제가 나올 확률 */
const HAND_CHANCE = 0.4;

export type Hand = 0 | 1 | 2;
export const SCISSORS: Hand = 0;
export const ROCK: Hand = 1;
export const PAPER: Hand = 2;
/** h를 이기는 손: 가위←바위, 바위←보, 보←가위 */
export const beats = (h: Hand): Hand => ((h + 1) % 3) as Hand;

export class ColorTrap extends QuizGame {
  readonly code = 'G21';
  readonly duration = DURATION;
  readonly choices = 4;
  /** 글자 내용(색 이름 번호) */
  word = 0;
  /** 손 문제면 보여준 손, 색 문제면 null */
  hand: Hand | null = null;

  protected newQuestion(): void {
    const rng = this.ctx.rng;
    const prev = this.answer;
    if (rng.next() < HAND_CHANCE) {
      // 같은 정답이 연달아 나오지 않게
      let h = Math.floor(rng.next() * 3) as Hand;
      if (beats(h) === prev) h = ((h + 1) % 3) as Hand;
      this.hand = h;
      this.answer = beats(h);
      return;
    }
    this.hand = null;
    // 글씨 색은 지난 정답과 다르게
    const ink = (prev + 1 + Math.floor(rng.next() * 3)) % 4;
    this.answer = ink;
    this.word = rng.next() < SAME_CHANCE ? ink : (ink + 1 + Math.floor(rng.next() * 3)) % 4;
  }

  protected drawQuestion(r: Renderer): void {
    if (this.hand !== null) {
      const icon = handSprite(this.hand, 4);
      const x = 160 - icon.width / 2;
      const y = 90 - icon.height / 2;
      r.rect(x - 6, y - 6, icon.width + 12, icon.height + 12, PAL.line);
      r.frame(x - 6, y - 6, icon.width + 12, icon.height + 12, this.phase === 'reveal' ? PAL.yellow : PAL.text);
      r.ctx.drawImage(icon, x, y);
      return;
    }
    const ink = SEAT_COLORS[this.answer].base;
    const text = COLOR_NAMES[this.word];
    const box = { x: 112, y: 62, w: 96, h: 56 };
    r.rect(box.x, box.y, box.w, box.h, PAL.line);
    r.frame(box.x, box.y, box.w, box.h, this.phase === 'reveal' ? PAL.text : PAL.bgMid);
    if (this.ctx.players.some((p) => p.flipped)) {
      // 아래쪽 사람용(똑바로)과 위쪽 사람용(거꾸로) 두 번
      r.textScaled(text, 160, 92, ink, 2, 'center');
      r.rotated180(160, 88, 0, 0, () => r.textScaled(text, 160, 92, ink, 2, 'center'));
    } else {
      r.textScaled(text, 160, 78, ink, 3, 'center');
    }
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

const dotCache = new Map<number, HTMLCanvasElement>();

/** 버튼 가운데 작은 흰 점(색만으로 구별하기 어려운 사람을 위해 같은 자리에 같은 무늬) */
function buttonMark(index: number): HTMLCanvasElement {
  let c = dotCache.get(index);
  if (!c) {
    c = createCanvas(5, 5);
    const ctx = get2d(c);
    ctx.fillStyle = PAL.text;
    // 0: 점 하나, 1: 가로 둘, 2: 세로 둘, 3: 네 귀퉁이
    const dots = [[[2, 2]], [[0, 2], [4, 2]], [[2, 0], [2, 4]], [[0, 0], [4, 0], [0, 4], [4, 4]]][index];
    for (const [x, y] of dots) ctx.fillRect(x, y, 1, 1);
    dotCache.set(index, c);
  }
  return c;
}

export const G21 = defineGame({
  code: 'G21',
  controls: 'four',
  padStyle: (_seat, index) => ({ color: SEAT_COLORS[index], icon: index < 3 ? handSprite(index as Hand) : buttonMark(3) }),
  create: () => new ColorTrap(),
  createAI: (game, player, controls) =>
    new QuizAI(game, player, controls, {
      reaction: { easy: [0.8, 1.2], normal: [0.6, 0.9], hard: [0.45, 0.65] },
      wrong: { easy: 0.25, normal: 0.12, hard: 0.05 },
    }),
});
