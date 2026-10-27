// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
import { useLrcStore } from './useLrcStore';
import { defaultDocument } from '../types/lrc';
import { serializeLrc } from '../utils/lrcParser';
import { serializeVtt, serializeAss } from '../utils/exportFormats';
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
