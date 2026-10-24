import { describe, expect, it } from 'vitest';
import { BASE_H, BASE_W, computeLayout } from '../src/render/layout';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

describe('computeLayout', () => {
  it('딱 맞는 화면은 레터박스 없이 정수배로 채운다', () => {
    expect(computeLayout(1920, 1080, NO_INSETS, BASE_W, BASE_H)).toEqual({
      scale: 6,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('아이폰 가로(노치·홈 바 제외)에서 가장 큰 정수배를 고르고 안전 영역 가운데에 둔다', () => {
    // 2532×1170 기기 픽셀, DPR 3, 좌우 47pt·아래 21pt 안전 영역
    const l = computeLayout(2532, 1170, { top: 0, right: 141, bottom: 63, left: 141 }, BASE_W, BASE_H);
    expect(l.scale).toBe(6);
    expect(l.width).toBe(1920);
    expect(l.height).toBe(1080);
    expect(l.x).toBe(141 + Math.floor((2532 - 282 - 1920) / 2));
    expect(l.y).toBe(Math.floor((1170 - 63 - 1080) / 2));
  });

  it('세로 안내 화면은 180×320 기준으로 배치한다', () => {
    const l = computeLayout(1170, 2532, NO_INSETS, BASE_H, BASE_W);
    expect(l.scale).toBe(6);
    expect(l.width).toBe(1080);
    expect(l.height).toBe(1920);
  });

  it('배율과 위치는 항상 정수다', () => {
    const l = computeLayout(1001.5, 563.25, { top: 0.5, right: 10.25, bottom: 3.75, left: 10.25 }, BASE_W, BASE_H);
    for (const v of Object.values(l)) expect(Number.isInteger(v)).toBe(true);
  });

  it('기준 해상도보다 작은 화면에서도 배율은 최소 1이다', () => {
    expect(computeLayout(200, 100, NO_INSETS, BASE_W, BASE_H).scale).toBe(1);
  });
});
