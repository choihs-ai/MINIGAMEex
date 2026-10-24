import type { Rng } from '../core/rng';
import type { GameInfo } from '../data/games';

/** 직전 세트에 나온 게임은 이만큼 덜 뽑힌다 */
export const PREVIOUS_WEIGHT = 0.35;

export interface DrawRequest {
  rounds: number;
  /** 뽑을 수 있는 게임(구현됨·인원 가능·파티 전용 아님·권한 문제 없음). 확정 게임도 여기 있어야 한다. */
  pool: readonly GameInfo[];
  /** 반드시 들어갈 게임 */
  fixed: readonly string[];
  /** 절대 안 나올 게임 */
  banned: readonly string[];
  /** 직전 세트(가중치를 낮춘다) */
  previous: readonly string[];
  rng: Rng;
}

/**
 * 토너먼트 게임 순서를 뽑는다. 규칙 우선순위:
 * 1. 확정 게임은 모두 들어가고, 밴 게임은 안 나온다.
 * 2. 같은 게임이 연달아 나오지 않는다.
 * 3. 같은 카테고리가 3판 연속 나오지 않는다.
 * 4. 쓸 수 있는 게임이 남아 있는 동안은 중복 없이 뽑는다(게임 수가 판 수보다 적을 때만 다시 나온다).
 * 5. 직전 세트 게임은 가중치를 낮춘다.
 * 막다른 길이면 처음부터 다시 뽑고, 그래도 안 되면 3 → 2 순서로 규칙을 풀어 준다(게임이 아주 적을 때만).
 */
export function drawSet(req: DrawRequest): string[] {
  const banned = new Set(req.banned);
  const allowed = req.pool.filter((g) => !banned.has(g.code));
  if (allowed.length === 0 || req.rounds <= 0) return [];
  const byCode = new Map(allowed.map((g) => [g.code, g]));
  const fixed = [...new Set(req.fixed)].filter((c) => byCode.has(c)).slice(0, req.rounds);
  const previous = new Set(req.previous);

  for (let attempt = 0; attempt < 90; attempt++) {
    const relax = attempt < 30 ? 0 : attempt < 60 ? 1 : 2;
    const seq = tryBuild(req.rounds, allowed, fixed, byCode, previous, req.rng, relax);
    if (seq) return seq;
  }
  // 여기까지 오면 게임이 극단적으로 적은 경우: 확정 게임부터 채우고 나머지는 차례로
  const out = [...fixed];
  for (let i = 0; out.length < req.rounds; i++) out.push(allowed[i % allowed.length].code);
  return out;
}

function tryBuild(
  rounds: number,
  allowed: readonly GameInfo[],
  fixed: readonly string[],
  byCode: ReadonlyMap<string, GameInfo>,
  previous: ReadonlySet<string>,
  rng: Rng,
  relax: number,
): string[] | null {
  const seq: GameInfo[] = [];
  const used = new Set<string>();
  const remainingFixed = new Set(fixed);
  for (let i = 0; i < rounds; i++) {
    const slotsLeft = rounds - i;
    let cands = remainingFixed.size >= slotsLeft ? [...remainingFixed].map((c) => byCode.get(c)!) : [...allowed];
    const prev1 = seq[seq.length - 1];
    const prev2 = seq[seq.length - 2];
    cands = cands.filter((g) => {
      if (relax < 2 && prev1 && g.code === prev1.code && allowed.length > 1) return false;
      if (relax < 1 && prev1 && prev2 && prev1.category === g.category && prev2.category === g.category) return false;
      return true;
    });
    if (cands.length === 0) return null;
    const unused = cands.filter((g) => !used.has(g.code));
    if (unused.length) cands = unused;
    const pick = weightedPick(cands, (g) => (previous.has(g.code) ? PREVIOUS_WEIGHT : 1), rng);
    seq.push(pick);
    used.add(pick.code);
    remainingFixed.delete(pick.code);
  }
  return remainingFixed.size === 0 ? seq.map((g) => g.code) : null;
}

function weightedPick<T>(items: readonly T[], weight: (t: T) => number, rng: Rng): T {
  const total = items.reduce((n, t) => n + weight(t), 0);
  let x = rng.next() * total;
  for (const t of items) {
    x -= weight(t);
    if (x < 0) return t;
  }
  return items[items.length - 1];
}
