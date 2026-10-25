import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { createCanvas, get2d } from '../render/canvas';
import { QuizAI, QuizGame } from './quiz';
import { defineGame } from './types';

// G21 색깔 함정: 색 이름이 다른 색 글씨로 뜬다. 글자 "내용"이 아니라 "글씨 색"의 버튼을 가장 먼저 누른다.
// 버튼 4개: 빨강·파랑·노랑·초록(그 사람 기준 왼쪽부터, 2×2면 윗줄 먼저).

export const DURATION = 25;
export const COLOR_NAMES = ['빨강', '파랑', '노랑', '초록'] as const;
/** 글자 내용과 글씨 색이 같은 문제의 비율(함정이 아닌 문제도 섞는다) */
const SAME_CHANCE = 0.2;

export class ColorTrap extends QuizGame {
  readonly code = 'G21';
  readonly duration = DURATION;
  readonly choices = 4;
  /** 글자 내용(색 이름 번호) */
  word = 0;

  protected newQuestion(): void {
    const rng = this.ctx.rng;
    const prev = this.answer;
    // 글씨 색은 지난 문제와 다르게
    const ink = (prev + 1 + Math.floor(rng.next() * 3)) % 4;
    this.answer = ink;
    this.word = rng.next() < SAME_CHANCE ? ink : (ink + 1 + Math.floor(rng.next() * 3)) % 4;
  }

  protected drawQuestion(r: Renderer): void {
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
  padStyle: (_seat, index) => ({ color: SEAT_COLORS[index], icon: buttonMark(index) }),
  create: () => new ColorTrap(),
  createAI: (game, player, controls) =>
    new QuizAI(game, player, controls, {
      reaction: { easy: [0.8, 1.2], normal: [0.6, 0.9], hard: [0.45, 0.65] },
      wrong: { easy: 0.25, normal: 0.12, hard: 0.05 },
    }),
});
