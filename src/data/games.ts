import raw from '../../docs/games.json';

/** 미니게임 세부표 한 줄(docs/games.json, 원본은 세부표 xlsx) */
export interface GameInfo {
  code: string;
  /** 개발용 이름. 화면에는 보여주지 않는다. */
  name: string;
  icon: string;
  category: string;
  flow: string;
  controls: string;
  rules: string;
  ranking: string;
  duration: string;
  ai: string;
  /** 1인(AI) 가능 */
  solo: boolean;
  /** 랜덤 뽑기(토너먼트) 후보 */
  random7: boolean;
  note: string | null;
  /** 파티 모드 전용(다른 모드에 절대 섞이지 않음) */
  partyOnly: boolean;
}

export const GAME_INFO: readonly GameInfo[] = raw as GameInfo[];

const byCode = new Map(GAME_INFO.map((g) => [g.code, g]));

export function gameInfo(code: string): GameInfo {
  const info = byCode.get(code);
  if (!info) throw new Error(`세부표에 없는 게임: ${code}`);
  return info;
}
