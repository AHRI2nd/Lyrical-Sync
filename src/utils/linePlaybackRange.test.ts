import { expect, it } from 'vitest';
import { getLinePlaybackRange } from './linePlaybackRange';
it('skips duplicate or earlier timestamps when finding a repeat boundary', () => {
  expect(getLinePlaybackRange([
    { id: 'a', text: '', timestamp: 10 }, { id: 'b', text: '', timestamp: 10 },
    { id: 'c', text: '', timestamp: 5 }, { id: 'd', text: '', timestamp: 20 },
  ], 'a', 100)).toEqual({ start: 10, end: 20 });
});
it('uses track end for the final valid line and rejects invalid intervals', () => {
  expect(getLinePlaybackRange([{ id: 'a', text: '', timestamp: 90 }], 'a', 100)).toEqual({ start: 90, end: 100 });
  for (const timestamp of [null, -1, 100, 101, NaN]) {
    expect(getLinePlaybackRange([{ id: 'a', text: '', timestamp }], 'a', 100)).toBeNull();
  }
});
it('uses an explicit SRT cue end before the next line boundary and clamps it to the track', () => {
  expect(getLinePlaybackRange([
    { id: 'srt', text: '', timestamp: 10, srtEndTime: 20 },
    { id: 'overlap', text: '', timestamp: 15 },
  ], 'srt', 30)).toEqual({ start: 10, end: 20 });
  expect(getLinePlaybackRange([{ id: 'srt', text: '', timestamp: 10, srtEndTime: 40 }], 'srt', 30))
    .toEqual({ start: 10, end: 30 });
});
