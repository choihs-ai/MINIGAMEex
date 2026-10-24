import { describe, expect, it } from 'vitest';
import { applySuddenDeath, finalStandings, rankPoints, type GameRecord } from '../src/core/scoring';
import type { Seat } from '../src/input/seats';

const pts = (ranking: Seat[][], n: number) => Object.fromEntries(rankPoints(ranking, n));

describe('rankPoints (판마다 순위점)', () => {
  it('4인 3·2·1·0, 3인 2·1·0, 2인 1·0', () => {
    expect(pts([[2], [0], [3], [1]], 4)).toEqual({ 2: 3, 0: 2, 3: 1, 1: 0 });
    expect(pts([[1], [0], [2]], 3)).toEqual({ 1: 2, 0: 1, 2: 0 });
    expect(pts([[1], [0]], 2)).toEqual({ 1: 1, 0: 0 });
  });

  it('공동 1등이면 둘 다 1등 점수, 다음 사람은 건너뛴 등수 점수', () => {
    expect(pts([[0, 1], [2], [3]], 4)).toEqual({ 0: 3, 1: 3, 2: 1, 3: 0 });
    expect(pts([[0, 1], [2]], 3)).toEqual({ 0: 2, 1: 2, 2: 0 });
    expect(pts([[0], [1, 2], [3]], 4)).toEqual({ 0: 3, 1: 2, 2: 2, 3: 0 });
    expect(pts([[0, 1]], 2)).toEqual({ 0: 1, 1: 1 });
  });
});

describe('finalStandings (최종 순위·동점)', () => {
  const seats: Seat[] = [0, 1, 2, 3];
  const rec = (...ranking: Seat[][]): GameRecord => ({ code: 'G01', ranking });

  it('총점 순(2위 이하 동점도 ①② 규칙으로 가린다)', () => {
    const s = finalStandings([rec([0], [1], [2], [3]), rec([0], [2], [1], [3])], seats);
    // 1과 2는 총점 3·1등 0번으로 같고, 마지막 판에서 2가 앞섰다
    expect(s.ranking).toEqual([[0], [2], [1], [3]]);
    expect(Object.fromEntries(s.totals)).toEqual({ 0: 6, 1: 3, 2: 3, 3: 0 });
    expect(s.decidedBy).toBe('score');
    expect(s.suddenDeath).toBeNull();
  });

  it('① 총점이 같으면 1등 횟수가 많은 쪽', () => {
    // 0: 3+0 = 3, 1: 1+2 = 3 → 0이 1등 1번, 1은 0번
    const s = finalStandings([rec([0], [2], [1], [3]), rec([3], [1], [2], [0])], seats);
    expect(s.totals.get(0)).toBe(3);
    expect(s.totals.get(1)).toBe(3);
    expect(s.ranking[0]).toEqual([3]);
    expect(s.totals.get(3)).toBe(3);
  });

  it('② 1등 횟수도 같으면 마지막 판 순위가 높은 쪽', () => {
    // 2인: 1판 0이 1등, 2판 1이 1등 → 총점 1:1, 1등 횟수 1:1 → 마지막 판 1등인 1이 우승
    const s = finalStandings([rec([0], [1]), rec([1], [0])], [0, 1]);
    expect(s.ranking).toEqual([[1], [0]]);
    expect(s.decidedBy).toBe('lastGame');
  });

  it('③ 그래도 같으면 서든데스가 필요한 사람만 알려준다', () => {
    const s = finalStandings([rec([0, 1], [2])], [0, 1, 2]);
    expect(s.decidedBy).toBe('suddenDeath');
    expect(s.suddenDeath).toEqual([0, 1]);
    const done = applySuddenDeath(s, [1]);
    expect(done.ranking).toEqual([[1], [0], [2]]);
    expect(done.decidedBy).toBe('suddenDeath');
  });

  it('1위가 아닌 자리 동점은 공동 순위로 둔다(서든데스 없음)', () => {
    const s = finalStandings([rec([0], [1, 2], [3])], seats);
    expect(s.ranking).toEqual([[0], [1, 2], [3]]);
    expect(s.suddenDeath).toBeNull();
  });

  it('서든데스도 끝내 안 갈리면 공동 우승', () => {
    const s = finalStandings([rec([0, 1, 2], [3])], seats);
    const done = applySuddenDeath(s, [0, 2]);
    expect(done.ranking).toEqual([[0, 2], [1], [3]]);
    expect(done.decidedBy).toBe('shared');
  });
});
