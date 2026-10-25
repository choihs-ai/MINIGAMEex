import type { PlayerControls } from '../input/controls';
import type { Seat } from '../input/seats';
import { rankByScore } from '../core/ranking';
import { PAL } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { glyphIcon } from '../ui/padIcons';
import { AiHand, byDifficulty } from './ai';
import { drawScoreTag, drawTimer, facing, localOffset, sideAnchor } from './common';
import { defineGame, type AiController, type GameContext, type MiniGame, type PlayerInfo } from './types';

// G07 몰래 고르기 경매(G15 숫자 폭탄 경매 흡수): 매 라운드 보석이 나오면 모두 몰래 입찰한다(버튼 −·확정·+).
// 동시에 공개해서 "혼자만 낸 금액" 중 가장 큰 사람이 낙찰(같은 금액끼리는 무효). 낙찰자만 코인을 낸다.
// 코인은 처음 10개뿐. 보석 값 합이 큰 순(같으면 코인이 많이 남은 쪽). 입찰할 때 손으로 가린다.

export const ROUNDS = 5;
export const START_COINS = 10;
export const BID_TIME = 5;
const REVEAL_TIME = 2;
export const MINUS = 0;
export const CONFIRM = 1;
export const PLUS = 2;

export interface Bidder {
  seat: Seat;
  coins: number;
  bid: number;
  confirmed: boolean;
  value: number;
}

export type AuctionPhase = 'bid' | 'reveal';

/** 혼자만 낸 금액 중 최고가를 낸 사람(없으면 null) */
export function uniqueWinner(bids: ReadonlyArray<{ seat: Seat; bid: number }>): Seat | null {
  const count = new Map<number, number>();
  for (const b of bids) count.set(b.bid, (count.get(b.bid) ?? 0) + 1);
  const unique = bids.filter((b) => count.get(b.bid) === 1).sort((a, b) => b.bid - a.bid);
  return unique[0]?.seat ?? null;
}

