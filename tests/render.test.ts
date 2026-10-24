import { describe, expect, it } from 'vitest';
import { binarizeAlpha } from '../src/render/font';
import { hexToRgb, PAL, SEAT_COLORS } from '../src/render/palette';

describe('팔레트', () => {
  it('기획서의 12색 그대로다', () => {
    expect(Object.values(PAL)).toEqual([
      '#15161C', '#2B2E38', '#0B0B0F', '#EDE6D6',
      '#E5483F', '#9E2A25', '#3E7FE0', '#23488A',
      '#F2C233', '#A9821A', '#44B35C', '#26723A',
    ]);
  });

  it('진영색은 1P 빨강, 2P 파랑, 3P 노랑, 4P 초록 순서다', () => {
    expect(SEAT_COLORS.map((c) => c.base)).toEqual([PAL.red, PAL.blue, PAL.yellow, PAL.green]);
  });

  it('hexToRgb', () => {
    expect(hexToRgb('#E5483F')).toEqual([0xe5, 0x48, 0x3f]);
  });
});

describe('binarizeAlpha', () => {
  it('반투명 픽셀을 지정 색 불투명 또는 완전 투명으로 바꾼다', () => {
    const data = new Uint8ClampedArray([
      255, 255, 255, 255, // 불투명 → 색
      255, 255, 255, 128, // 경계값 → 색
      255, 255, 255, 127, // 반투명 → 투명
      0, 0, 0, 0, // 투명 유지
    ]);
    binarizeAlpha(data, [1, 2, 3]);
    expect(Array.from(data)).toEqual([1, 2, 3, 255, 1, 2, 3, 255, 255, 255, 255, 0, 0, 0, 0, 0]);
  });
});
