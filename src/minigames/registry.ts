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
import { G62 } from './G62';
import { G63 } from './G63';
import { G64 } from './G64';
import { G65 } from './G65';
import { G66 } from './G66';
import { G67 } from './G67';
import { G68 } from './G68';
import { G69 } from './G69';
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
  G62,
  G63,
  G64,
  G65,
  G66,
  G67,
  G68,
  G69,
};

/**
 * 메뉴·토너먼트에서 숨긴 게임(누르기·피하기·타이밍 위주라 같이 놀 때 재미가 덜한 것).
 * 코드는 남겨 두고 #game=코드 로는 바로 열 수 있다. G19는 서든데스 전용으로 계속 쓴다.
 */
export const HIDDEN_GAMES: ReadonlySet<string> = new Set([
  // 반응·누르기
  'G11', 'G16', 'G18', 'G19', 'G21', 'G23', 'G35', 'G36', 'G41', 'G45', 'G49', 'G54',
  // 피하기·버티기
  'G03', 'G22', 'G30', 'G57',
  // 타이밍
  'G50', 'G51', 'G52', 'G53',
  // 그 밖
  'G08', 'G37', 'G39', 'G40',
]);

/** 메뉴·토너먼트에 나오는 미니게임. 코드 순. */
export const READY_GAMES: readonly string[] = Object.keys(GAMES)
  .filter((c) => !HIDDEN_GAMES.has(c))
  .sort();
