import type { Screen } from '../render/screen';
import { TouchTracker, type Zone } from './touch';

/** 포인터 이벤트를 기준 화면 좌표로 바꿔 TouchTracker에 넣는다. */
export class Input {
  readonly tracker = new TouchTracker();
  /** 사용자의 첫 제스처(오디오 잠금 해제용). pointerdown과 pointerup 모두에서 호출된다. */
  onGesture: () => void = () => {};

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly screen: Screen,
  ) {
    const opts = { passive: false } as const;
    canvas.addEventListener('pointerdown', (e) => this.handleDown(e), opts);
    canvas.addEventListener('pointermove', (e) => this.handleMove(e), opts);
    canvas.addEventListener('pointerup', (e) => this.handleUp(e), opts);
    canvas.addEventListener('pointercancel', (e) => this.handleUp(e), opts);
  }

  setZones(zones: Zone[]): void {
    this.tracker.setZones(zones);
  }

  reset(): void {
    this.tracker.reset();
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / rect.width;
    const { layout } = this.screen;
    // 레터박스·안전 영역에서 눌러도 가장 가까운 기준 화면 가장자리 픽셀로 본다.
    const x = ((e.clientX - rect.left) * dpr - layout.x) / layout.scale;
    const y = ((e.clientY - rect.top) * dpr - layout.y) / layout.scale;
    return {
      x: Math.min(this.screen.width - 1, Math.max(0, x)),
      y: Math.min(this.screen.height - 1, Math.max(0, y)),
    };
  }

  private handleDown(e: PointerEvent): void {
    e.preventDefault();
    this.onGesture();
    if (this.screen.portrait) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 캡처 실패는 무시
    }
    const { x, y } = this.toLogical(e);
    this.tracker.down(e.pointerId, x, y, performance.now());
  }

  private handleMove(e: PointerEvent): void {
    e.preventDefault();
    if (this.screen.portrait) return;
    const { x, y } = this.toLogical(e);
    this.tracker.move(e.pointerId, x, y);
  }

  private handleUp(e: PointerEvent): void {
    e.preventDefault();
    this.onGesture();
    this.tracker.up(e.pointerId);
  }
}
