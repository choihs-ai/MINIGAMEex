import type { Fx } from '../core/fx';
import type { Rng } from '../core/rng';
import type { Sfx } from '../audio/sfx';
import type { ControlLayout, PlayerControls } from '../input/controls';
import type { Rect, Seat } from '../input/seats';
import type { SeatColor } from '../render/palette';
import type { Renderer } from '../render/renderer';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface PlayerInfo {
  seat: Seat;
  color: SeatColor;
  isAI: boolean;
  difficulty: Difficulty;
  /** 위쪽에 앉아 화면을 거꾸로 보는 플레이어 */
  flipped: boolean;
  /** 사람의 터치 구역(AI는 null) */
  zone: Rect | null;
}

/** 미니게임이 쓰는 효과. 테스트에서는 아무것도 안 하는 대역으로 바꿔 끼운다. */
export type FxApi = Pick<Fx, 'shake' | 'burst'>;
export type SfxApi = Pick<
  Sfx,
  'tap' | 'click' | 'beep' | 'go' | 'lose' | 'hit' | 'catchStar' | 'slash' | 'buzz' | 'signal' | 'turn' | 'dash'
>;

export interface GameContext {
  players: readonly PlayerInfo[];
  /** 자리별 버튼 상태. 사람·AI 모두 여기로만 입력이 들어온다. */
  controls: ReadonlyMap<Seat, PlayerControls>;
  /** 사람 수(1이면 AI 3명이 함께한다) */
  humanCount: number;
  rng: Rng;
  fx: FxApi;
  sfx: SfxApi;
}

/** 모든 미니게임이 따르는 공통 인터페이스(지시서 5절) */
export interface MiniGame {
  code: string;
  setup(ctx: GameContext): void;
  update(dt: number): void;
  render(r: Renderer): void;
  isFinished(): boolean;
  /** 1위부터, 공동 순위는 같은 배열 */
  getRanking(): Seat[][];
  /** 협동 게임용 개인 기여 */
  getContribution?(): Partial<Record<Seat, number>>;
  /** 결과 막대 위에 보여줄 이 판의 점수(별 개수, 이긴 라운드 등). 없으면 숫자를 안 보여준다. */
  getScores?(): Partial<Record<Seat, number>>;
  /** 지금 이 플레이어가 누르면 되는 순간인가(버튼을 빛나게 한다) */
  canPress?(seat: Seat): boolean;
}

export interface AiController {
  /** 미니게임 update 직전에 매 틱 호출된다. 사람과 같은 버튼 입력만 만든다. */
  think(dt: number): void;
}

export interface MiniGameEntry {
  code: string;
  controls: ControlLayout;
  create(): { game: MiniGame; createAI(player: PlayerInfo, controls: PlayerControls): AiController };
}

/** 미니게임 등록용. AI 생성 함수가 자기 게임의 상태를 타입 그대로 볼 수 있게 묶어 준다. */
export function defineGame<G extends MiniGame>(spec: {
  code: string;
  controls: ControlLayout;
  create(): G;
  createAI(game: G, player: PlayerInfo, controls: PlayerControls): AiController;
}): MiniGameEntry {
  return {
    code: spec.code,
    controls: spec.controls,
    create: () => {
      const game = spec.create();
      return { game, createAI: (player, controls) => spec.createAI(game, player, controls) };
    },
  };
}
