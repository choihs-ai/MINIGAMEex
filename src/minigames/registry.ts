import { G01 } from './G01';
import { G19 } from './G19';
import { G22 } from './G22';
import type { MiniGameEntry } from './types';

export const GAMES: Readonly<Record<string, MiniGameEntry>> = { G01, G19, G22 };

/** 지금까지 완성된 미니게임(로비에서 시작하면 이 순서로 한 판씩) */
export const READY_GAMES: readonly string[] = ['G01', 'G19', 'G22'];
