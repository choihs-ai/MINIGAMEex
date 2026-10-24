import type { Game } from '../core/game';
import type { Scene } from '../core/scene';
import { GAMES } from '../minigames/registry';
import { CountdownScene } from '../scenes/countdown';
import { LobbyScene } from '../scenes/lobby';
import { MiniGameScene } from '../scenes/miniGame';
import { ResultScene } from '../scenes/result';

/** 미니게임 목록을 차례로: 아이콘+3·2·1 → 게임 → 결과 → 다음 게임, 다 끝나면 로비. */
export function playSet(game: Game, codes: readonly string[], index = 0): Scene {
  const entry = GAMES[codes[index]];
  const next = (): Scene => (index + 1 < codes.length ? playSet(game, codes, index + 1) : new LobbyScene(game));
  return new CountdownScene(game, entry.code, () =>
    new MiniGameScene(game, entry, (ranking, rows) => new ResultScene(game, rows, ranking, next)),
  );
}
