// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CharWaveformPanel } from "./CharWaveformPanel";
import { clearWaveform, prepareWaveform } from "../../stores/useWaveformStore";

afterEach(() => { cleanup(); clearWaveform(); });
const props = () => ({ laneRef: createRef<HTMLDivElement>(), onPointerDown: vi.fn(), audioPath: "song.wav",
  start: 2, end: 8, lineStart: 4, lineEnd: 7, playhead: 5, syllables: [{ text: "a", time: 5 }],
  activeIndex: 0, onSelect: vi.fn() });
it("moves stable geometry fractionally and puts the glyph marker on its true time", async () => {
  const samples = new Float32Array(48000 * 12); samples[240006] = 1; samples[240206] = .4;
  await prepareWaveform("song.wav", { length: samples.length, sampleRate: 48000, duration: 12,
    numberOfChannels: 1, getChannelData: () => samples });
  const p = props(); const { container, rerender } = render(<CharWaveformPanel {...p} />);
  const paths = [...container.querySelectorAll("svg path")].map(x => x.getAttribute("d"));
  expect((container.querySelector('[data-testid="glyph-selected-marker"]') as HTMLElement).style.left).toBe("50%");
  const left = (container.querySelector("svg") as SVGElement).style.left;
  rerender(<CharWaveformPanel {...p} start={2.017} end={8.017} playhead={5.017} />);
  expect([...container.querySelectorAll("svg path")].map(x => x.getAttribute("d"))).toEqual(paths);
  expect((container.querySelector("svg") as SVGElement).style.left).not.toBe(left);
});
it("cycles co-timed markers without seeking or changing lane height", () => {
  const p = { ...props(), syllables: [{ text: "a", time: 5 }, { text: "b", time: 5 }] };
  const { getByRole, rerender, getByTestId } = render(<CharWaveformPanel {...p} />);
  const height = getByTestId("glyph-marker-lane").style.height;
  const button = getByRole("button", { name: /a.*b/ });
  fireEvent.pointerDown(button); fireEvent.click(button);
  expect(p.onSelect).toHaveBeenCalledWith(1);
  expect(p.onPointerDown).not.toHaveBeenCalled();
  rerender(<CharWaveformPanel {...p} activeIndex={1} />);
  expect(getByTestId("glyph-marker-lane").style.height).toBe(height);
});
it("does not display a previous source for a different file", async () => {
  await prepareWaveform("previous.wav", { length: 2, numberOfChannels: 1, sampleRate: 1, duration: 2,
    getChannelData: () => new Float32Array([1, 0]) });
  const { container } = render(<CharWaveformPanel {...props()} />);
  expect(container.querySelector("svg")).toBeNull();
});
