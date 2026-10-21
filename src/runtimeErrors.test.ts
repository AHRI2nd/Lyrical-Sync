// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import html from "../index.html?raw";
import runtimeScript from "../public/runtime-errors.js?raw";

// Execute the actual pre-module browser script, including the original failure path.
const script = () => {
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  return inline ?? runtimeScript;
};
let cleanup: (() => void) | undefined;
function install() {
  const added: [string, EventListener][] = [];
  const add = window.addEventListener.bind(window);
  const original = window.addEventListener;
  window.addEventListener = ((type: string, listener: EventListener) => { added.push([type, listener]); add(type, listener); }) as typeof original;
  try { window.eval(script()); } finally { window.addEventListener = original; }
  cleanup = () => added.forEach(([type, listener]) => window.removeEventListener(type, listener));
}
afterEach(() => { cleanup?.(); document.body.replaceChildren(); });

function reject(reason: unknown) {
  const event = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

describe("global runtime error containment", () => {
  it("keeps the mounted editor and its input contents after an async error", () => {
    document.body.innerHTML = '<div id="root"><input value="unsaved lyric"></div>';
    const input = document.querySelector("input");
    install();
    reject(new Error("request failed"));
    expect(document.querySelector("input")).toBe(input);
    expect(input?.value).toBe("unsaved lyric");
  });
  it("renders startup error strings as text without creating their HTML elements", () => {
    document.body.innerHTML = '<div id="root"></div>';
    install();
    reject('<img src=x onerror="alert(1)">');
    expect(document.querySelector("img")).toBeNull();
    expect(document.getElementById("root")?.textContent).toContain("<img");
  });
  it("reports mounted runtime errors through an event without replacing the root", () => {
    document.body.innerHTML = '<div id="root"><main>editor</main></div>';
    let detail: unknown;
    const observe = ((event: CustomEvent) => { detail = event.detail; }) as EventListener;
    window.addEventListener("lyrical-runtime-error", observe);
    install();
    window.dispatchEvent(new ErrorEvent("error", { message: "unexpected", error: new Error("unexpected") }));
    window.removeEventListener("lyrical-runtime-error", observe);
    expect(detail).toContain("unexpected");
    expect(document.querySelector("main")?.textContent).toBe("editor");
  });
});
