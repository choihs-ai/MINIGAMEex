import type { Sfx } from '../audio/sfx';
import type { Input } from '../input/input';
import type { PlayerSlot, Seat } from '../input/seats';
import type { Difficulty } from '../minigames/types';
import type { PixelFont } from '../render/font';
import type { Screen } from '../render/screen';
import type { Fx } from './fx';
import type { SceneManager } from './sceneManager';

/** 화면들이 공유하는 현재 판 정보 */
export interface Session {
  /** 메인 메뉴에서 고른 인원 수(1~4). 1이면 AI 3명과 함께 */
  playerCount: number;
  /** 참가 자리(1P부터 인원 수만큼) */
  joined: Seat[];
  /** 게임 중 배치(인원 확정 뒤 계산) */
  players: PlayerSlot[];
  /** 1인 모드 AI 난이도(설정 화면은 6단계) */
  difficulty: Difficulty;
  /** 토너먼트 설정(다시 하기에 그대로 쓴다) */
  tournament: TournamentSettings;
  /** 직전 토너먼트에 나온 게임(다음 뽑기에서 가중치를 낮춘다) */
  lastSet: string[];
  /** 권한을 거부해 뽑기에서 빼는 게임(G39 기울기, G40 마이크) */
  deniedGames: string[];
}

export interface TournamentSettings {
  /** 판 수 */
  rounds: number;
  /** 반드시 넣을 게임 */
  fixed: string[];
  /** 빼는 게임 */
  banned: string[];
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
