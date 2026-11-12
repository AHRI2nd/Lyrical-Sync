// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { CharWaveformPanel } from './CharWaveformPanel';
import { clearWaveform, publishWaveformSummary } from '../../stores/useWaveformStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useI18nStore } from '../../stores/useI18nStore';

function summary(frameCount: number, sampleRate: number, impulses: Array<[number, number]> = []) {
  const bins = Math.ceil(frameCount / 256);
  const minima = new Float32Array(bins);
  const maxima = new Float32Array(bins);
  for (const [frame, value] of impulses) maxima[Math.floor(frame / 256)] = value;
  return {
    sampleRate, channels: 1, frameCount, durationNanos: Math.floor(frameCount * 1e9 / sampleRate),
    duration: frameCount / sampleRate, blockFrames: 256, minima, maxima,
    peaks: Float32Array.from(maxima),
  };
}

beforeEach(() => {
  publishWaveformSummary('song.wav', summary(2, 1, [[1, .8]]));
  useI18nStore.getState().setLang('en');
  useSettingsStore.setState({ glyphWaveformHeight: 96, glyphWaveformStyle: 'continuous' });
});
afterEach(() => { cleanup(); clearWaveform(); });
it('changes panel height and style without seeking or editing timestamps', () => {
  const seek = vi.fn();
  render(<CharWaveformPanel laneRef={createRef()} onPointerDown={seek} audioPath="song.wav"
    start={0} end={2} lineStart={0} lineEnd={1} playhead={.5}
    syllables={[{ text: 'a', time: .5 }]} activeIndex={0} onSelect={vi.fn()} available />);
  act(() => useSettingsStore.getState().setGlyphWaveformHeight(240));
  expect(screen.getByTestId('glyph-seek-lane').style.height).toBe('240px');
  act(() => useSettingsStore.getState().setGlyphWaveformStyle('bars'));
  expect(screen.getByTestId('glyph-seek-lane').querySelectorAll('svg rect').length).toBeGreaterThanOrEqual(600);
  expect(seek).not.toHaveBeenCalled();
});
it('selects a stamped glyph from its marker without triggering a seek', () => {
  const select = vi.fn(); const seek = vi.fn();
  render(<CharWaveformPanel laneRef={createRef()} onPointerDown={seek} audioPath="song.wav"
    start={0} end={2} lineStart={0} lineEnd={1} playhead={.5}
    syllables={[{ text: 'a', time: .5 }]} activeIndex={0} onSelect={select} available />);
  const marker = screen.getByRole('button', { name: /a.*00:00.50/ });
  fireEvent.pointerDown(marker); fireEvent.click(marker);
  expect(select).toHaveBeenCalledWith(0);
  expect(seek).not.toHaveBeenCalled();
});
it('does not show a stale local waveform for an external playback source', () => {
  render(<CharWaveformPanel laneRef={createRef()} onPointerDown={vi.fn()} audioPath="song.wav"
    start={0} end={2} lineStart={0} lineEnd={1} playhead={.5}
    syllables={[]} activeIndex={0} onSelect={vi.fn()} available={false} />);
  expect(screen.getByTestId('glyph-seek-lane').querySelector('svg')).toBeNull();
  expect(screen.getByText('Waveform unavailable for this playback source')).toBeTruthy();
});
it('does not report missing audio when a selected file has no prepared waveform', () => {
  clearWaveform();
  render(<CharWaveformPanel laneRef={createRef()} onPointerDown={vi.fn()} audioPath="song.wav"
    start={0} end={2} lineStart={0} lineEnd={1} playhead={.5}
    syllables={[]} activeIndex={0} onSelect={vi.fn()} available />);
  expect(screen.getByText('Waveform unavailable for this playback source')).toBeTruthy();
  expect(screen.queryByText('Open audio to view the waveform')).toBeNull();
});
it('sanitizes restored and user-provided waveform preferences', () => {
  useSettingsStore.getState().setGlyphWaveformHeight(Infinity);
  expect(useSettingsStore.getState().glyphWaveformHeight).toBe(144);
  useSettingsStore.getState().setGlyphWaveformHeight(999);
  expect(useSettingsStore.getState().glyphWaveformHeight).toBe(240);
  const merged = useSettingsStore.persist.getOptions().merge!({ glyphWaveformHeight: -20, glyphWaveformStyle: 'invalid' }, useSettingsStore.getState());
  expect(merged.glyphWaveformHeight).toBe(80);
  expect(merged.glyphWaveformStyle).toBe('continuous');
});

