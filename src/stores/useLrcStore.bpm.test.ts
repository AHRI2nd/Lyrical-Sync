import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
import { useLrcStore } from './useLrcStore';
import { defaultDocument } from '../types/lrc';
beforeEach(() => useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
  { id: 'a', text: 'ab', timestamp: 1.34, syllables: [{ text:'a',time:1.34 },{ text:'b',time:1.55 }] },
  { id: 'b', text: 'next', timestamp: 3.2 },
]}, _history:[], _future:[], _lastEditKey:null, isDirty:false }));
it('snaps selected lines in one undo while retaining relative glyph timings', () => {
  const original=useLrcStore.getState().doc;
  useLrcStore.getState().snapLinesToBeatGrid(['a'],120,0);
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1.5);
  expect(useLrcStore.getState().doc.lines[0].syllables?.map(s=>s.time)).toEqual([1.5,1.71]);
  expect(useLrcStore.getState().doc.lines[1].timestamp).toBe(3.2);
  expect(useLrcStore.getState()._history).toHaveLength(1);
  useLrcStore.getState().undo(); expect(useLrcStore.getState().doc).toBe(original);
});
it.each([[Infinity,0],[0,0],[120,NaN],[5e-324,0]])('ignores unusable grids bpm=%s offset=%s', (bpm,offset) => {
  const original=useLrcStore.getState().doc;
  useLrcStore.getState().snapLinesToBeatGrid([],bpm,offset);
  expect(useLrcStore.getState().doc).toBe(original);
  expect(useLrcStore.getState()._history).toHaveLength(0);
});
