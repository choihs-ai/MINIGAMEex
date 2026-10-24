import { BASE_H, BASE_W, computeLayout, type Insets, type Layout } from './layout';
import { get2d } from './canvas';
import { LETTERBOX } from './palette';

/**
 * 화면 전체를 덮는 표시용 캔버스와 기준 해상도 버퍼 캔버스를 관리한다.
 * 게임은 버퍼(320×180)에만 그리고, present()가 정수배로 확대해 표시 캔버스에 옮긴다.
 */
export class Screen {
  readonly buffer: HTMLCanvasElement;
  readonly bufferCtx: CanvasRenderingContext2D;
  layout: Layout = { scale: 1, x: 0, y: 0, width: BASE_W, height: BASE_H };
  portrait = false;

  private readonly ctx: CanvasRenderingContext2D;
  private cssW = -1;
  private cssH = -1;
  private dpr = -1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly safeAreaProbe: HTMLElement,
  ) {
    this.ctx = get2d(canvas);
    this.buffer = document.createElement('canvas');
    this.bufferCtx = get2d(this.buffer);
    this.fit();
  }

  get width(): number {
    return this.buffer.width;
  }

  get height(): number {
    return this.buffer.height;
  }

  /**
   * 화면 크기·방향이 바뀌었으면 다시 배치한다. 매 프레임 호출한다.
   * (iOS는 회전 직후 resize 이벤트 시점의 크기가 틀릴 때가 있어 이벤트 대신 매 프레임 확인)
   */
  fit(): void {
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (cssW === this.cssW && cssH === this.cssH && dpr === this.dpr) return;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;

    const viewW = Math.round(cssW * dpr);
    const viewH = Math.round(cssH * dpr);
    this.canvas.width = viewW;
    this.canvas.height = viewH;

    this.portrait = cssH > cssW;
    const logicalW = this.portrait ? BASE_H : BASE_W;
    const logicalH = this.portrait ? BASE_W : BASE_H;
    if (this.buffer.width !== logicalW || this.buffer.height !== logicalH) {
      this.buffer.width = logicalW;
      this.buffer.height = logicalH;
    }

    this.layout = computeLayout(viewW, viewH, this.readInsets(dpr), logicalW, logicalH);

    // 캔버스 크기를 바꾸면 상태가 초기화되므로 다시 설정한다.
    this.bufferCtx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
    // 레터박스는 크기가 바뀔 때만 칠한다. 기준 화면 영역은 present()가 매번 덮어쓴다.
    this.ctx.fillStyle = LETTERBOX;
    this.ctx.fillRect(0, 0, viewW, viewH);
  }

  /** 버퍼를 정수배로 확대해 표시 캔버스에 옮긴다. */
  present(): void {
    const { x, y, width, height } = this.layout;
    this.ctx.drawImage(this.buffer, 0, 0, this.buffer.width, this.buffer.height, x, y, width, height);
  }

  private readInsets(dpr: number): Insets {
    const s = getComputedStyle(this.safeAreaProbe);
    return {
      top: (parseFloat(s.paddingTop) || 0) * dpr,
      right: (parseFloat(s.paddingRight) || 0) * dpr,
      bottom: (parseFloat(s.paddingBottom) || 0) * dpr,
      left: (parseFloat(s.paddingLeft) || 0) * dpr,
    };
  }
}
