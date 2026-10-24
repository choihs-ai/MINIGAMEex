import type { Renderer } from '../render/renderer';

/** 화면 하나(타이틀, 로비, 미니게임, 결과 등). update는 고정 간격으로, render는 매 프레임 호출된다. */
export interface Scene {
  /** 화면이 켜질 때(전환이 끝나고 보이기 직전) 한 번 호출된다. 터치 구역 설정 등을 한다. */
  enter?(): void;
  update(dt: number): void;
  render(r: Renderer): void;
}
