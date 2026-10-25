# 4인용게임EX

한 대의 스마트폰(가로)을 1~4명이 둘러싸고 즐기는 로컬 멀티플레이 미니게임 모음 웹게임.
시작 흐름·버튼 배치는 모바일 앱 *1 2 3 4 Player Games*와 같게, 그림·소리는 자체 픽셀 아트로.

- 플레이: https://choihs-ai.github.io/MINIGAMEex/
- 개발 지시서: [`docs/CLAUDE_CODE_프롬프트.md`](./docs/CLAUDE_CODE_프롬프트.md)
- 미니게임 세부표: [`docs/games.json`](./docs/games.json) (통폐합 후 39종, 최신), 파티 전용 7종은 [`docs/party-games.json`](./docs/party-games.json)로 분리. `docs/4인용게임EX_미니게임_세부표.xlsx`는 통폐합 전 원본
- 아트 레퍼런스: [`docs/art/`](./docs/art)

## 개발

```sh
npm install
npm run dev        # 개발 서버 (같은 와이파이의 폰에서 접속 가능)
npm test           # 로직 테스트 (Vitest)
npm run build      # 타입 검사 + 빌드 → dist/
```

개발용 바로가기(주소 뒤에 붙임): `#G01` 처럼 게임 코드(1인+AI), `#G01-4`처럼 `-인원`(2~4), `#tournament2`~`#tournament4`(토너먼트 설정), `#render` `#chars` `#input1`~`#input4` `#result1`~`#result4`

`main` 브랜치에 푸시하면 GitHub Actions가 테스트·빌드 후 GitHub Pages에 배포한다.

## 구조

```
src/
  core/    게임 루프(60Hz 고정 간격), 장면 전환(브라운관), 화면 흔들림·파편, 순위·순위점·최종 순위(동점 처리), 시드 난수
  data/    세부표(docs/games.json) 로더
  input/   좌석 배치, 가장자리 큰 버튼 배치(1·2·3·4버튼, 위/아래), 손가락별 멀티터치 추적, 플레이어별 가상 버튼과 화면 탭·드래그(사람·AI 공통)
  audio/   WebAudio 8비트 효과음
  render/  320×180 버퍼 → 정수배 확대, 팔레트, 픽셀 폰트, 픽셀 그림 격자
  scenes/  메인 메뉴(인원 선택 + 끌어 넘기는 게임 아이콘 + 토너먼트), 토너먼트 설정·슬롯 공개·서든데스, 카운트다운, 미니게임 진행, 결과, 입력 테스트
  minigames/ G01.ts … (게임 하나에 파일 하나 + 그 게임의 AI), 공통 인터페이스·조작·AI 손, 퀴즈형·당겨 튕기기 공통
  modes/   아케이드(메뉴에서 고른 게임 1판), 토너먼트(뽑기 규칙 + 진행)
  ui/      캐릭터 4종 스프라이트, 미니게임 아이콘, 큰 글자(7세그·WIN·GO), 가로 모드 안내
  debug/   렌더러 테스트(#render), 캐릭터 시트(#chars)
tests/     Vitest 로직 테스트
```

## 폰트

[Galmuri](https://github.com/quiple/galmuri) (Galmuri7, © Lee Minseo) — SIL Open Font License 1.1.
라이선스 전문: [`public/fonts/Galmuri-OFL.txt`](./public/fonts/Galmuri-OFL.txt)
