// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isInteractiveKeyTarget } from "./keybindings";

describe("interactive shortcut targets", () => {
  it.each(["input", "textarea", "select", "button", "a href='#'", "summary", "div contenteditable", "div role='slider'", "div role='button'", "div role='textbox'"])("recognizes %s and nested targets", (markup) => {
    const root = document.createElement("div"); root.innerHTML = `<${markup}><span>child</span></${markup.split(" ")[0]}>`;
    const element = root.firstElementChild!;
    expect(isInteractiveKeyTarget(element)).toBe(true);
    if (element.querySelector("span")?.firstChild) expect(isInteractiveKeyTarget(element.querySelector("span")!.firstChild)).toBe(true);
    if (element.firstChild) expect(isInteractiveKeyTarget(element.firstChild)).toBe(true);
  });
  it("leaves ordinary editor targets and explicitly noneditable content available", () => {
    const root = document.createElement("div"); root.innerHTML = '<div tabindex="0"><span contenteditable="false">editor</span></div>';
    expect(isInteractiveKeyTarget(root.querySelector("span"))).toBe(false);
    expect(isInteractiveKeyTarget(null)).toBe(false);
    expect(isInteractiveKeyTarget(window)).toBe(false);
  });
});
