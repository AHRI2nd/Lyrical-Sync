// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { CharWaveformPanel } from './CharWaveformPanel';
import { clearWaveform, prepareWaveform } from '../../stores/useWaveformStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useI18nStore } from '../../stores/useI18nStore';

beforeEach(async () => {
  await prepareWaveform('song.wav', { length: 2, sampleRate: 1, duration: 2, numberOfChannels: 1, getChannelData: () => new Float32Array([.2, .8]) });
  useI18nStore.getState().setLang('en');
  useSettingsStore.setState({ glyphWaveformHeight: 96, glyphWaveformStyle: 'continuous' });
});
afterEach(() => { cleanup(); clearWaveform(); });
it('changes panel height and style without seeking or editing timestamps', () => {
  const seek = vi.fn();
  render(<CharWaveformPanel laneRef={createRef()} onPointerDown={seek} audioPath="song.wav"
    start={0} end={2} lineStart={0} lineEnd={1} playhead={.5}
    syllables={[{ text: 'a', time: .5 }]} activeIndex={0} onSelect={vi.fn()} available />);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '160' } });
  expect(screen.getByTestId('glyph-seek-lane').style.height).toBe('160px');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bars' } });
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
it('sanitizes restored and user-provided waveform preferences', () => {
  useSettingsStore.getState().setGlyphWaveformHeight(Infinity);
  expect(useSettingsStore.getState().glyphWaveformHeight).toBe(96);
  useSettingsStore.getState().setGlyphWaveformHeight(999);
  expect(useSettingsStore.getState().glyphWaveformHeight).toBe(160);
  const merged = useSettingsStore.persist.getOptions().merge!({ glyphWaveformHeight: -20, glyphWaveformStyle: 'invalid' }, useSettingsStore.getState());
  expect(merged.glyphWaveformHeight).toBe(64);
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

it('translates stable audio geometry during fractional playback and refreshes it on zoom', async () => {
  const samples = new Float32Array(48000 * 12); samples[240006] = 1; samples[240206] = .4;
  await prepareWaveform('song.wav', { length: samples.length, sampleRate: 48000, duration: 12,
    numberOfChannels: 1, getChannelData: () => samples });
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
