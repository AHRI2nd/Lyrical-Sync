import { describe, it, expect, afterEach, vi } from "vitest";
import { anyModalOpen } from "./modalGuard";

// jsdom 없이 순수 node 테스트 환경이라 document.querySelector 자체를 스텁 —
// anyModalOpen이 어떤 셀렉터로 무엇을 묻는지, 그 결과를 어떻게 boolean으로
// 매핑하는지를 검증한다(실제 CSS 매칭 엔진 동작은 검증 대상이 아님).
const stubQuerySelector = (returnValue: Element | null) => {
  const querySelector = vi.fn(() => returnValue);
  vi.stubGlobal("document", { querySelector });
  return querySelector;
};

describe("anyModalOpen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries for a fullscreen backdrop that isn't pointer-events-none", () => {
    const querySelector = stubQuerySelector(null);
    anyModalOpen();
    expect(querySelector).toHaveBeenCalledWith(".fixed.inset-0:not(.pointer-events-none)");
  });

  it("returns true when a matching element is found", () => {
    stubQuerySelector({} as Element);
    expect(anyModalOpen()).toBe(true);
  });

  it("returns false when nothing matches (e.g. only a drag overlay is present)", () => {
    stubQuerySelector(null);
    expect(anyModalOpen()).toBe(false);
  });
});
