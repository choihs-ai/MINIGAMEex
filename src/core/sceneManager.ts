import type { Renderer } from '../render/renderer';
import { PAL } from '../render/palette';
import type { Scene } from './scene';

const OFF_TIME = 0.24;
const ON_TIME = 0.24;
/** 전환을 이 단계 수로 끊어서 보여준다(부드러운 트윈 대신 프레임 단위) */
const STEPS = 6;

type Phase = 'idle' | 'off' | 'on';

/**
 * 장면 전환: 브라운관 꺼짐(세로로 수축해 가로선이 됨) → 장면 교체 → 켜짐(가로선에서 확장).
 * 전환 중에는 장면 갱신을 멈춘다.
 */
export class SceneManager {
  private current: Scene | null = null;
  private next: Scene | null = null;
  private phase: Phase = 'idle';
  private t = 0;

  get active(): Scene | null {
    return this.current;
  }

  get transitioning(): boolean {
    return this.phase !== 'idle';
  }

  /** instant면 전환 연출 없이 바로 바꾼다(첫 화면). */
  goto(scene: Scene, instant = false): void {
    if (instant || !this.current) {
      this.current = scene;
      this.next = null;
      this.phase = 'idle';
      scene.enter?.();
      return;
    }
    if (this.phase === 'off') {
      this.next = scene;
      return;
    }
    this.next = scene;
    this.phase = 'off';
    this.t = 0;
  }

  update(dt: number): void {
    if (this.phase === 'idle') {
      this.current?.update(dt);
      return;
    }
    this.t += dt;
    if (this.phase === 'off' && this.t >= OFF_TIME) {
      this.current = this.next;
      this.next = null;
      this.current?.enter?.();
      this.phase = 'on';
      this.t = 0;
    } else if (this.phase === 'on' && this.t >= ON_TIME) {
      this.phase = 'idle';
    }
  }

  render(r: Renderer): void {
    this.current?.render(r);
  }

  /** 장면을 그린 뒤 호출: 전환 중이면 화면을 가로선 모양으로 가린다. */
  renderTransition(r: Renderer): void {
    if (this.phase === 'idle') return;
    const total = this.phase === 'off' ? OFF_TIME : ON_TIME;
    const step = Math.min(STEPS, Math.floor((this.t / total) * STEPS));
    // 꺼질 때는 열린 비율이 1→0, 켜질 때는 0→1. 제곱으로 끝에서 빠르게 좁아진다.
    const open = this.phase === 'off' ? 1 - step / STEPS : step / STEPS;
    const bandH = open <= 0 ? 2 : Math.max(2, Math.round(r.height * open * open));
    const top = Math.floor((r.height - bandH) / 2);
    r.rect(0, 0, r.width, top, PAL.line);
    r.rect(0, top + bandH, r.width, r.height - top - bandH, PAL.line);
    if (bandH <= 6) r.rect(0, top, r.width, bandH, PAL.text);
  }
}
