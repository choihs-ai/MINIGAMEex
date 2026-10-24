import { startLoop } from './core/loop';
import { lockPageGestures } from './core/page';
import type { Scene } from './core/scene';
import { RenderTestScene } from './debug/renderTest';
import { PixelFont } from './render/font';
import { Renderer } from './render/renderer';
import { Screen } from './render/screen';
import { RotateNotice } from './ui/rotateNotice';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다`);
  return el as T;
}

async function boot(): Promise<void> {
  lockPageGestures();
  const screen = new Screen(byId<HTMLCanvasElement>('screen'), byId('safe-area-probe'));
  const font = new PixelFont();
  await font.load(`${import.meta.env.BASE_URL}fonts/Galmuri7.woff2`);
  const renderer = new Renderer(screen, font);

  const rotateNotice = new RotateNotice();
  const scene: Scene = new RenderTestScene(screen);
  // 세로로 들고 있는 동안에는 게임 화면을 멈추고 안내 화면만 돌린다.
  const active = (): Scene => (screen.portrait ? rotateNotice : scene);

  startLoop({
    update: (dt) => active().update(dt),
    render: () => {
      screen.fit();
      active().render(renderer);
      screen.present();
    },
  });
}

void boot();
