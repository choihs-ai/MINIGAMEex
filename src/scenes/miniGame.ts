import type { Game } from '../core/game';
import { createRng } from '../core/rng';
import type { Scene } from '../core/scene';
import { BUTTON_COUNT, PlayerControls, type ControlLayout } from '../input/controls';
import { padAt, padButtons, type PadButton } from '../input/padButtons';
import type { PlayerSlot, Seat } from '../input/seats';
import { rectZone, type InputEvent, type Zone } from '../input/touch';
import { drawPadButtons } from '../minigames/common';
import { buildPlayers } from '../minigames/players';
import { controlLayout, type AiController, type MiniGame, type MiniGameEntry, type PlayerInfo } from '../minigames/types';
import type { Renderer } from '../render/renderer';
import type { ResultRow } from './result';

/** 끝난 뒤 결과 화면에 넘기기까지 승리 순간을 보여주는 시간 */
const END_HOLD = 1.2;
/** 차례제 게임에서 화면 전체를 덮는 터치 구역(누구 것인지는 누를 때 차례로 정한다) */
const TURN_ZONE = 9;

interface Finger {
  seat: Seat;
  /** 누르고 있는 버튼 번호. 화면을 직접 만지는 손가락이면 -1 */
  button: number;
}

/**
 * 미니게임 한 판을 돌린다: 터치 → 플레이어별 버튼(또는 화면 탭·드래그), AI 생각 → 같은 입력, 미니게임 갱신, 끝나면 결과로.
 */
export class MiniGameScene implements Scene {
  private mg!: MiniGame;
  private players: PlayerInfo[] = [];
  private readonly controls = new Map<Seat, PlayerControls>();
  private readonly layouts = new Map<Seat, ControlLayout>();
  private ais: AiController[] = [];
  private pads: PadButton[] = [];
  /** 손가락(pointerId) → 그 손가락의 주인과 하는 일 */
  private readonly fingers = new Map<number, Finger>();
  private t = 0;
  private endT = -1;
  private left = false;

  constructor(
    private readonly game: Game,
    private readonly entry: MiniGameEntry,
    private readonly onDone: (ranking: Seat[][], rows: ResultRow[]) => Scene,
    /** 이 판에 참가하는 사람(없으면 전원). 서든데스처럼 일부만 뛸 때 쓴다. */
    private readonly slots?: readonly PlayerSlot[],
  ) {}

  enter(): void {
    const { session, input, fx, audio } = this.game;
    const humans = this.slots ?? session.players;
    this.players = buildPlayers(humans, session.difficulty);
    const seats = this.players.map((p) => p.seat);
    for (const p of this.players) {
      const layout = controlLayout(this.entry, p.seat, seats);
      this.layouts.set(p.seat, layout);
      this.controls.set(p.seat, new PlayerControls(BUTTON_COUNT[layout]));
    }
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
    this.pads = padButtons(humans, (seat) => this.layouts.get(seat)!);
    input.setZones(gameZones(this.pads, humans, (seat) => this.layouts.get(seat)!, this.entry.pointer ?? 'area'));
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

  /**
   * 사람의 터치를 그 사람의 입력으로 바꾼다.
   * 버튼: 누름/뗌(좌우처럼 붙은 버튼은 손가락이 옆 버튼으로 미끄러지면 옮겨 간다). 화면 직접 조작: 탭·드래그.
   */
  private route(e: InputEvent): void {
    const { id, x, y } = e.touch;
    if (e.type === 'down') {
      const seat = e.touch.zone === TURN_ZONE ? (this.mg.activeSeat?.() ?? null) : (e.touch.zone as Seat);
      const player = this.players.find((p) => p.seat === seat && !p.isAI);
      const controls = player && this.controls.get(player.seat);
      if (!player || !controls) return;
      if (this.layouts.get(player.seat) === 'pointer') {
        controls.pointerDown(x, y, id);
        this.fingers.set(id, { seat: player.seat, button: -1 });
        return;
      }
      const button = padAt(this.pads, x, y, player.seat)?.index ?? 0;
      controls.press(button);
      this.fingers.set(id, { seat: player.seat, button });
      return;
    }
    const held = this.fingers.get(id);
    const controls = held && this.controls.get(held.seat);
    if (!held || !controls) return;
    if (e.type === 'up') {
      if (held.button >= 0) controls.release(held.button);
      else controls.pointerUp(id);
      this.fingers.delete(id);
      return;
    }
    if (held.button < 0) {
      controls.pointerMove(x, y, id);
      return;
    }
    const button = padAt(this.pads, x, y, held.seat)?.index ?? held.button;
    if (button !== held.button) {
      controls.release(held.button);
      controls.press(button);
      held.button = button;
    }
  }

  render(r: Renderer): void {
    this.mg.render(r);
    drawPadButtons(r, this.pads, this.players, this.controls, this.t, {
      canPress: this.mg.canPress?.bind(this.mg),
      style: (seat, index, layout) => this.mg.padStyle?.(seat, index) ?? this.entry.padStyle?.(seat, index, layout) ?? null,
    });
  }
}

/** 자리마다 그 사람 버튼들의 판정 원을 합친 터치 구역 */
export function padZones(pads: readonly PadButton[]): Zone[] {
  const seats = [...new Set(pads.map((p) => p.seat))];
  return seats.map((seat) => ({ id: seat, contains: (x, y) => padAt(pads, x, y, seat) !== null }));
}

/**
 * 한 판의 터치 구역: 버튼을 쓰는 사람은 버튼 판정 원, 화면을 직접 만지는 사람은
 * area면 자기 구역(1인이면 화면 전체), turn이면 화면 전체 하나(누를 때 차례인 사람 것).
 */
export function gameZones(
  pads: readonly PadButton[],
  humans: readonly PlayerSlot[],
  layoutOf: (seat: Seat) => ControlLayout,
  pointer: 'area' | 'turn',
): Zone[] {
  const zones = padZones(pads);
  const touchers = humans.filter((h) => layoutOf(h.seat) === 'pointer');
  if (touchers.length === 0) return zones;
  if (pointer === 'turn') zones.push(rectZone(TURN_ZONE, { x: 0, y: 0, w: 320, h: 180 }));
  else for (const h of touchers) zones.push(rectZone(h.seat, h.zone));
  return zones;
}
