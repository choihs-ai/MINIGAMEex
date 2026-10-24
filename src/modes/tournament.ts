import type { Game } from '../core/game';
import { createRng } from '../core/rng';
import type { Scene } from '../core/scene';
import { applySuddenDeath, finalStandings, rankPoints, totalPoints, type DecidedBy, type GameRecord, type Standings } from '../core/scoring';
import { gameInfo, type GameInfo } from '../data/games';
import type { Seat } from '../input/seats';
import { G19_SUDDEN_DEATH } from '../minigames/G19';
import { READY_GAMES } from '../minigames/registry';
import { MenuScene } from '../scenes/menu';
import { ResultScene } from '../scenes/result';
import { SlotRevealScene } from '../scenes/slotReveal';
import { SuddenDeathScene } from '../scenes/suddenDeath';
import { playGame } from './arcade';
import { drawSet } from './draw';

/** 서든데스를 이만큼 해도 안 갈리면 공동 우승 */
const MAX_SUDDEN_DEATH = 3;

const DECIDED_TEXT: Readonly<Record<DecidedBy, string>> = {
  score: '',
  firsts: '동점 → 1등 횟수로',
  lastGame: '동점 → 마지막 판 순위로',
  suddenDeath: '동점 → 서든데스로',
  shared: '공동 우승',
};

/** 토너먼트에서 뽑을 수 있는 게임: 완성됨 + 랜덤 후보 + 파티 전용 아님 + 권한 문제 없음 */
export function tournamentPool(denied: readonly string[]): GameInfo[] {
  return READY_GAMES.map(gameInfo).filter((g) => g.random7 && !g.partyOnly && !denied.includes(g.code));
}

/**
 * 토너먼트: 판 수와 구성(랜덤·확정·밴)대로 게임을 뽑아 슬롯머신처럼 공개하고,
 * 판마다 순위점(인원−1 … 0)을 쌓아 최종 점수로 우승을 가린다. 동점은 ① 1등 횟수 ② 마지막 판 순위 ③ 칼 뽑기 서든데스.
 */
export class Tournament {
  readonly records: GameRecord[] = [];
  private readonly seats: Seat[];

  private constructor(
    private readonly game: Game,
    readonly codes: readonly string[],
  ) {
    this.seats = game.session.players.map((p) => p.seat);
  }

  /** 설정대로 새로 뽑아 시작한다(결과의 "다시"도 여기로) */
  static start(game: Game): Scene {
    const { session } = game;
    const pool = tournamentPool(session.deniedGames);
    const codes = drawSet({
      rounds: session.tournament.rounds,
      pool,
      fixed: session.tournament.fixed,
      banned: session.tournament.banned,
      previous: session.lastSet,
      rng: createRng(Date.now()),
    });
    session.lastSet = codes;
    const t = new Tournament(game, codes);
    // 돌아가는 릴에는 이번에 나올 수 있는 게임만(밴한 게임은 안 보이게)
    const reel = pool.map((g) => g.code).filter((c) => !session.tournament.banned.includes(c));
    return new SlotRevealScene(game, codes, reel.length ? reel : codes, () => t.playNext());
  }

  private playNext(): Scene {
    const index = this.records.length;
    const code = this.codes[index];
    return playGame(this.game, code, (ranking, rows) => {
      this.records.push({ code, ranking });
      const last = this.records.length === this.codes.length;
      return new ResultScene(
        this.game,
        rows,
        ranking,
        [{ label: last ? '최종 결과' : '다음', next: () => (last ? this.finish() : this.playNext()) }],
        {
          title: `${index + 1}/${this.codes.length}`,
          gained: rankPoints(ranking, this.seats.length),
          totals: totalPoints(this.records, this.seats),
        },
      );
    });
  }

  private finish(): Scene {
    const standings = finalStandings(this.records, this.seats);
    return standings.suddenDeath ? this.suddenDeath(standings, standings.suddenDeath, 1) : this.final(standings);
  }

  /** 1위 동점자끼리 칼 뽑기 1라운드. 또 비기면 그 사람들끼리 다시(최대 MAX_SUDDEN_DEATH번). */
  private suddenDeath(standings: Standings, tied: Seat[], attempt: number): Scene {
    const slots = this.game.session.players.filter((p) => tied.includes(p.seat));
    return new SuddenDeathScene(this.game, tied, () =>
      playGame(
        this.game,
        'G19',
        (ranking) => {
          const winners = ranking[0] ?? tied;
          if (winners.length > 1 && attempt < MAX_SUDDEN_DEATH) return this.suddenDeath(standings, winners, attempt + 1);
          return this.final(applySuddenDeath(standings, winners));
        },
        { entry: G19_SUDDEN_DEATH, slots },
      ),
    );
  }

  private final(standings: Standings): Scene {
    const rows = this.seats.map((seat) => ({ seat, score: standings.totals.get(seat) ?? 0, isAI: false }));
    return new ResultScene(
      this.game,
      rows,
      standings.ranking,
      [
        { label: '다시', next: () => Tournament.start(this.game) },
        { label: '메뉴', next: () => new MenuScene(this.game) },
      ],
      { title: '최종 결과', note: DECIDED_TEXT[standings.decidedBy] },
    );
  }
}
