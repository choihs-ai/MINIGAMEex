# 4인용게임EX

한 대의 스마트폰(가로)을 1~4명이 둘러싸고 즐기는 로컬 멀티플레이 미니게임 모음 웹게임.

- 플레이: https://choihs-ai.github.io/MINIGAMEex/
- 개발 지시서: [`docs/CLAUDE_CODE_프롬프트.md`](./docs/CLAUDE_CODE_프롬프트.md)
- 미니게임 세부표: [`docs/games.json`](./docs/games.json), `docs/4인용게임EX_미니게임_세부표.xlsx`
- 아트 레퍼런스: [`docs/art/`](./docs/art)

## 개발

```sh
npm install
npm run dev        # 개발 서버 (같은 와이파이의 폰에서 접속 가능)
npm test           # 로직 테스트 (Vitest)
npm run build      # 타입 검사 + 빌드 → dist/
```

개발용 바로가기(주소 뒤에 붙임): `#render` `#chars` `#input1`~`#input4` `#result1`~`#result4`

`main` 브랜치에 푸시하면 GitHub Actions가 테스트·빌드 후 GitHub Pages에 배포한다.

## 구조

```
src/
  core/    게임 루프(60Hz 고정 간격), 장면 전환(브라운관), 화면 흔들림·파편, 순위 계산, 시드 난수
  input/   좌석 배치(순수 로직), 손가락별 멀티터치 추적, 포인터 이벤트 연결
  audio/   WebAudio 8비트 효과음
  render/  320×180 버퍼 → 정수배 확대, 팔레트, 픽셀 폰트, 픽셀 그림 격자
  scenes/  타이틀, 로비(동전 넣기), 카운트다운, 입력 테스트, 결과
  ui/      캐릭터 4종 스프라이트, 큰 글자(7세그·WIN·GO), 아케이드 버튼, 가로 모드 안내
  debug/   렌더러 테스트(#render), 캐릭터 시트(#chars)
tests/     Vitest 로직 테스트
```

## 폰트

[Galmuri](https://github.com/quiple/galmuri) (Galmuri7, © Lee Minseo) — SIL Open Font License 1.1.
라이선스 전문: [`public/fonts/Galmuri-OFL.txt`](./public/fonts/Galmuri-OFL.txt)
