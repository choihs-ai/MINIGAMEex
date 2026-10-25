import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_SIZE, drawCharacter } from '../ui/characters';
import { AiHand, byDifficulty } from './ai';
import { drawScoreTag, drawTimer, facing, localOffset, sideAnchor, TIMER_X, TIMER_Y } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G41 순서 맞추기 퀴즈: 물건 네 개(색 칸)를 "작은 것부터" 같은 기준대로 색 버튼으로 차례로 누른다.
// 네 개를 다 맞게 누른 사람 중 가장 빠른 사람 +1. 순서가 틀리면 -1이고 그 문제는 더 못 누른다. 상식만(학습 문제 없음).

export const DURATION = 25;
/** 한 문제 제한 시간 */
const ASK_TIME = 5;
const GAP = 0.6;

/** 작은(이른) 것부터 순서대로 */
export const ORDER_SETS: ReadonlyArray<{ by: [string, string]; items: [string, string, string, string] }> = [
  { by: ['작은 것부터', '큰 것부터'], items: ['개미', '고양이', '말', '코끼리'] },
  { by: ['작은 것부터', '큰 것부터'], items: ['쥐', '개', '소', '고래'] },
  { by: ['작은 것부터', '큰 것부터'], items: ['콩', '사과', '수박', '자동차'] },
  { by: ['작은 것부터', '큰 것부터'], items: ['단추', '접시', '식탁', '방'] },
  { by: ['가벼운 것부터', '무거운 것부터'], items: ['깃털', '연필', '책', '냉장고'] },
  { by: ['느린 것부터', '빠른 것부터'], items: ['달팽이', '거북이', '사람', '치타'] },
  { by: ['느린 것부터', '빠른 것부터'], items: ['걷기', '자전거', '자동차', '비행기'] },
  { by: ['낮은 것부터', '높은 것부터'], items: ['의자', '사람', '집', '산'] },
  { by: ['낮은 것부터', '높은 것부터'], items: ['1층', '2층', '3층', '옥상'] },
  { by: ['이른 것부터', '늦은 것부터'], items: ['아침', '점심', '저녁', '밤'] },
  { by: ['순서대로', '거꾸로'], items: ['봄', '여름', '가을', '겨울'] },
  { by: ['어린 것부터', '나이 든 것부터'], items: ['아기', '어린이', '어른', '노인'] },
  { by: ['적은 것부터', '많은 것부터'], items: ['하나', '셋', '다섯', '열'] },
  { by: ['적은 돈부터', '많은 돈부터'], items: ['십원', '백원', '천원', '만원'] },
  { by: ['짧은 것부터', '긴 것부터'], items: ['1초', '1분', '1시간', '하루'] },
  { by: ['순서대로', '거꾸로'], items: ['월', '화', '수', '목'] },
  { by: ['무지개 순서', '무지개 거꾸로'], items: ['빨강', '주황', '노랑', '초록'] },
  { by: ['차가운 것부터', '뜨거운 것부터'], items: ['얼음', '찬물', '미지근', '끓는 물'] },
  { by: ['가나다 순', '가나다 거꾸로'], items: ['가방', '나무', '다리', '라면'] },
  { by: ['작은 것부터', '큰 것부터'], items: ['병아리', '닭', '타조', '기린'] },
];

export type OrderPhase = 'gap' | 'ask' | 'reveal';

