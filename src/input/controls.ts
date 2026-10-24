/** 미니게임 조작 배치: 원버튼 또는 좌/우 2버튼(플레이어 기준). 버튼 위치는 padButtons.ts */
export type ControlLayout = 'one' | 'leftRight';
export const BUTTON_COUNT: Readonly<Record<ControlLayout, number>> = { one: 1, leftRight: 2 };
export const BTN_LEFT = 0;
export const BTN_RIGHT = 1;

/**
 * 플레이어 한 명의 가상 버튼 상태. 사람의 터치와 AI가 똑같이 press/release로 입력한다.
 * 같은 버튼을 손가락 여러 개로 누르면 마지막 손가락을 뗄 때 떨어진 것으로 본다.
 */
export class PlayerControls {
  private readonly held: number[];
  private readonly pressedEdge: boolean[];
  private readonly releasedEdge: boolean[];
  private readonly heldTime: number[];

  constructor(readonly buttonCount: number) {
    this.held = new Array<number>(buttonCount).fill(0);
    this.pressedEdge = new Array<boolean>(buttonCount).fill(false);
    this.releasedEdge = new Array<boolean>(buttonCount).fill(false);
    this.heldTime = new Array<number>(buttonCount).fill(0);
  }

  press(b = 0): void {
    if (b < 0 || b >= this.buttonCount) return;
    if (this.held[b] === 0) {
      this.pressedEdge[b] = true;
      this.heldTime[b] = 0;
    }
    this.held[b]++;
  }

  release(b = 0): void {
    if (b < 0 || b >= this.buttonCount || this.held[b] === 0) return;
    this.held[b]--;
    if (this.held[b] === 0) this.releasedEdge[b] = true;
  }

  releaseAll(): void {
    for (let b = 0; b < this.buttonCount; b++) {
      if (this.held[b] > 0) this.releasedEdge[b] = true;
      this.held[b] = 0;
    }
  }

  isDown(b = 0): boolean {
    return this.held[b] > 0;
  }

  /** 이번 틱에 눌렸다(같은 틱에 눌렀다 뗀 짧은 탭도 잡힌다). */
  justPressed(b = 0): boolean {
    return this.pressedEdge[b];
  }

  justReleased(b = 0): boolean {
    return this.releasedEdge[b];
  }

  /** 지금 누르고 있는 버튼을 누른 지 몇 초 됐는지(안 누르고 있으면 0) */
  heldFor(b = 0): number {
    return this.held[b] > 0 ? this.heldTime[b] : 0;
  }

  /** 미니게임 update가 끝난 뒤 호출: 이번 틱의 눌림/뗌 표시를 지우고 누른 시간을 늘린다. */
  endTick(dt: number): void {
    for (let b = 0; b < this.buttonCount; b++) {
      this.pressedEdge[b] = false;
      this.releasedEdge[b] = false;
      if (this.held[b] > 0) this.heldTime[b] += dt;
    }
  }
}
