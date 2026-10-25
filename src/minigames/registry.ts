import { G01 } from './G01';
import { G02 } from './G02';
import { G14 } from './G14';
import { G19 } from './G19';
import { G22 } from './G22';
import { G28 } from './G28';
import { G30 } from './G30';
import { G50 } from './G50';
import { G51 } from './G51';
import { G52 } from './G52';
import { G53 } from './G53';
import type { MiniGameEntry } from './types';

export const GAMES: Readonly<Record<string, MiniGameEntry>> = { G01, G02, G14, G19, G22, G28, G30, G50, G51, G52, G53 };

/** 지금까지 완성된 미니게임(메뉴·토너먼트에 나오는 것). 코드 순. */
export const READY_GAMES: readonly string[] = Object.keys(GAMES).sort();
