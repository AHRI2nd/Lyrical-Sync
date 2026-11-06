// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
import { useLrcStore } from './useLrcStore';
import { defaultDocument } from '../types/lrc';
import { serializeLrc } from '../utils/lrcParser';
import { serializeVtt, serializeAss } from '../utils/exportFormats';
import { serializeSrt } from '../utils/srtConverter';
import { invoke } from '@tauri-apps/api/core';
beforeEach(() => {
 useLrcStore.getState().newLrc();
 useLrcStore.setState({doc:{...defaultDocument(),lines:[{id:'a',text:'a b',timestamp:1,syllables:[{text:'a',time:1},{text:' ',time:null},{text:'b',time:2}]}]},activeLineId:'a',currentTime:30});
});
it('restamps calibrated glyphs together with the line onset', () => {
 useLrcStore.getState().stampAndAdvance();
 expect(useLrcStore.getState().doc.lines[0].syllables?.map(s=>s.time)).toEqual([30,null,31]);
 expect(serializeLrc(useLrcStore.getState().doc)).toContain('[00:30.00]<00:30.00>a <00:31.00>b');
});
it('moves glyph timestamps with a direct row stamp and keeps the exports and undo consistent', () => {
 const store = useLrcStore.getState();
 store.stampCurrentLine('a');
 const doc = useLrcStore.getState().doc;

 expect(doc.lines[0].timestamp).toBe(30);
 expect(doc.lines[0].syllables?.map(s => s.time)).toEqual([30,null,31]);
 expect(serializeLrc(doc)).toContain('[00:30.00]<00:30.00>a <00:31.00>b');
 expect(serializeVtt(doc, 40)).toContain('00:00:30.000');
 expect(serializeVtt(doc, 40)).toContain('00:00:31.000');
 expect(serializeAss(doc, 40)).toContain('0:00:30.00');
 expect(serializeAss(doc, 40)).toContain('{\\k100}a {\\k900}b');
 expect(useLrcStore.getState()._history).toHaveLength(1);

 useLrcStore.getState().undo();
 expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(1);
 expect(useLrcStore.getState().doc.lines[0].syllables?.map(s => s.time)).toEqual([1,null,2]);
});
it('moves glyphs to zero on manual onset editing while preserving null tokens', () => {
 useLrcStore.getState().updateLine('a',{timestamp:0});
 expect(useLrcStore.getState().doc.lines[0].syllables?.map(s=>s.time)).toEqual([0,null,1]);
});
it('clears glyph timing when the line onset is removed', () => {
 useLrcStore.getState().updateLine('a',{timestamp:null});
 expect(useLrcStore.getState().doc.lines[0]).toMatchObject({timestamp:null,syllables:undefined});
});
it('restores the original line and glyph times with Undo', () => {
 useLrcStore.getState().stampAndAdvance();useLrcStore.getState().undo();
 expect(useLrcStore.getState().doc.lines[0]).toMatchObject({timestamp:1,syllables:[{text:'a',time:1},{text:' ',time:null},{text:'b',time:2}]});
});
it('anchors previously inconsistent glyph timing at a fractional new onset', () => {
 const line=useLrcStore.getState().doc.lines[0];
 useLrcStore.setState({doc:{...defaultDocument(),lines:[{...line,timestamp:20}]}});
 useLrcStore.getState().updateLine('a',{timestamp:5.25});
 expect(useLrcStore.getState().doc.lines[0].syllables?.map(s=>s.time)).toEqual([5.25,null,6.25]);
});
it('respects an explicit replacement for glyphs in the same edit', () => {
 useLrcStore.getState().updateLine('a',{timestamp:5,syllables:undefined});
 expect(useLrcStore.getState().doc.lines[0]).toMatchObject({timestamp:5,syllables:undefined});
});

