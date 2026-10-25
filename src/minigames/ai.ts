import type { Rng } from '../core/rng';
import type { PlayerControls } from '../input/controls';
import type { Difficulty } from './types';

interface Action {
  at: number;
  press: boolean;
  button: number;
}

/**
 * AI의 "손". 정해진 시각에 버튼을 누르고 떼는 예약만 할 수 있다.
 * 반응 지연은 예약 시각을 늦추는 것으로 표현한다.
 */
export class AiHand {
  private t = 0;
  private queue: Action[] = [];

  constructor(readonly controls: PlayerControls) {}

  /** delay초 뒤에 눌렀다가 hold초 뒤에 뗀다 */
  tap(button = 0, delay = 0, hold = 0.05): void {
    this.schedule(button, true, delay);
    this.schedule(button, false, delay + hold);
  }

  pressIn(button: number, delay = 0): void {
    this.schedule(button, true, delay);
  }

  releaseIn(button: number, delay = 0): void {
    this.schedule(button, false, delay);
  }

  /** 예약을 모두 취소하고 누르고 있던 버튼을 뗀다. */
  reset(): void {
    this.queue = [];
    this.controls.releaseAll();
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  update(dt: number): void {
    this.t += dt;
    while (this.queue.length > 0 && this.queue[0].at <= this.t) {
      const a = this.queue.shift()!;
      if (a.press) this.controls.press(a.button);
      else this.controls.release(a.button);
    }
  }

  private schedule(button: number, press: boolean, delay: number): void {
    this.queue.push({ at: this.t + Math.max(0, delay), press, button });
    this.queue.sort((a, b) => a.at - b.at);
  }
}

export function byDifficulty<T>(d: Difficulty, values: { easy: T; normal: T; hard: T }): T {
  return values[d];
}

/** 표준편차가 대략 sigma인 흔들림(균등 난수 3개의 합). AI의 타이밍 오차에 쓴다. */
export function jitter(rng: Rng, sigma: number): number {
  return (rng.next() + rng.next() + rng.next() - 1.5) * 2 * sigma;
}