it('makes co-timed glyphs selectable as a group and keeps the selected label visible', () => {
  const select = vi.fn();
  const props = { laneRef: createRef<HTMLDivElement>(), onPointerDown: vi.fn(), audioPath: 'song.wav',
    start: 0, end: 2, lineStart: 0, lineEnd: 1, playhead: .8,
    syllables: [{ text: 'a', time: .5 }, { text: 'b', time: .5 }], activeIndex: 0, onSelect: select, available: true };
  const { rerender } = render(<CharWaveformPanel {...props} />);
  const group = screen.getByRole('button', { name: /a.*b/ });
  fireEvent.click(group);
  expect(select).toHaveBeenLastCalledWith(1);
  rerender(<CharWaveformPanel {...props} activeIndex={1} />);
  expect(screen.getByTestId('selected-waveform-glyph').textContent).toBe('b');
  fireEvent.click(screen.getByRole('button', { name: /a.*b/ }));
  expect(select).toHaveBeenLastCalledWith(0);
});

it('translates stable audio geometry during fractional playback and refreshes it on zoom', () => {
  const frames = 48000 * 12;
  publishWaveformSummary('song.wav', summary(frames, 48000, [[240006, 1], [240206, .4]]));
  const props = { laneRef: createRef<HTMLDivElement>(), onPointerDown: vi.fn(), audioPath: 'song.wav',
    start: 2, end: 8, lineStart: 4, lineEnd: 10, playhead: 5,
    syllables: [], activeIndex: 0, onSelect: vi.fn(), available: true };
  const { container, rerender } = render(<CharWaveformPanel {...props} />);
  const initial = [...container.querySelectorAll('svg')].map(svg => svg.querySelector('path')!.getAttribute('d'));
  const initialLeft = (container.querySelector('svg') as SVGElement).style.left;
  for (const offset of [.017, .033, .05]) {
    rerender(<CharWaveformPanel {...props} start={2 + offset} end={8 + offset} playhead={5 + offset} />);
    expect([...container.querySelectorAll('svg')].map(svg => svg.querySelector('path')!.getAttribute('d'))).toEqual(initial);
    expect((container.querySelector('svg') as SVGElement).style.left).not.toBe(initialLeft);
  }
  rerender(<CharWaveformPanel {...props} start={4} end={7} />);
  expect([...container.querySelectorAll('svg')].map(svg => svg.querySelector('path')!.getAttribute('d'))).not.toEqual(initial);
});

it('keeps dense glyph targets in a separate two-row lane without seeking', () => {
  const select = vi.fn();
  const seek = vi.fn();
  const syllables = Array.from({ length: 12 }, (_, i) => ({ text: String(i), time: .5 + i * .03 }));
  const { getByTestId, getAllByRole } = render(<CharWaveformPanel laneRef={createRef()} onPointerDown={seek} audioPath="song.wav"
    start={0} end={2} lineStart={0} lineEnd={1} playhead={.5}
    syllables={syllables} activeIndex={0} onSelect={select} available />);
  const markers = getByTestId('glyph-marker-lane');
  expect(markers.style.height).toBe('64px');
  const targets = getAllByRole('button').filter(button => markers.contains(button));
  expect(targets.length).toBeGreaterThan(0);
  fireEvent.pointerDown(targets[0]);
  fireEvent.click(targets[0]);
  expect(select).toHaveBeenCalled();
  expect(seek).not.toHaveBeenCalled();
});