// Use the real SRT import, store mutation and serializer. Only native IPC is mocked.
const loadSrtFixture = async (start: string, end: string) => {
  const original = `1\n${start} --> ${end}\nQuick\n`;
  const writes: string[] = [];
  vi.mocked(invoke).mockReset().mockImplementation((command, args) => {
    if (command === 'read_lrc_file_with_hash') return Promise.resolve({ content: original, sha256: 'a'.repeat(64) });
    if (command === 'write_lrc_file_if_unchanged') {
      writes.push((args as { content: string }).content);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(undefined);
  });
  await useLrcStore.getState().loadLyricsPath('/tmp/synthetic-short-cue.srt');
  return { original, writes };
};

it.each([
  ['0.1× of a 1ms cue', '00:00:01,000', '00:00:01,001', 0.1],
  ['0.5× of a 1ms cue', '00:00:02,001', '00:00:02,002', 0.5],
  ['0.5× sub-ms result even when endpoint rounding leaves a 1ms span', '00:00:00,002', '00:00:00,003', 0.5],
])('refuses unrepresentable SRT precision before mutation/save: %s', async (_, start, end, factor) => {
  const { writes } = await loadSrtFixture(start, end);
  const before = useLrcStore.getState();
  const firstCue = before.doc.lines.find(line => line.text === 'Quick')!;
  expect(firstCue.srtEndTime! - firstCue.timestamp!).toBeCloseTo(.001, 6);
  if (start === '00:00:00,002') {
    // Although independent millisecond rounding would leave a positive span,
    // the requested half-speed cue duration is still sub-millisecond.
    expect(Math.round(firstCue.timestamp! * factor * 1000)).toBe(1);
    expect(Math.round(firstCue.srtEndTime! * factor * 1000)).toBe(2);
  }
  // A real earlier edit must remain dirty and undoable after scaling is rejected.
  useLrcStore.getState().updateLine(firstCue.id, { text: 'Quick edited' });
  const snapshot = useLrcStore.getState();
  expect(snapshot._history).toHaveLength(1);
  useLrcStore.getState().scaleTimestamps(factor);
  const after = useLrcStore.getState();
  expect(after.doc).toBe(snapshot.doc);
  expect(after._editRevision).toBe(snapshot._editRevision);
  expect(after._history).toBe(snapshot._history);
  expect(after._future).toBe(snapshot._future);
  expect(after.isDirty).toBe(true);
  expect(writes).toEqual([]);

  useLrcStore.getState().undo();
  expect(useLrcStore.getState().doc.lines.find(line => line.id === firstCue.id)?.text).toBe('Quick');
  useLrcStore.getState().redo();
  expect(useLrcStore.getState().doc.lines.find(line => line.id === firstCue.id)?.text).toBe('Quick edited');

  await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toContain(`${start} --> ${end}`);
  expect(writes[0]).toContain('Quick edited');
  expect(useLrcStore.getState().isDirty).toBe(false);
});

it('scales a representable SRT cue, supports undo/redo and saves the intended duration', async () => {
  const { writes } = await loadSrtFixture('00:00:01,000', '00:00:01,040');
  const initialDoc = useLrcStore.getState().doc;
  useLrcStore.getState().scaleTimestamps(0.5);
  const scaled = useLrcStore.getState();
  expect(scaled.doc.lines.find(line => line.text === 'Quick')).toMatchObject({timestamp: 0.5, srtEndTime: 0.52});
  expect(scaled.isDirty).toBe(true);
  expect(scaled._history).toHaveLength(1);
  expect(serializeSrt(scaled.doc)).toContain('00:00:00,500 --> 00:00:00,520');

  useLrcStore.getState().undo();
  expect(useLrcStore.getState().doc.lines).toEqual(initialDoc.lines);
  useLrcStore.getState().redo();
  expect(useLrcStore.getState().doc.lines.find(line => line.text === 'Quick')).toMatchObject({timestamp: 0.5, srtEndTime: 0.52});

  await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toContain('00:00:00,500 --> 00:00:00,520');
  expect(useLrcStore.getState().isDirty).toBe(false);
});

it.each([
  [1, 1, 1.001],
  [1.000000000001, 1, 1.001],
  [2, 2, 2.002],
])('retains a representable original 1ms cue when scaling by %s', async (factor, expectedStart, expectedEnd) => {
  const { writes } = await loadSrtFixture('00:00:01,000', '00:00:01,001');
  const initialDoc = useLrcStore.getState().doc;
  useLrcStore.getState().scaleTimestamps(factor);
  const current = useLrcStore.getState();
  expect(current.doc.lines.find(line => line.text === 'Quick')).toMatchObject({
    timestamp: expectedStart, srtEndTime: expectedEnd,
  });
  if (factor === 1) {
    expect(current.doc).toBe(initialDoc);
    expect(current._history).toHaveLength(0);
  } else {
    expect(current.doc).not.toBe(initialDoc);
    expect(current._history).toHaveLength(1);
  }
  await expect(useLrcStore.getState().saveLrc()).resolves.toBe(true);
  expect(writes).toHaveLength(1);
  expect(writes[0]).not.toContain('00:00:04,');
});
