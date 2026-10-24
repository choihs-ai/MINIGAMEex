/** 기준 해상도(가로). 세로 안내 화면은 가로·세로를 바꿔 쓴다. */
export const BASE_W = 320;
export const BASE_H = 180;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Layout {
  /** 기준 1px이 차지하는 기기 픽셀 수(정수) */
  scale: number;
  /** 화면 안 기준 화면의 위치·크기(기기 픽셀) */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 안전 영역(노치·홈 바 제외) 안에 기준 화면을 가장 큰 정수배로 넣고 가운데 정렬한다.
 * 모든 값은 기기 픽셀 단위라서 확대된 픽셀 하나하나가 기기 픽셀 경계에 딱 맞는다.
 */
export function computeLayout(
  viewW: number,
  viewH: number,
  insets: Insets,
  logicalW: number,
  logicalH: number,
): Layout {
  const availW = viewW - insets.left - insets.right;
  const availH = viewH - insets.top - insets.bottom;
  const scale = Math.max(1, Math.floor(Math.min(availW / logicalW, availH / logicalH)));
  const width = logicalW * scale;
  const height = logicalH * scale;
  return {
    scale,
    x: Math.round(insets.left) + Math.floor((availW - width) / 2),
    y: Math.round(insets.top) + Math.floor((availH - height) / 2),
    width,
    height,
  };
}
