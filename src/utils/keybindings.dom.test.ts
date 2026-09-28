// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isInteractiveKeyTarget } from "./keybindings";

describe("isInteractiveKeyTarget", () => {
  it("recognizes interactive controls and their descendants", () => {
    document.body.innerHTML = `
      <button id="button"><span id="button-child">Action</span></button>
      <select id="select"><option>Choice</option></select>
      <div id="editable" contenteditable="true"></div>
      <div id="role-control" role="slider"></div>
      <div id="role-textbox" role="textbox" contenteditable="false"></div>
    `;

    expect(isInteractiveKeyTarget(document.getElementById("button-child"))).toBe(true);
    expect(isInteractiveKeyTarget(document.getElementById("select"))).toBe(true);
    expect(isInteractiveKeyTarget(document.getElementById("editable"))).toBe(true);
    expect(isInteractiveKeyTarget(document.getElementById("role-control"))).toBe(true);
    expect(isInteractiveKeyTarget(document.getElementById("role-textbox"))).toBe(true);
  });

  it("does not treat a focusable editor surface as an interactive widget", () => {
    document.body.innerHTML = `<div id="editor-surface" tabindex="0"></div>`;

    expect(isInteractiveKeyTarget(document.getElementById("editor-surface"))).toBe(false);
    expect(isInteractiveKeyTarget(document.body)).toBe(false);
    expect(isInteractiveKeyTarget(null)).toBe(false);
  });
});
