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
  expect(screen.getByTestId('glyph-seek-lane').querySelectorAll('svg rect').length).toBe(600);
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
