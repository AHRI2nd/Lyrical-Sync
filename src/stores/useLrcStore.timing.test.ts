// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
import { useLrcStore } from './useLrcStore';
import { defaultDocument } from '../types/lrc';
import { serializeLrc } from '../utils/lrcParser';
import { setDocumentConfirmation } from '../utils/documentTransition';
beforeEach(async () => {
 setDocumentConfirmation(async () => "discard");
 await useLrcStore.getState().newLrc();
 useLrcStore.setState({doc:{...defaultDocument(),lines:[{id:'a',text:'a b',timestamp:1,syllables:[{text:'a',time:1},{text:' ',time:null},{text:'b',time:2}]}]},activeLineId:'a',currentTime:30});
});
it('restamps calibrated glyphs together with the line onset', () => {
 useLrcStore.getState().stampAndAdvance();
 expect(useLrcStore.getState().doc.lines[0].syllables?.map(s=>s.time)).toEqual([30,null,31]);
 expect(serializeLrc(useLrcStore.getState().doc)).toContain('[00:30.00]<00:30.00>a <00:31.00>b');
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
