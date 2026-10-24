import type { Game } from '../core/game';
import { createRng } from '../core/rng';
import type { Scene } from '../core/scene';
import { BUTTON_COUNT, PlayerControls } from '../input/controls';
import { padAt, padButtons, type PadButton } from '../input/padButtons';
import type { Seat } from '../input/seats';
import type { InputEvent, Zone } from '../input/touch';
import { drawPadButtons } from '../minigames/common';
import { buildPlayers } from '../minigames/players';
import type { AiController, MiniGame, MiniGameEntry, PlayerInfo } from '../minigames/types';
import type { Renderer } from '../render/renderer';
import type { ResultRow } from './result';

/** 끝난 뒤 결과 화면에 넘기기까지 승리 순간을 보여주는 시간 */
const END_HOLD = 1.2;

/**
 * 미니게임 한 판을 돌린다: 터치 → 플레이어별 버튼, AI 생각 → 같은 버튼, 미니게임 갱신, 끝나면 결과로.
 */
export class MiniGameScene implements Scene {
  private mg!: MiniGame;
  private players: PlayerInfo[] = [];
  private readonly controls = new Map<Seat, PlayerControls>();
  private ais: AiController[] = [];
  private pads: PadButton[] = [];
  /** 손가락(pointerId) → 누르고 있는 자리·버튼 */
  private readonly fingers = new Map<number, { seat: Seat; button: number }>();
  private t = 0;
  private endT = -1;
  private left = false;

  constructor(
    private readonly game: Game,
    private readonly entry: MiniGameEntry,
    private readonly onDone: (ranking: Seat[][], rows: ResultRow[]) => Scene,
  ) {}

  enter(): void {
    const { session, input, fx, audio } = this.game;
    this.players = buildPlayers(session.players, session.difficulty);
    for (const p of this.players) this.controls.set(p.seat, new PlayerControls(BUTTON_COUNT[this.entry.controls]));
    const { game, createAI } = this.entry.create();
    this.mg = game;
    this.mg.setup({
      players: this.players,
      controls: this.controls,
      humanCount: session.players.length,
      rng: createRng(Date.now()),
      fx,
      sfx: audio,
    });
    this.ais = this.players.filter((p) => p.isAI).map((p) => createAI(p, this.controls.get(p.seat)!));
    this.pads = padButtons(session.players, this.entry.controls);
    input.setZones(padZones(this.pads));
  }

  update(dt: number): void {
    this.t += dt;
    for (const e of this.game.input.tracker.drain()) this.route(e);
    for (const ai of this.ais) ai.think(dt);
    this.mg.update(dt);
    for (const c of this.controls.values()) c.endTick(dt);

    if (!this.mg.isFinished()) return;
    if (this.endT < 0) {
      this.endT = 0;
      this.game.slowmo(0.3);
      this.game.fx.shake(3, 0.2);
      return;
    }
    this.endT += dt;
    if (this.endT >= END_HOLD && !this.left) {
      this.left = true;
      const scores = this.mg.getScores?.() ?? {};
      const rows: ResultRow[] = this.players.map((p) => ({ seat: p.seat, score: scores[p.seat] ?? null, isAI: p.isAI }));
      this.game.scenes.goto(this.onDone(this.mg.getRanking(), rows));
    }
  }

  /** 사람의 터치를 그 사람의 버튼 누름/뗌으로 바꾼다. 좌우 버튼은 손가락이 옆 버튼으로 미끄러지면 옮겨 간다. */
  private route(e: InputEvent): void {
    const player = this.players.find((p) => p.seat === e.touch.zone && !p.isAI);
    const controls = player && this.controls.get(player.seat);
    if (!player || !controls) return;
    const held = this.fingers.get(e.touch.id);
    if (e.type === 'up') {
      if (held) controls.release(held.button);
      this.fingers.delete(e.touch.id);
      return;
    }
    const pad = padAt(this.pads, e.touch.x, e.touch.y, player.seat);
    const button = pad?.index ?? held?.button ?? 0;
    if (e.type === 'down') {
      controls.press(button);
      this.fingers.set(e.touch.id, { seat: player.seat, button });
    } else if (held && held.button !== button) {
      controls.release(held.button);
      controls.press(button);
      held.button = button;
    }
  }

  render(r: Renderer): void {
    this.mg.render(r);
    drawPadButtons(r, this.pads, this.players, this.controls, this.entry.controls, this.t, this.mg.canPress?.bind(this.mg));
  }
}

/** 자리마다 그 사람 버튼들의 판정 원을 합친 터치 구역 */
export function padZones(pads: readonly PadButton[]): Zone[] {
  const seats = [...new Set(pads.map((p) => p.seat))];
  return seats.map((seat) => ({ id: seat, contains: (x, y) => padAt(pads, x, y, seat) !== null }));
}