export class OrderQuiz implements MiniGame {
  readonly code = 'G41';
  t = 0;
  phase: OrderPhase = 'gap';
  phaseT = 0;
  question = 0;
  prompt = '';
  /** 칸 번호(색)별 글자 */
  labels: string[] = [];
  /** 정답: 눌러야 하는 칸 번호 순서 */
  answer: number[] = [];
  readonly progress = new Map<Seat, number>();
  readonly locked = new Set<Seat>();
  readonly scores = new Map<Seat, number>();
  winners: Seat[] = [];
  private ctx!: GameContext;
  private done = false;
  private used = new Set<number>();

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of ctx.players) this.scores.set(p.seat, 0);
  }

  get rng() {
    return this.ctx.rng;
  }

  get finished(): boolean {
    return this.done;
  }

  isFinished(): boolean {
    return this.done;
  }

  canPress(seat: Seat): boolean {
    return this.phase === 'ask' && !this.locked.has(seat) && !this.done;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.scores) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore([...this.scores].map(([seat, score]) => ({ seat, score })));
  }

  private newQuestion(): void {
    const rng = this.ctx.rng;
    let k = Math.floor(rng.next() * ORDER_SETS.length);
    while (this.used.has(k) && this.used.size < ORDER_SETS.length) k = (k + 1) % ORDER_SETS.length;
    this.used.add(k);
    const set = ORDER_SETS[k];
    const reverse = rng.next() < 0.4;
    this.prompt = set.by[reverse ? 1 : 0];
    const ordered = reverse ? [...set.items].reverse() : [...set.items];
    // 칸(색)에 섞어 놓는다
    const slots = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    this.labels = [];
    ordered.forEach((label, rank) => (this.labels[slots[rank]] = label));
    this.answer = slots;
    this.progress.clear();
    this.locked.clear();
    this.winners = [];
    this.question++;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'gap' && this.phaseT >= GAP) {
      this.newQuestion();
      this.phase = 'ask';
      this.phaseT = 0;
      this.ctx.sfx.turn();
    } else if (this.phase === 'ask') {
      const winners: Seat[] = [];
      for (const p of this.ctx.players) {
        if (this.locked.has(p.seat)) continue;
        const c = this.ctx.controls.get(p.seat)!;
        for (let b = 0; b < 4; b++) {
          if (!c.justPressed(b)) continue;
          const at = this.progress.get(p.seat) ?? 0;
          if (this.answer[at] === b) {
            this.progress.set(p.seat, at + 1);
            if (at + 1 === 4) winners.push(p.seat);
            else this.ctx.sfx.tap();
          } else {
            this.locked.add(p.seat);
            this.scores.set(p.seat, (this.scores.get(p.seat) ?? 0) - 1);
            this.ctx.sfx.buzz();
            break;
          }
        }
      }
      if (winners.length > 0) {
        this.winners = winners;
        for (const s of winners) this.scores.set(s, (this.scores.get(s) ?? 0) + 1);
        this.ctx.sfx.coin();
        this.phase = 'reveal';
        this.phaseT = 0;
      } else if (this.phaseT >= ASK_TIME || this.ctx.players.every((p) => this.locked.has(p.seat))) {
        this.phase = 'reveal';
        this.phaseT = 0;
      }
    } else if (this.phase === 'reveal' && this.phaseT >= 0.8) {
      this.phase = 'gap';
      this.phaseT = 0;
    }
    if (this.t >= DURATION) this.done = true;
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    if (this.phase !== 'gap') {
      const board = (y: number) => {
        r.rect(98, y, 124, 36, PAL.line);
        r.text(this.prompt, 160, y + 2, PAL.yellow, 'center');
        this.labels.forEach((label, i) => {
          const x = 100 + (i % 2) * 61;
          const yy = y + 13 + Math.floor(i / 2) * 11;
          const c = SEAT_COLORS[i];
          r.rect(x, yy, 59, 10, c.shadow);
          r.rect(x, yy, 3, 10, c.base);
          const rank = this.answer.indexOf(i);
          const show = this.phase === 'reveal';
          r.text(show ? `${rank + 1}.${label}` : label, x + 32, yy + 1, PAL.text, 'center');
        });
      };
      const flipped = this.ctx.players.some((p) => p.flipped);
      if (flipped) {
        board(92);
        r.rotated180(160, 90, 0, 0, () => board(92));
      } else board(72);
    }
    for (const p of this.ctx.players) {
      const a = sideAnchor(p, this.ctx.humanCount);
      const won = this.phase === 'reveal' && this.winners.includes(p.seat);
      const pose = won ? 'win' : this.locked.has(p.seat) ? 'lose' : 'idle';
      facing(r, p, a.x, a.y, () => {
        drawCharacter(r.ctx, p.seat, pose, this.t + p.seat * 0.3, a.x - CHAR_SIZE / 2, a.y - CHAR_SIZE / 2 - 4);
        // 지금까지 맞게 누른 개수
        const n = this.progress.get(p.seat) ?? 0;
        for (let i = 0; i < 4; i++) r.rect(a.x - 8 + i * 4, a.y + 10, 3, 2, i < n ? p.color.base : PAL.bgMid);
      });
      const tag = localOffset(p, a, 24, -6);
      drawScoreTag(r, p, tag.x, tag.y, this.scores.get(p.seat) ?? 0);
    }
    drawTimer(r, DURATION - this.t, TIMER_X, TIMER_Y);
  }
}

/** 문제를 읽는 시간 뒤에 한 칸씩 누른다. 가끔 순서를 헷갈린다. */
class OrderQuizAI implements AiController {
  private readonly hand: AiHand;
  private question = -1;
  private readonly read: readonly [number, number];
  private readonly step: number;
  private readonly wrong: number;

  constructor(
    private readonly game: OrderQuiz,
    player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.read = byDifficulty(player.difficulty, { easy: [1.4, 2.2], normal: [1.0, 1.6], hard: [0.7, 1.1] });
    this.step = byDifficulty(player.difficulty, { easy: 0.45, normal: 0.32, hard: 0.22 });
    this.wrong = byDifficulty(player.difficulty, { easy: 0.3, normal: 0.15, hard: 0.06 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished) return;
    if (g.phase !== 'ask') {
      if (this.hand.busy) this.hand.reset();
      return;
    }
    if (g.question === this.question) return;
    this.question = g.question;
    const rng = g.rng;
    const seq = [...g.answer];
    if (rng.next() < this.wrong) {
      const i = Math.floor(rng.next() * 3);
      [seq[i], seq[i + 1]] = [seq[i + 1], seq[i]];
    }
    let at = this.read[0] + rng.next() * (this.read[1] - this.read[0]);
    for (const b of seq) {
      this.hand.tap(b, at, 0.04);
      at += this.step * (0.7 + rng.next() * 0.6);
    }
  }
}

export const G41 = defineGame({
  code: 'G41',
  controls: 'four',
  padStyle: (_seat, index) => ({ color: SEAT_COLORS[index] }),
  create: () => new OrderQuiz(),
  createAI: (game, player, controls) => new OrderQuizAI(game, player, controls),
});
