import { expect, it } from "vitest";
import { formatSize } from "./modelDefs";

it("formats binary model estimates and measured sizes with MiB/GiB labels", () => {
  expect(formatSize(83)).toBe("83.0 MiB");
  expect(formatSize(1024)).toBe("1.00 GiB");
  expect(formatSize(1204)).toBe("1.18 GiB");
});
