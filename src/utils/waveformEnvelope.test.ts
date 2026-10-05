import { describe, expect, it } from 'vitest';
import { createWaveformSource } from './waveformEnvelope';
function buffer(channels: number[][], sampleRate = 4) {
  const data = channels.map(x => new Float32Array(x));
  return { length: data[0].length, numberOfChannels: data.length, sampleRate,
    duration: data[0].length / sampleRate, getChannelData: (i: number) => data[i] };
}
describe('waveform envelope', () => {
  it('preserves transients and negative peaks in their true time bins', async () => {
    const source = await createWaveformSource(buffer([[0, 1, -.5, 0, 0, .25, -.25, 0]]));
    const wave = source.getEnvelope(0, 2, 2)!;
    expect([...wave.max]).toEqual([1, .25]);
    expect([...wave.min]).toEqual([-.5, -.25]);
    const zoom = source.getEnvelope(.25, .75, 2)!;
    expect([...zoom.max]).toEqual([1, 0]);
    expect([...zoom.min]).toEqual([0, -.5]);
  });
  it('includes right-channel-only audio and keeps track normalization stable', async () => {
    const source = await createWaveformSource(buffer([[0, 0, 0, 0], [0, .5, -.25, 0]]));
    expect([...source.getEnvelope(0, 1, 1)!.max]).toEqual([1]);
    expect([...source.getEnvelope(.5, 1, 1)!.min]).toEqual([-.5]);
  });
  it('clamps track edges and repeats real samples when pixels outnumber samples', async () => {
    const source = await createWaveformSource(buffer([[.5, -.5]]));
    const wave = source.getEnvelope(-3, 5, 4)!;
    expect(wave.start).toBe(0); expect(wave.end).toBe(.5);
    expect([...wave.max]).toEqual([1, 1, 0, 0]);
    expect([...wave.min]).toEqual([0, 0, -1, -1]);
    expect(source.getEnvelope(1, 2, 10)).toBeNull();
    expect(source.getEnvelope(0, .5, NaN)).toBeNull();
  });
  it('returns flat silence and reuses a bounded viewport cache', async () => {
    const source = await createWaveformSource(buffer([[0, 0, 0, 0]]));
    const wave = source.getEnvelope(0, 1, 3)!;
    expect([...wave.max]).toEqual([0, 0, 0]);
    expect(source.getEnvelope(0, 1, 3)).toBe(wave);
    for (let i = 1; i <= 10; i++) source.getEnvelope(0, 1, i + 4);
    expect(source.getEnvelope(0, 1, 3)).not.toBe(wave);
  });
  it('uses summaries without losing transients at partial block boundaries', async () => {
    const samples = Array(1024).fill(0); samples[255] = 1; samples[256] = -.5; samples[1023] = .75;
    const source = await createWaveformSource(buffer([samples], 1024));
    expect([...source.getEnvelope(255/1024, 257/1024, 2)!.max]).toEqual([1, 0]);
    expect([...source.getEnvelope(0, 1, 2)!.min]).toEqual([-.5, 0]);
    expect([...source.getEnvelope(0, 1, 2)!.max]).toEqual([1, .75]);
  });
  it('aborts preparation so replaced audio cannot publish a waveform', async () => {
    const controller = new AbortController();controller.abort();
    await expect(createWaveformSource(buffer([[0]]), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
