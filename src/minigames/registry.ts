import { G01 } from './G01';
import { G02 } from './G02';
import { G03 } from './G03';
import { G08 } from './G08';
import { G09 } from './G09';
import { G11 } from './G11';
import { G13 } from './G13';
import { G14 } from './G14';
import { G19 } from './G19';
import { G20 } from './G20';
import { G21 } from './G21';
import { G22 } from './G22';
import { G23 } from './G23';
import { G24 } from './G24';
import { G25 } from './G25';
import { G26 } from './G26';
import { G27 } from './G27';
import { G28 } from './G28';
import { G29 } from './G29';
import { G30 } from './G30';
import { G50 } from './G50';
import { G51 } from './G51';
import { G52 } from './G52';
import { G53 } from './G53';
import { G54 } from './G54';
import { G57 } from './G57';
import type { MiniGameEntry } from './types';

export const GAMES: Readonly<Record<string, MiniGameEntry>> = {
  G01,
  G02,
  G03,
  G08,
  G09,
  G11,
  G13,
  G14,
  G19,
  G20,
  G21,
  G22,
  G23,
  G24,
  G25,
  G26,
  G27,
  G28,
  G29,
  G30,
  G50,
  G51,
  G52,
  G53,
  G54,
  G57,
};

/** 지금까지 완성된 미니게임(메뉴·토너먼트에 나오는 것). 코드 순. */
export const READY_GAMES: readonly string[] = Object.keys(GAMES).sort();
