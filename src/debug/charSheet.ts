import type { Scene } from '../core/scene';
import { PAL, SEAT_COLORS } from '../render/palette';
import type { Renderer } from '../render/renderer';
import { CHAR_NAMES, characterSprite, POSE_FRAMES, type Pose } from '../ui/characters';

const POSES: readonly Pose[] = ['idle', 'move', 'win', 'lose'];
const POSE_LABEL: Readonly<Record<Pose, string>> = { idle: '대기', move: '이동', win: '승리', lose: '패배' };

/** 캐릭터 4종 × 전체 포즈 프레임을 한 화면에 펼쳐 보는 확인용 화면(#chars). */
export class CharSheetScene implements Scene {
  update(): void {}

  render(r: Renderer): void {
    r.clear(PAL.bgDark);
    for (let seat = 0; seat < 4; seat++) {
      const y = 4 + seat * 44;
      r.text(CHAR_NAMES[seat], 3, y + 14, SEAT_COLORS[seat].base);
      let x = 38;
      for (const pose of POSES) {
        r.text(POSE_LABEL[pose], x, y, PAL.bgMid);
        for (let f = 0; f < POSE_FRAMES[pose]; f++) {
          r.ctx.drawImage(characterSprite(seat as 0 | 1 | 2 | 3, pose, f), x, y + 10);
          x += 18;
        }
        x += 4;
      }
    }
  }
}
