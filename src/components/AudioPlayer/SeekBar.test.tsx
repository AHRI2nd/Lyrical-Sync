// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SeekBar } from "./SeekBar";
import { formatDisplayTime } from "../../utils/lrcParser";

afterEach(() => cleanup());

function setup(position = 10, duration = 100) {
  const onSeek = vi.fn();
  const view = render(
    <SeekBar position={position} duration={duration} onSeek={onSeek} accentClass="bg-indigo-500" />
  );
  const track = view.container.querySelector(".cursor-pointer") as HTMLDivElement;
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 6, width: 100, height: 6,
    toJSON: () => ({}),
  });
  return { ...view, onSeek, track, fill: track.firstElementChild as HTMLDivElement };
}

describe("SeekBar scrubbing", () => {
  it("previews pointer movement without seeking until release, then commits the final position once", () => {
    const { track, fill, onSeek, getByText } = setup();

    fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 50 });

    expect(onSeek).not.toHaveBeenCalled();
    expect(fill.style.width).toBe("50%");
    expect(getByText(formatDisplayTime(50))).toBeTruthy();

    fireEvent.pointerUp(window, { pointerId: 1, button: 0, clientX: 80 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(80);
    expect(fill.style.width).toBe("80%");
  });

  it("commits a single click at the clicked position", () => {
    const { track, onSeek } = setup();

    fireEvent.pointerDown(track, { pointerId: 2, button: 0, clientX: 25 });
    fireEvent.pointerUp(window, { pointerId: 2, button: 0, clientX: 25 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(25);
  });

  it("discards a cancelled drag", () => {
    const { track, fill, onSeek } = setup();

    fireEvent.pointerDown(track, { pointerId: 3, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 65 });
    fireEvent.pointerCancel(window, { pointerId: 3 });

    expect(onSeek).not.toHaveBeenCalled();
    expect(fill.style.width).toBe("10%");
  });

  it("ignores other pointers and cancels the active scrub on unmount", () => {
    const { track, onSeek, unmount } = setup();

    fireEvent.pointerDown(track, { pointerId: 7, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 75 });
    fireEvent.pointerUp(window, { pointerId: 8, button: 0, clientX: 75 });
    expect(onSeek).not.toHaveBeenCalled();

    unmount();
    fireEvent.pointerUp(window, { pointerId: 7, button: 0, clientX: 75 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("keeps the pointer preview while controlled position changes, then keeps the committed value", () => {
    const { track, fill, onSeek, rerender } = setup();

    fireEvent.pointerDown(track, { pointerId: 4, button: 0, clientX: 20 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 60 });
    rerender(<SeekBar position={30} duration={100} onSeek={onSeek} accentClass="bg-indigo-500" />);

    expect(fill.style.width).toBe("60%");
    fireEvent.pointerUp(window, { pointerId: 4, button: 0, clientX: 60 });
    expect(onSeek).toHaveBeenCalledTimes(1);

    rerender(<SeekBar position={60} duration={100} onSeek={onSeek} accentClass="bg-indigo-500" />);
    expect(fill.style.width).toBe("60%");
  });

  it("cancels a pending drag when duration changes and clamps an out-of-bounds release", () => {
    const { track, onSeek, rerender } = setup();

    fireEvent.pointerDown(track, { pointerId: 5, button: 0, clientX: 20 });
    rerender(<SeekBar position={10} duration={200} onSeek={onSeek} accentClass="bg-indigo-500" />);
    fireEvent.pointerUp(window, { pointerId: 5, button: 0, clientX: 50 });
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.pointerDown(track, { pointerId: 6, button: 0, clientX: 20 });
    fireEvent.pointerUp(window, { pointerId: 6, button: 0, clientX: 140 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(200);
  });

  it("clears the committed preview when the track duration changes", () => {
    const { track, fill, onSeek, rerender } = setup();

    fireEvent.pointerDown(track, { pointerId: 10, button: 0, clientX: 20 });
    fireEvent.pointerUp(window, { pointerId: 10, button: 0, clientX: 80 });
    expect(fill.style.width).toBe("80%");

    rerender(<SeekBar position={10} duration={200} onSeek={onSeek} accentClass="bg-indigo-500" />);
    expect(fill.style.width).toBe("5%");
  });

  it("cancels a scrub when the source track changes without a duration change", () => {
    const onSeek = vi.fn();
    const view = render(
      <SeekBar position={10} duration={100} seekContextKey="track-a" onSeek={onSeek} accentClass="bg-indigo-500" />
    );
    const track = view.container.querySelector(".cursor-pointer") as HTMLDivElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 6, width: 100, height: 6,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(track, { pointerId: 12, button: 0, clientX: 20 });
    view.rerender(
      <SeekBar position={10} duration={100} seekContextKey="track-b" onSeek={onSeek} accentClass="bg-indigo-500" />
    );
    fireEvent.pointerUp(window, { pointerId: 12, button: 0, clientX: 80 });

    expect(onSeek).not.toHaveBeenCalled();
  });

  it("uses the latest onSeek callback if its parent rerenders during scrubbing", () => {
    const firstSeek = vi.fn();
    const latestSeek = vi.fn();
    const view = render(<SeekBar position={10} duration={100} onSeek={firstSeek} accentClass="bg-indigo-500" />);
    const track = view.container.querySelector(".cursor-pointer") as HTMLDivElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 6, width: 100, height: 6,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(track, { pointerId: 11, button: 0, clientX: 20 });
    view.rerender(<SeekBar position={10} duration={100} onSeek={latestSeek} accentClass="bg-indigo-500" />);
    fireEvent.pointerUp(window, { pointerId: 11, button: 0, clientX: 75 });

    expect(firstSeek).not.toHaveBeenCalled();
    expect(latestSeek).toHaveBeenCalledOnce();
    expect(latestSeek).toHaveBeenCalledWith(75);
  });

  it("clamps a release left of the seek bar to zero", () => {
    const { track, onSeek } = setup();

    fireEvent.pointerDown(track, { pointerId: 9, button: 0, clientX: 20 });
    fireEvent.pointerUp(window, { pointerId: 9, button: 0, clientX: -20 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(0);
  });
});
