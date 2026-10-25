/**
 * 미니게임 조작 배치(버튼 위치는 padButtons.ts).
 * - one 원버튼, leftRight 좌/우(플레이어 기준), upDown 위/아래(화면 기준, 세로로 두 개)
 * - three 버튼 3개, four 버튼 4개(2×2)
 * - pointer 버튼 없이 화면을 직접 탭·드래그(자기 구역 또는 자기 차례)
 */
export type ControlLayout = 'one' | 'leftRight' | 'upDown' | 'three' | 'four' | 'pointer';
export const BUTTON_COUNT: Readonly<Record<ControlLayout, number>> = {
  one: 1,
  leftRight: 2,
  upDown: 2,
  three: 3,
  four: 4,
  pointer: 0,
};
export const BTN_LEFT = 0;
export const BTN_RIGHT = 1;
export const BTN_UP = 0;
export const BTN_DOWN = 1;

export interface Point {
  x: number;
  y: number;
}

/** 화면 위에서 누른 채 끄는 손가락(기준 화면 좌표) */
export interface Drag {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

/**
 * 플레이어 한 명의 가상 버튼 상태. 사람의 터치와 AI가 똑같이 press/release로 입력한다.
 * 같은 버튼을 손가락 여러 개로 누르면 마지막 손가락을 뗄 때 떨어진 것으로 본다.
 * 화면을 직접 만지는 게임(pointer)은 pointerDown/Move/Up으로 탭·드래그를 넣는다.
 */
export class PlayerControls {
  private readonly held: number[];
  private readonly pressedEdge: boolean[];
  private readonly releasedEdge: boolean[];
  private readonly heldTime: number[];

  private taps: Point[] = [];
  private releases: Drag[] = [];
  /** 지금 누른 채 끌고 있는 손가락(첫 손가락 하나) */
  drag: Drag | null = null;

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

  pointerDown(x: number, y: number): void {
    this.taps.push({ x, y });
    if (!this.drag) this.drag = { startX: x, startY: y, x, y };
  }

  pointerMove(x: number, y: number): void {
    if (!this.drag) return;
    this.drag.x = x;
    this.drag.y = y;
  }

  pointerUp(): void {
    if (!this.drag) return;
    this.releases.push({ ...this.drag });
    this.drag = null;
  }

  /** 이번 틱에 화면에 닿은 위치들 */
  get tapsThisTick(): readonly Point[] {
    return this.taps;
  }

  /** 이번 틱에 끝난 드래그들(시작점·끝점) */
  get releasesThisTick(): readonly Drag[] {
    return this.releases;
  }

  /** 미니게임 update가 끝난 뒤 호출: 이번 틱의 눌림/뗌·탭 표시를 지우고 누른 시간을 늘린다. */
  endTick(dt: number): void {
    this.taps = [];
    this.releases = [];
    for (let b = 0; b < this.buttonCount; b++) {
      this.pressedEdge[b] = false;
      this.releasedEdge[b] = false;
      if (this.held[b] > 0) this.heldTime[b] += dt;
    }
  }
}
