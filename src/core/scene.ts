import type { Renderer } from '../render/renderer';

/** 화면 하나(로비, 미니게임, 결과 등). update는 고정 간격으로, render는 매 프레임 호출된다. */
export interface Scene {
  update(dt: number): void;
  render(r: Renderer): void;
}
