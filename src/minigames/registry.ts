import { G01 } from './G01';
import { G03 } from './G03';
import { G04 } from './G04';
import { G06 } from './G06';
import { G07 } from './G07';
import { G08 } from './G08';
import { G11 } from './G11';
import { G12 } from './G12';
import { G16 } from './G16';
import { G18 } from './G18';
import { G19 } from './G19';
import { G21 } from './G21';
import { G22 } from './G22';
import { G23 } from './G23';
import { G24 } from './G24';
import { G25 } from './G25';
import { G26 } from './G26';
import { G27 } from './G27';
import { G29 } from './G29';
import { G30 } from './G30';
import { G31 } from './G31';
import { G32 } from './G32';
import { G33 } from './G33';
import { G35 } from './G35';
import { G36 } from './G36';
import { G37 } from './G37';
import { G39 } from './G39';
import { G40 } from './G40';
import { G41 } from './G41';
import { G45 } from './G45';
import { G46 } from './G46';
import { G49 } from './G49';
import { G50 } from './G50';
import { G51 } from './G51';
import { G52 } from './G52';
import { G53 } from './G53';
import { G54 } from './G54';
import { G57 } from './G57';
import { G58 } from './G58';
import type { MiniGameEntry } from './types';

export const GAMES: Readonly<Record<string, MiniGameEntry>> = {
  G01,
  G03,
  G04,
  G06,
  G07,
  G08,
  G11,
  G12,
  G16,
  G18,
  G19,
  G21,
  G22,
  G23,
  G24,
  G25,
  G26,
  G27,
  G29,
  G30,
  G31,
  G32,
  G33,
  G35,
  G36,
  G37,
  G39,
  G40,
  G41,
  G45,
  G46,
  G49,
  G50,
  G51,
  G52,
  G53,
  G54,
  G57,
  G58,
};

/** 지금까지 완성된 미니게임(메뉴·토너먼트에 나오는 것). 코드 순. */
export const READY_GAMES: readonly string[] = Object.keys(GAMES).sort();
