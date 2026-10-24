import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 상대 경로로 빌드해서 GitHub Pages 하위 경로(/저장소명/)에서도 그대로 동작하게 한다.
  base: './',
  build: {
    // 구형 아이폰(iOS 14 Safari)까지 지원
    target: ['es2020', 'safari14'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
