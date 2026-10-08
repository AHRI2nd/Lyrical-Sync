import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "./useLrcStore";
it("reads, edits and saves a real local lyric file through ordered I/O", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "lyrical-p03-"));
  const file = path.join(folder, "song.lrc");
  try {
    await fs.writeFile(file, "[00:01.00]original");
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      const input = args;
      if (cmd === "read_lrc_file") return fs.readFile(input.path, "utf8");
      if (cmd === "write_lrc_file") { await fs.writeFile(input.path, input.content); return; }
      return null;
    });
    await useLrcStore.getState().loadLyricsPath(file);
    const id = useLrcStore.getState().doc.lines[0].id;
    useLrcStore.getState().updateLine(id, { text: "edited" });
    await useLrcStore.getState().saveLrc();
    expect(await fs.readFile(file, "utf8")).toContain("edited");
    expect(useLrcStore.getState().isDirty).toBe(false);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
