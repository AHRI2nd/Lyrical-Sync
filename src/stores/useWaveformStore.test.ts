import { afterEach, expect, it } from 'vitest';
import { clearWaveform, beginWaveformPreparation, publishWaveformSummary, useWaveformStore } from './useWaveformStore';
import type { AudioWaveformSummary } from '../utils/audioWaveformSummary';
function summary(value: number): AudioWaveformSummary {
  return {
    sampleRate: 48_000,
    channels: 1,
    frameCount: 256,
    durationNanos: 5_333_333,
    duration: 256 / 48_000,
    blockFrames: 256,
    minima: new Float32Array([value]),
    maxima: new Float32Array([value]),
    peaks: new Float32Array([value]),
  };
}
afterEach(clearWaveform);
it('publishes a fresh source for same-path and same-duration audio replacement', () => {
  beginWaveformPreparation('song.wav');
  publishWaveformSummary('song.wav', summary(1));
  const previous = useWaveformStore.getState().source;
  beginWaveformPreparation('song.wav');
  expect(useWaveformStore.getState().source).toBeNull();
  publishWaveformSummary('song.wav', summary(-1));
  expect(useWaveformStore.getState().source).not.toBe(previous);
  expect([...useWaveformStore.getState().source!.getEnvelope(0, 1, 1)!.min]).toEqual([-1]);
});
it('publishes only the bounded native summary needed by waveform tiles', () => {
  beginWaveformPreparation('new.wav');
  publishWaveformSummary('new.wav', summary(-1));
  expect(useWaveformStore.getState().path).toBe('new.wav');
  expect([...useWaveformStore.getState().source!.getEnvelope(0, 1, 1)!.max]).toEqual([0]);
});
it('clears published summary data when audio is unloaded', () => {
  beginWaveformPreparation('song.wav');
  publishWaveformSummary('song.wav', summary(1));
  clearWaveform();
  expect(useWaveformStore.getState()).toEqual({ path: null, source: null, preparing: false });
});
