/**
 * 확대·스크롤·길게 눌러 메뉴 띄우기를 막는다.
 * CSS touch-action/user-select로 대부분 막히지만 iOS Safari 핀치 확대(gesture*)는 따로 막아야 한다.
 */
export function lockPageGestures(): void {
  const prevent = (e: Event) => e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dblclick', 'selectstart']) {
    document.addEventListener(type, prevent, { passive: false });
  }
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
}
