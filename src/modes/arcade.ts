import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { GAMES } from '../minigames/registry';
import { CountdownScene } from '../scenes/countdown';
import { MenuScene } from '../scenes/menu';
import { MiniGameScene } from '../scenes/miniGame';
import { ResultScene, type ResultAction } from '../scenes/result';

/** 미니게임 한 판: 아이콘+3·2·1 → 게임 → 결과(actions의 버튼들) */
export function playGame(game: Game, code: string, actions: () => ResultAction[]): Scene {
  const entry = GAMES[code];
  return new CountdownScene(game, code, () =>
    new MiniGameScene(game, entry, (ranking, rows) => new ResultScene(game, rows, ranking, actions())),
  );
}

/** 아케이드(메인 메뉴에서 고른 게임 1판): 결과에서 "다시" 또는 "메뉴" */
export function playArcade(game: Game, code: string): Scene {
  return playGame(game, code, () => [
    { label: '다시', next: () => playArcade(game, code) },
    { label: '메뉴', next: () => new MenuScene(game) },
  ]);
}
