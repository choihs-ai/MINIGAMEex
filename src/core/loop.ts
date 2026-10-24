/** 게임 로직 갱신 간격(초). 화면 주사율과 상관없이 로직은 항상 60Hz로 돈다. */
export const STEP = 1 / 60;
// 탭 전환 등으로 오래 멈췄다 돌아왔을 때 한꺼번에 따라잡지 않도록 제한
const MAX_FRAME = 0.25;

export interface LoopHandlers {
  update(dt: number): void;
  render(): void;
}

export function startLoop({ update, render }: LoopHandlers): void {
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    acc += Math.min(Math.max(0, (now - last) / 1000), MAX_FRAME);
    last = now;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
