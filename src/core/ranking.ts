import type { Seat } from '../input/seats';

export interface ScoreEntry {
  seat: Seat;
  score: number;
}

/**
 * 점수가 높은 순으로 순위를 매긴다. MiniGame.getRanking()과 같은 모양:
 * 1위부터, 공동 순위는 같은 배열에 묶는다.
 */
export function rankByScore(entries: readonly ScoreEntry[], higherIsBetter = true): Seat[][] {
  const sorted = [...entries].sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score) || a.seat - b.seat);
  const groups: Seat[][] = [];
  let last: number | null = null;
  for (const e of sorted) {
    if (e.score === last) groups[groups.length - 1].push(e.seat);
    else groups.push([e.seat]);
    last = e.score;
  }
  return groups;
}

export interface EliminationEntry {
  seat: Seat;
  /** 탈락한 시각(살아남았으면 null) */
  outAt: number | null;
}

/**
 * 탈락 역순 순위: 끝까지 살아남은 사람은 공동 1위, 나머지는 늦게 떨어진 순.
 * 같은 순간에 떨어진 사람은 공동 순위.
 */
export function rankByElimination(entries: readonly EliminationEntry[]): Seat[][] {
  const survivors = entries.filter((e) => e.outAt === null).map((e) => e.seat).sort((a, b) => a - b);
  const out = entries.filter((e) => e.outAt !== null).sort((a, b) => b.outAt! - a.outAt! || a.seat - b.seat);
  const groups: Seat[][] = survivors.length > 0 ? [survivors] : [];
  let last: number | null = null;
  for (const e of out) {
    if (e.outAt === last) groups[groups.length - 1].push(e.seat);
    else groups.push([e.seat]);
    last = e.outAt;
  }
  return groups;
}
