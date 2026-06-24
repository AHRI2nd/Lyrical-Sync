// Tauri v2의 unlisten()은 내부적으로 invoke를 호출해 Promise를 반환한다.
// HMR/언마운트 중 그 invoke가 거부되면 미처리 Promise 에러가 발생하므로 안전하게 삼킨다.
// (unlisten의 타입은 () => void 지만 런타임에선 Promise를 반환할 수 있음)
export function safeUnlisten(fn?: (() => void) | null): void {
  try {
    const r = fn?.() as unknown;
    if (r && typeof (r as { catch?: unknown }).catch === "function") {
      (r as Promise<unknown>).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
