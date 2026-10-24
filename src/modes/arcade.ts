import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { GAMES } from '../minigames/registry';
import { CountdownScene } from '../scenes/countdown';
import { MenuScene } from '../scenes/menu';
import { MiniGameScene } from '../scenes/miniGame';
import { ResultScene, type ResultRow } from '../scenes/result';
import type { PlayerSlot, Seat } from '../input/seats';
import type { MiniGameEntry } from '../minigames/types';

export interface PlayOptions {
  /** 기본 대신 쓸 게임 정의(예: 서든데스용 칼 뽑기) */
  entry?: MiniGameEntry;
  /** 이 판에 참가하는 사람(없으면 전원) */
  slots?: readonly PlayerSlot[];
}

/** 미니게임 한 판: 아이콘+3·2·1 → 게임 → onDone(순위, 결과 줄)이 돌려주는 화면 */
export function playGame(
  game: Game,
  code: string,
  onDone: (ranking: Seat[][], rows: ResultRow[]) => Scene,
  opts: PlayOptions = {},
): Scene {
  const entry = opts.entry ?? GAMES[code];
  return new CountdownScene(game, code, () => new MiniGameScene(game, entry, onDone, opts.slots), opts.slots);
}

/** 아케이드(메인 메뉴에서 고른 게임 1판): 결과에서 "다시" 또는 "메뉴" */
export function playArcade(game: Game, code: string): Scene {
  return playGame(game, code, (ranking, rows) =>
    new ResultScene(game, rows, ranking, [
      { label: '다시', next: () => playArcade(game, code) },
      { label: '메뉴', next: () => new MenuScene(game) },
    ]),
  );
}
