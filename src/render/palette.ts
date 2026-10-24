// 게임 전체 팔레트. 이 색 외에는 사용하지 않는다(아트 가이드 7절).
// 미니게임 배경용 중립색이 꼭 필요하면 여기에만 추가하고 기획자에게 보고한다.
export const PAL = {
  bgDark: '#15161C', // 배경 어두움
  bgMid: '#2B2E38', // 배경 중간
  line: '#0B0B0F', // 선·그림자
  text: '#EDE6D6', // 글자·하이라이트
  red: '#E5483F',
  redShadow: '#9E2A25',
  blue: '#3E7FE0',
  blueShadow: '#23488A',
  yellow: '#F2C233',
  yellowShadow: '#A9821A',
  green: '#44B35C',
  greenShadow: '#26723A',
} as const;

/** 팔레트에 있는 색만 받도록 하는 타입. 그리기 함수는 모두 이 타입을 쓴다. */
export type Color = (typeof PAL)[keyof typeof PAL];

export interface SeatColor {
  base: Color;
  shadow: Color;
}

/** 진영색. 인덱스 0~3 = 1P(빨강·좌상) 2P(파랑·우상) 3P(노랑·좌하) 4P(초록·우하) */
export const SEAT_COLORS: readonly SeatColor[] = [
  { base: PAL.red, shadow: PAL.redShadow },
  { base: PAL.blue, shadow: PAL.blueShadow },
  { base: PAL.yellow, shadow: PAL.yellowShadow },
  { base: PAL.green, shadow: PAL.greenShadow },
];

/** 레터박스(기준 화면 밖 남는 영역) 색 */
export const LETTERBOX: Color = PAL.line;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
