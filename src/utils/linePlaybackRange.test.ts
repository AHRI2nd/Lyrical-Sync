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
