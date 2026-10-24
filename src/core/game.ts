import type { Sfx } from '../audio/sfx';
import type { Input } from '../input/input';
import type { PlayerSlot, Seat } from '../input/seats';
import type { PixelFont } from '../render/font';
import type { Screen } from '../render/screen';
import type { Fx } from './fx';
import type { SceneManager } from './sceneManager';

/** 화면들이 공유하는 현재 판 정보 */
export interface Session {
  /** 참가한 모서리(참가 순서). 2인일 때만 순서가 1P/2P를 정한다. */
  joined: Seat[];
  /** 게임 중 배치(인원 확정 뒤 계산) */
  players: PlayerSlot[];
}

/** 모든 화면이 쓰는 공통 서비스 모음 */
export interface Game {
  screen: Screen;
  font: PixelFont;
  input: Input;
  audio: Sfx;
  fx: Fx;
  scenes: SceneManager;
  session: Session;
  /** 이 시간(초) 동안 게임 속도를 0.3배로 늦춘다(승리 순간 슬로모션) */
  slowmo(seconds: number): void;
}
