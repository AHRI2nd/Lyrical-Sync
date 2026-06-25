import { describe, it, expect } from "vitest";
import {
  matchAction, conflictingAction, normalizeKeybindings, keyLabel, DEFAULT_KEYBINDINGS,
} from "./keybindings";

describe("keybindings — matching", () => {
  it("matches default bindings, treating numpad digits as digits", () => {
    const kb = DEFAULT_KEYBINDINGS;
    expect(matchAction("Digit1", kb)).toBe("skipBack5");
    expect(matchAction("Numpad1", kb)).toBe("skipBack5");
    expect(matchAction("Space", kb)).toBe("stamp");
    expect(matchAction("Backspace", kb)).toBe("prevLine");
    expect(matchAction("KeyQ", kb)).toBeNull();
  });
});

describe("keybindings — conflict detection", () => {
  it("flags a key already used by another action", () => {
    const kb = { ...DEFAULT_KEYBINDINGS };
    expect(conflictingAction("Digit1", "stamp", kb)).toBe("skipBack5");
    expect(conflictingAction("Numpad1", "stamp", kb)).toBe("skipBack5"); // numpad ≡ digit
  });
  it("reassigning a key to its own action is not a conflict", () => {
    expect(conflictingAction("Digit1", "skipBack5", DEFAULT_KEYBINDINGS)).toBeNull();
  });
  it("a free key has no conflict", () => {
    expect(conflictingAction("KeyQ", "stamp", DEFAULT_KEYBINDINGS)).toBeNull();
  });
});

describe("keybindings — normalize & labels", () => {
  it("fills missing actions from defaults", () => {
    const kb = normalizeKeybindings({ stamp: "KeyS" });
    expect(kb.stamp).toBe("KeyS");
    expect(kb.skipBack5).toBe(DEFAULT_KEYBINDINGS.skipBack5);
  });
  it("renders readable labels", () => {
    expect(keyLabel("Digit1")).toBe("1");
    expect(keyLabel("KeyA")).toBe("A");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("ArrowLeft")).toBe("←");
  });
});
