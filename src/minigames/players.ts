import type { PlayerSlot, Seat } from '../input/seats';
import { SEAT_COLORS } from '../render/palette';
import type { Difficulty, PlayerInfo } from './types';

const AI_SEATS: readonly Seat[] = [1, 2, 3];

/** 사람 배치로 미니게임 참가자를 만든다. 사람이 1명이면 AI 3명(2P~4P)을 채운다. */
export function buildPlayers(humans: readonly PlayerSlot[], difficulty: Difficulty): PlayerInfo[] {
  const players: PlayerInfo[] = humans.map((h) => ({
    seat: h.seat,
    color: SEAT_COLORS[h.seat],
    isAI: false,
    difficulty,
    flipped: h.flipped,
    zone: h.zone,
  }));
  if (humans.length === 1) {
    for (const seat of AI_SEATS) {
      players.push({ seat, color: SEAT_COLORS[seat], isAI: true, difficulty, flipped: false, zone: null });
    }
  }
  return players;
}

/**
 * 화면 가운데에서 이 플레이어가 앉은 쪽 방향(각 축 -1~1).
 * 사람 2명이면 1P 아래·2P 위, 그 밖에는 자리 모서리(1P 좌상, 2P 우상, 3P 좌하, 4P 우하).
 */
export function homeDir(p: PlayerInfo, humanCount: number): { x: number; y: number } {
  if (humanCount === 2) return { x: 0, y: p.flipped ? -1 : 1 };
  return { x: p.seat % 2 === 0 ? -1 : 1, y: p.seat < 2 ? -1 : 1 };
}
