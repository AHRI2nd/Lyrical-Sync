import { afterEach, expect, it } from 'vitest';
import { clearWaveform, prepareWaveform, useWaveformStore } from './useWaveformStore';
function buffer(length: number, value: number) {
  const samples = new Float32Array(length).fill(value);
  return { length, numberOfChannels: 1, sampleRate: length, duration: 1, getChannelData: () => samples };
}
afterEach(clearWaveform);
it('publishes a fresh source for same-path and same-duration audio replacement', async () => {
  await prepareWaveform('song.wav', buffer(4, 1));
  const previous = useWaveformStore.getState().source;
  const pending = prepareWaveform('song.wav', buffer(4, -1));
  expect(useWaveformStore.getState().source).toBeNull();
  await pending;
  expect(useWaveformStore.getState().source).not.toBe(previous);
  expect([...useWaveformStore.getState().source!.getEnvelope(0, 1, 1)!.min]).toEqual([-1]);
});
it('discards an older preparation that finishes after replacement', async () => {
  const old = prepareWaveform('old.wav', buffer(524288, 1));
  await prepareWaveform('new.wav', buffer(4, -1));
  await old;
  expect(useWaveformStore.getState().path).toBe('new.wav');
  expect([...useWaveformStore.getState().source!.getEnvelope(0, 1, 1)!.max]).toEqual([0]);
});
it('clears published data and cancels pending work when audio is unloaded', async () => {
  const pending = prepareWaveform('song.wav', buffer(524288, 1));
  clearWaveform(); await pending;
  expect(useWaveformStore.getState()).toEqual({ path: null, source: null, preparing: false });
});
