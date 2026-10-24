import type { Seat } from '../input/seats';

/**
 * 판마다 순위점: 1등이 (참가 인원 − 1)점, 한 등수 내려갈 때마다 1점씩, 꼴찌는 0점.
 * (4인 3·2·1·0, 3인 2·1·0, 2인 1·0)
 * 공동 순위는 같은 점수이고, 그다음 사람은 공동 인원만큼 건너뛴 등수의 점수를 받는다.
 * (4인에서 공동 1등 둘 → 둘 다 3점, 다음 사람은 3등 점수 1점)
 */
export function rankPoints(ranking: readonly Seat[][], playerCount: number): Map<Seat, number> {
  const points = new Map<Seat, number>();
  let ahead = 0;
  for (const group of ranking) {
    for (const seat of group) points.set(seat, Math.max(0, playerCount - 1 - ahead));
    ahead += group.length;
  }
  return points;
}

/** 이 판에서 나보다 앞선 사람 수(0이면 1등, 공동 1등 포함) */
export function placeOf(ranking: readonly Seat[][], seat: Seat): number {
  let ahead = 0;
  for (const group of ranking) {
    if (group.includes(seat)) return ahead;
    ahead += group.length;
  }
  return ahead;
}

export interface GameRecord {
  code: string;
  ranking: Seat[][];
}

export function totalPoints(records: readonly GameRecord[], seats: readonly Seat[]): Map<Seat, number> {
  const totals = new Map<Seat, number>(seats.map((s) => [s, 0]));
  for (const r of records) {
    for (const [seat, p] of rankPoints(r.ranking, seats.length)) totals.set(seat, (totals.get(seat) ?? 0) + p);
  }
  return totals;
}

/** 1등(공동 포함)을 한 횟수 */
export function firstPlaceCounts(records: readonly GameRecord[], seats: readonly Seat[]): Map<Seat, number> {
  const firsts = new Map<Seat, number>(seats.map((s) => [s, 0]));
  for (const r of records) for (const seat of r.ranking[0] ?? []) firsts.set(seat, (firsts.get(seat) ?? 0) + 1);
  return firsts;
}

export type DecidedBy = 'score' | 'firsts' | 'lastGame' | 'suddenDeath' | 'shared';

export interface Standings {
  /** 최종 순위(1위부터, 공동은 같은 배열) */
  ranking: Seat[][];
  totals: Map<Seat, number>;
  /** 우승자를 무엇으로 가렸는지 */
  decidedBy: DecidedBy;
  /** ①②로도 1위가 갈리지 않아 서든데스가 필요한 사람들(없으면 null) */
  suddenDeath: Seat[] | null;
}

/**
 * 최종 순위: 총점 → ① 1등 횟수 → ② 마지막 판 순위. 그래도 1위가 같으면 ③ 서든데스가 필요하다고 알려준다.
 * 1위가 아닌 자리의 동점은 공동 순위로 둔다.
 */
export function finalStandings(records: readonly GameRecord[], seats: readonly Seat[]): Standings {
  const totals = totalPoints(records, seats);
  const firsts = firstPlaceCounts(records, seats);
  const last = records[records.length - 1];
  const lastPlace = (s: Seat) => (last ? placeOf(last.ranking, s) : 0);
  const key = (s: Seat): [number, number, number] => [-(totals.get(s) ?? 0), -(firsts.get(s) ?? 0), lastPlace(s)];
  const cmp = (a: Seat, b: Seat) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  };

  const sorted = [...seats].sort((a, b) => cmp(a, b) || a - b);
  const ranking: Seat[][] = [];
  for (const s of sorted) {
    const prev = ranking[ranking.length - 1];
    if (prev && cmp(prev[0], s) === 0) prev.push(s);
    else ranking.push([s]);
  }

  // 1위가 무엇으로 갈렸는지
  const top = (list: Seat[], pick: (s: Seat) => number) => {
    const best = Math.min(...list.map(pick));
    return list.filter((s) => pick(s) === best);
  };
  const byScore = top([...seats], (s) => key(s)[0]);
  let decidedBy: DecidedBy = 'score';
  let suddenDeath: Seat[] | null = null;
  if (byScore.length > 1) {
    const byFirsts = top(byScore, (s) => key(s)[1]);
    if (byFirsts.length === 1) decidedBy = 'firsts';
    else {
      const byLast = top(byFirsts, (s) => key(s)[2]);
      if (byLast.length === 1) decidedBy = 'lastGame';
      else {
        decidedBy = 'suddenDeath';
        suddenDeath = byLast;
      }
    }
  }
  return { ranking, totals, decidedBy, suddenDeath };
}

/**
 * 서든데스 결과를 최종 순위에 반영한다. 서든데스 1위(winners)가 맨 앞, 나머지 동점자는 그 바로 아래 공동.
 * winners가 여러 명이면(끝내 안 갈리면) 공동 우승.
 */
export function applySuddenDeath(standings: Standings, winners: readonly Seat[]): Standings {
  const tied = standings.suddenDeath ?? [];
  const rest = tied.filter((s) => !winners.includes(s));
  const ranking: Seat[][] = [[...winners]];
  if (rest.length) ranking.push(rest);
  for (const group of standings.ranking) {
    const others = group.filter((s) => !tied.includes(s));
    if (others.length) ranking.push(others);
  }
  return { ...standings, ranking, suddenDeath: null, decidedBy: winners.length > 1 ? 'shared' : 'suddenDeath' };
}
