import { describe, expect, it } from 'vitest';
import { createWaveformSource, getWaveformTiles } from './waveformEnvelope';
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
    for (let i = 1; i <= 20; i++) source.getEnvelope(0, 1, i + 4);
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
  it('keeps audio-time tile bins and cached geometry fixed across fractional scrolling', async () => {
    const samples = Array(8192).fill(0); samples[2100] = 1; samples[2101] = .4;
    const source = await createWaveformSource(buffer([samples], 1024));
    const tile = source.getTile(0, 1 / 1024)!;
    expect(tile.start).toBe(-1 / 1024);
    expect(tile.min.length).toBe(514);
    expect(source.getTile(0, 1 / 1024)).toBe(tile);
    const peakTile = source.getTile(4, 1 / 1024)!;
    expect(peakTile.max[53]).toBe(1);
    expect(peakTile.max[54]).toBeCloseTo(.4);
    expect(source.getTile(4, 1 / 2048)).not.toBe(peakTile);
  });
  it('pads track edges without stretching bins and shares guard samples across tile seams', async () => {
    const samples = Array(520).fill(0); samples[511] = .5; samples[512] = 1; samples[519] = -.25;
    const source = await createWaveformSource(buffer([samples], 1024));
    const first = source.getTile(0, 1 / 1024)!;
    const last = source.getTile(1, 1 / 1024)!;
    expect(first.max[0]).toBe(0);
    expect(first.max[512]).toBe(.5);
    expect(first.max[513]).toBe(1);
    expect(last.max[0]).toBe(.5);
    expect(last.max[1]).toBe(1);
    expect(last.min[8]).toBe(-.25);
    expect(last.max[9]).toBe(0);
    expect(last.end).toBe(1025 / 1024);
    expect(source.getTile(-1, 1 / 1024)).toBeNull();
    expect(source.getTile(0, 0)).toBeNull();
  });
  it('reuses overlapping tiles when crossing a boundary and ignores floating span noise', async () => {
    const source = await createWaveformSource(buffer([Array(2048).fill(.5)], 1024));
    const before = getWaveformTiles(source, .49, .99, 512);
    const after = getWaveformTiles(source, .51, 1.01, 512);
    expect(before[1]).toBe(after[0]);
    expect(after[0].start).toBe(511 / 1024);
    expect(getWaveformTiles(source, .51001, 1.01001, 512)[0]).toBe(after[0]);
    expect(getWaveformTiles(source, .51, 1.01, 1024)[0]).not.toBe(after[0]);
    expect(getWaveformTiles(source, 0, 0, 512)).toEqual([]);
    expect(getWaveformTiles(source, 0, 1, NaN)).toEqual([]);
  });
});
