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

`main` 브랜치에 푸시하면 GitHub Actions가 테스트·빌드 후 GitHub Pages에 배포한다.

## 구조

```
src/
  core/    게임 루프(60Hz 고정 간격), 씬 인터페이스, 페이지 제스처 잠금
  render/  320×180 버퍼 → 정수배 확대, 팔레트, 픽셀 폰트
  ui/      가로 모드 안내 화면
  debug/   1단계 렌더러 테스트 화면
tests/     Vitest 로직 테스트
```

## 폰트

[Galmuri](https://github.com/quiple/galmuri) (Galmuri7, © Lee Minseo) — SIL Open Font License 1.1.
라이선스 전문: [`public/fonts/Galmuri-OFL.txt`](./public/fonts/Galmuri-OFL.txt)
