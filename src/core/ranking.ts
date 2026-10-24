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
