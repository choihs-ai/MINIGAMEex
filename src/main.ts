import { Sfx } from './audio/sfx';
import { CharSheetScene } from './debug/charSheet';
import { RenderTestScene } from './debug/renderTest';
import { Fx } from './core/fx';
import type { Game } from './core/game';
import { startLoop } from './core/loop';
import { lockPageGestures } from './core/page';
import { rankByScore } from './core/ranking';
import type { Scene } from './core/scene';
import { SceneManager } from './core/sceneManager';
import { Input } from './input/input';
import { layoutPlayers, type Seat } from './input/seats';
import { PixelFont } from './render/font';
import { Renderer } from './render/renderer';
import { Screen } from './render/screen';
import { GAMES } from './minigames/registry';
import { playSet } from './modes/playlist';
import { InputTestScene } from './scenes/inputTest';
import { LobbyScene } from './scenes/lobby';
import { ResultScene } from './scenes/result';
import { TitleScene } from './scenes/title';
import { RotateNotice } from './ui/rotateNotice';

const SLOWMO_SCALE = 0.3;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다`);
  return el as T;
}

/**
 * 개발용 바로가기: #render #chars #input[1-4] #result[1-4] #G01[-인원] (예: #G22-3, 인원 생략 시 1인+AI).
 * 없으면 정상 흐름(타이틀)으로 시작한다.
 */
function pickStart(game: Game): Scene {
  const hash = location.hash.slice(1);
  const gameMatch = hash.match(/^(G\d\d)(?:-(\d))?$/);
  const count = gameMatch ? Number(gameMatch[2] ?? 1) : Number(hash.match(/(\d)$/)?.[1] ?? 4);
  const setPlayers = () => {
    game.session.joined = ([0, 1, 2, 3] as Seat[]).slice(0, Math.min(4, Math.max(1, count)));
    game.session.players = layoutPlayers(game.session.joined);
  };
  if (hash === 'render') return new RenderTestScene(game.screen);
  if (hash === 'chars') return new CharSheetScene();
  if (hash.startsWith('input')) {
    setPlayers();
    return new InputTestScene(game);
  }
  if (hash.startsWith('result')) {
    setPlayers();
    const entries = game.session.players.map((p, i) => ({ seat: p.seat, score: [42, 31, 17, 8][i] }));
    const rows = entries.map((e) => ({ ...e, isAI: false }));
    return new ResultScene(game, rows, rankByScore(entries), () => new LobbyScene(game));
  }
  if (gameMatch && GAMES[gameMatch[1]]) {
    setPlayers();
    return playSet(game, [gameMatch[1]]);
  }
  return new TitleScene(game);
}

async function boot(): Promise<void> {
  lockPageGestures();
  const canvas = byId<HTMLCanvasElement>('screen');
  const screen = new Screen(canvas, byId('safe-area-probe'));
  const font = new PixelFont();
  await font.load(`${import.meta.env.BASE_URL}fonts/Galmuri7.woff2`);
  const renderer = new Renderer(screen, font);

  const input = new Input(canvas, screen);
  const audio = new Sfx();
  input.onGesture = () => audio.unlock();
  const fx = new Fx();
  const scenes = new SceneManager();
  let slowLeft = 0;
  const game: Game = {
    screen,
    font,
    input,
    audio,
    fx,
    scenes,
    session: { joined: [], players: [], difficulty: 'normal' },
    slowmo: (seconds) => {
      slowLeft = seconds;
    },
  };

  scenes.goto(pickStart(game), true);
  const rotateNotice = new RotateNotice();
  let wasPortrait = false;

  startLoop({
    update: (dt) => {
      if (screen.portrait) {
        // 세로로 든 동안에는 게임을 멈추고 안내 화면만 돌린다. 누르고 있던 손가락은 놓은 것으로 처리한다.
        if (!wasPortrait) input.reset();
        wasPortrait = true;
        rotateNotice.update(dt);
        return;
      }
      wasPortrait = false;
      const scaled = slowLeft > 0 ? dt * SLOWMO_SCALE : dt;
      slowLeft = Math.max(0, slowLeft - dt);
      scenes.update(scaled);
      fx.update(scaled);
    },
    render: () => {
      screen.fit();
      if (screen.portrait) {
        rotateNotice.render(renderer);
      } else {
        const ctx = screen.bufferCtx;
        ctx.save();
        ctx.translate(fx.offsetX, fx.offsetY);
        scenes.render(renderer);
        fx.render(renderer);
        ctx.restore();
        scenes.renderTransition(renderer);
      }
      screen.present();
    },
  });
}

void boot();