export class SecretAuction implements MiniGame {
  readonly code = 'G07';
  t = 0;
  round = 0;
  phase: AuctionPhase = 'bid';
  phaseT = 0;
  /** 이번 라운드 보석 값(1~5) */
  value = 1;
  bidders: Bidder[] = [];
  winner: Seat | null = null;
  private ctx!: GameContext;
  private done = false;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    this.bidders = ctx.players.map((p) => ({ seat: p.seat, coins: START_COINS, bid: 0, confirmed: false, value: 0 }));
    this.startRound();
  }

  get rng() {
    return this.ctx.rng;
  }

  get finished(): boolean {
    return this.done;
  }

  isFinished(): boolean {
    return this.done;
  }

  canPress(seat: Seat): boolean {
    return this.phase === 'bid' && !this.bidders.find((b) => b.seat === seat)!.confirmed && !this.done;
  }

  getScores(): Partial<Record<Seat, number>> {
    return Object.fromEntries(this.bidders.map((b) => [b.seat, b.value])) as Partial<Record<Seat, number>>;
  }

  getRanking(): Seat[][] {
    return rankByScore(this.bidders.map((b) => ({ seat: b.seat, score: b.value * 100 + b.coins })));
  }

  private startRound(): void {
    this.value = 1 + Math.floor(this.ctx.rng.next() * 5);
    for (const b of this.bidders) {
      b.bid = 0;
      b.confirmed = false;
    }
    this.phase = 'bid';
    this.phaseT = 0;
    this.winner = null;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.done) return;
    this.phaseT += dt;
    if (this.phase === 'bid') {
      for (const b of this.bidders) {
        if (b.confirmed) continue;
        const c = this.ctx.controls.get(b.seat)!;
        if (c.justPressed(MINUS)) b.bid = Math.max(0, b.bid - 1);
        if (c.justPressed(PLUS)) b.bid = Math.min(b.coins, b.bid + 1);
        if (c.justPressed(CONFIRM)) {
          b.confirmed = true;
          this.ctx.sfx.click();
        }
      }
      if (this.phaseT >= BID_TIME || this.bidders.every((b) => b.confirmed)) {
        this.winner = uniqueWinner(this.bidders);
        const w = this.bidders.find((b) => b.seat === this.winner);
        if (w) {
          w.coins -= w.bid;
          w.value += this.value;
          this.ctx.sfx.coin();
        } else this.ctx.sfx.buzz();
        this.phase = 'reveal';
        this.phaseT = 0;
      }
    } else if (this.phaseT >= REVEAL_TIME) {
      this.round++;
      if (this.round >= ROUNDS) this.done = true;
      else this.startRound();
    }
  }

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    // 가운데 보석(값만큼 별)
    r.rect(124, 72, 72, 36, PAL.line);
    r.frame(124, 72, 72, 36, PAL.yellow);
    for (let i = 0; i < this.value; i++) {
      const x = 160 - (this.value * 12) / 2 + i * 12 + 6;
      r.disc(x, 84, 4, PAL.yellowShadow);
      r.disc(x - 1, 83, 2, PAL.yellow);
    }
    r.text(`${this.round + 1}/${ROUNDS}`, 160, 94, PAL.text, 'center');
    for (const b of this.bidders) {
      const p = this.ctx.players.find((pl) => pl.seat === b.seat)!;
      const a = sideAnchor(p, this.ctx.humanCount);
      facing(r, p, a.x, a.y, () => {
        r.rect(a.x - 22, a.y - 12, 44, 26, PAL.line);
        r.frame(a.x - 22, a.y - 12, 44, 26, b.confirmed ? p.color.base : PAL.bgMid);
        // 입찰가는 공개 전까지 자기 쪽에만(손으로 가리기)
        const shown = this.phase === 'reveal' ? String(b.bid) : b.confirmed ? '?' : String(b.bid);
        r.ctx.drawImage(glyphIcon(shown, this.phase === 'reveal' && this.winner === b.seat ? PAL.yellow : PAL.text), a.x - 9, a.y - 9);
        r.text(`코인 ${b.coins}`, a.x, a.y + 3, p.color.base, 'center');
      });
      const tag = localOffset(p, a, 34, -10);
      drawScoreTag(r, p, tag.x, tag.y, b.value);
    }
    if (this.phase === 'bid') drawTimer(r, BID_TIME - this.phaseT, 160, 112);
    else if (this.winner === null) r.text('무효!', 160, 112, PAL.red, 'center');
  }
}

/** 보석 값과 남은 코인을 보고 적당히(조금씩 다르게) 부른 뒤 확정한다 */
class AuctionAI implements AiController {
  private readonly hand: AiHand;
  private round = -1;
  private readonly greed: number;

  constructor(
    private readonly game: SecretAuction,
    private readonly player: PlayerInfo,
    controls: PlayerControls,
  ) {
    this.hand = new AiHand(controls);
    this.greed = byDifficulty(player.difficulty, { easy: 0.5, normal: 0.7, hard: 0.85 });
  }

  think(dt: number): void {
    this.hand.update(dt);
    const g = this.game;
    if (g.finished || g.phase !== 'bid' || g.round === this.round) return;
    this.round = g.round;
    const rng = g.rng;
    const me = g.bidders.find((b) => b.seat === this.player.seat)!;
    const left = ROUNDS - g.round;
    const fair = (me.coins / left) * (g.value / 3) * this.greed;
    const target = Math.max(0, Math.min(me.coins, Math.round(fair + (rng.next() - 0.5) * 3)));
    let at = 0.4 + rng.next() * 1.2;
    for (let i = 0; i < target; i++) {
      this.hand.tap(PLUS, at, 0.04);
      at += 0.12;
    }
    this.hand.tap(CONFIRM, at + 0.3 + rng.next() * 1.5, 0.04);
  }
}

export const G07 = defineGame({
  code: 'G07',
  controls: 'three',
  padStyle: (_seat, index) => ({ icon: glyphIcon(index === MINUS ? '-' : index === PLUS ? '+' : 'v') }),
  create: () => new SecretAuction(),
  createAI: (game, player, controls) => new AuctionAI(game, player, controls),
});
