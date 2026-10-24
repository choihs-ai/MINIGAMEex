import { STEP } from '../src/core/loop';
import { createRng } from '../src/core/rng';
import { BUTTON_COUNT, PlayerControls } from '../src/input/controls';
import { layoutPlayers, type Seat } from '../src/input/seats';
import { buildPlayers } from '../src/minigames/players';
import type { FxApi, GameContext, MiniGame, MiniGameEntry, PlayerInfo, SfxApi } from '../src/minigames/types';

/** 소리·효과는 아무것도 안 하는 대역 */
export const noop = new Proxy({}, { get: () => () => {} }) as unknown as FxApi & SfxApi;

export interface Harness<G extends MiniGame = MiniGame> {
  game: G;
  players: PlayerInfo[];
  controls: Map<Seat, PlayerControls>;
  ctx: GameContext;
  /** n틱 진행. AI가 있으면 생각한 뒤 게임을 갱신한다. */
  step(ticks?: number): void;
}

/**
 * 실제 화면과 같은 배치(joined 순서)로 게임을 만든다.
 * withAI면 모든 자리를 AI가 같은 버튼으로 조작한다(사람 자리 포함).
 */
export function harness<G extends MiniGame>(
  entry: MiniGameEntry,
  joined: Seat[],
  { seed = 1, withAI = false }: { seed?: number; withAI?: boolean } = {},
): Harness<G> {
  const players = buildPlayers(layoutPlayers(joined), 'normal').map((p) => ({ ...p, isAI: withAI || p.isAI }));
  const controls = new Map(players.map((p) => [p.seat, new PlayerControls(BUTTON_COUNT[entry.controls])]));
  const { game, createAI } = entry.create();
  const ctx: GameContext = { players, controls, humanCount: joined.length, rng: createRng(seed), fx: noop, sfx: noop };
  game.setup(ctx);
  const ais = players.filter((p) => p.isAI).map((p) => createAI(p, controls.get(p.seat)!));
  return {
    game: game as G,
    players,
    controls,
    ctx,
    step(ticks = 1) {
      for (let i = 0; i < ticks; i++) {
        for (const ai of ais) ai.think(STEP);
        game.update(STEP);
        for (const c of controls.values()) c.endTick(STEP);
      }
    },
  };
}

/** 끝날 때까지 돌린다(안전장치: maxSeconds) */
export function runToEnd(h: Harness, maxSeconds = 300): number {
  let ticks = 0;
  while (!h.game.isFinished() && ticks < maxSeconds / STEP) {
    h.step();
    ticks++;
  }
  return ticks * STEP;
}

/** 순위가 참가자 전원을 정확히 한 번씩 포함하는지 */
export function expectPartition(ranking: Seat[][], players: PlayerInfo[]): boolean {
  const flat = ranking.flat().sort();
  const seats = players.map((p) => p.seat).sort();
  return ranking.every((g) => g.length > 0) && JSON.stringify(flat) === JSON.stringify(seats);
}
