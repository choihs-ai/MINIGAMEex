import type { Rng } from '../core/rng';
import type { PlayerControls } from '../input/controls';
import type { Difficulty } from './types';

type Action =
  | { at: number; kind: 'press' | 'release'; button: number }
  | { at: number; kind: 'down' | 'move'; x: number; y: number }
  | { at: number; kind: 'up' };

/**
 * AI의 "손". 정해진 시각에 버튼을 누르고 떼거나, 화면을 탭·드래그하는 예약만 할 수 있다.
 * 반응 지연은 예약 시각을 늦추는 것으로 표현한다.
 */
export class AiHand {
  private t = 0;
  private queue: Action[] = [];

  constructor(readonly controls: PlayerControls) {}

  /** delay초 뒤에 눌렀다가 hold초 뒤에 뗀다 */
  tap(button = 0, delay = 0, hold = 0.05): void {
    this.schedule({ at: delay, kind: 'press', button });
    this.schedule({ at: delay + hold, kind: 'release', button });
  }

  pressIn(button: number, delay = 0): void {
    this.schedule({ at: delay, kind: 'press', button });
  }

  releaseIn(button: number, delay = 0): void {
    this.schedule({ at: delay, kind: 'release', button });
  }

  /** delay초 뒤에 화면 (x, y)를 톡 친다 */
  tapAt(x: number, y: number, delay = 0): void {
    this.schedule({ at: delay, kind: 'down', x, y });
    this.schedule({ at: delay + 0.04, kind: 'up' });
  }

  /** delay초 뒤에 (sx, sy)를 누르고 duration초 동안 (ex, ey)까지 끈 다음 뗀다 */
  drag(sx: number, sy: number, ex: number, ey: number, delay = 0, duration = 0.3): void {
    this.schedule({ at: delay, kind: 'down', x: sx, y: sy });
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      this.schedule({ at: delay + duration * k, kind: 'move', x: sx + (ex - sx) * k, y: sy + (ey - sy) * k });
    }
    this.schedule({ at: delay + duration + 0.02, kind: 'up' });
  }

  /** 예약을 모두 취소하고 누르고 있던 버튼을 뗀다. */
  reset(): void {
    this.queue = [];
    this.controls.releaseAll();
    this.controls.pointerUp();
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  update(dt: number): void {
    this.t += dt;
    while (this.queue.length > 0 && this.queue[0].at <= this.t) {
      const a = this.queue.shift()!;
      if (a.kind === 'press') this.controls.press(a.button);
      else if (a.kind === 'release') this.controls.release(a.button);
      else if (a.kind === 'down') this.controls.pointerDown(a.x, a.y);
      else if (a.kind === 'move') this.controls.pointerMove(a.x, a.y);
      else this.controls.pointerUp();
    }
  }

  /** a.at은 지금부터의 지연(초). 같은 시각끼리는 예약한 순서를 지킨다. */
  private schedule(a: Action): void {
    this.queue.push({ ...a, at: this.t + Math.max(0, a.at) });
    this.queue.sort((p, q) => p.at - q.at);
  }
}

export function byDifficulty<T>(d: Difficulty, values: { easy: T; normal: T; hard: T }): T {
  return values[d];
}

/** 표준편차가 대략 sigma인 흔들림(균등 난수 3개의 합). AI의 타이밍 오차에 쓴다. */
export function jitter(rng: Rng, sigma: number): number {
  return (rng.next() + rng.next() + rng.next() - 1.5) * 2 * sigma;
}
