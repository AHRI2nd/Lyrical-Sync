// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import WaveSurfer from "wavesurfer.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("WaveSurfer native media seek diagnostic", () => {
  it("suppresses waveform progress and audioprocess while the media element is seeking", () => {
    let seeking = false;
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafs.push(callback);
      return rafs.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const container = document.createElement("div");
    document.body.appendChild(container);
    const ws = WaveSurfer.create({ container });
    const media = ws.getMediaElement();
    expect(media).toBeInstanceOf(HTMLMediaElement);
    Object.defineProperty(media, "seeking", { configurable: true, get: () => seeking });
    vi.spyOn(media, "pause").mockImplementation(() => {});
    vi.spyOn(media, "load").mockImplementation(() => {});
    const progress = vi.fn();
    ws.on("audioprocess", progress);

    const timer = (ws as unknown as { timer: { start: () => void; destroy: () => void } }).timer;
    timer.start();
    expect(progress).toHaveBeenCalledTimes(1);

    seeking = true;
    rafs.shift()?.(16);
    expect(ws.isSeeking()).toBe(true);
    expect(progress).toHaveBeenCalledTimes(1);

    seeking = false;
    rafs.shift()?.(32);
    expect(ws.isSeeking()).toBe(false);
    expect(progress).toHaveBeenCalledTimes(2);

    ws.destroy();
  });
});
