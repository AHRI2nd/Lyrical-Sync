// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { useLrcStore } from '../stores/useLrcStore';
import { defaultDocument } from '../types/lrc';
const deferred = <T,>() => { let resolve!: (value:T)=>void; const promise = new Promise<T>(r => { resolve=r; }); return {promise,resolve}; };
const doc = (text='original') => ({...defaultDocument(),lines:[{id:'a',timestamp:1,text}]});
beforeEach(() => { useLrcStore.getState().cancelAiSync(); vi.mocked(invoke).mockReset(); useLrcStore.getState().newLrc(); useLrcStore.setState({doc:doc(),audioPath:'/synthetic.wav',isDirty:false}); });
async function startAlignment() {
 const run=deferred<string>();
 vi.mocked(invoke).mockImplementation((command) => command==='run_alignment' ? run.promise : Promise.resolve(undefined));
 const pending=useLrcStore.getState().runAiSync('en',0,false,false);
 await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith('run_alignment',expect.anything()));
 return {pending,finish:()=>run.resolve(JSON.stringify([{index:0,start:7,end:8,confidence:1}]))};
}
it('F1: Undo during AI preserves the user-selected historical text', async () => {
 useLrcStore.getState().updateLine('a',{text:'edited'});
 const run=await startAlignment();
 useLrcStore.getState().undo(); expect(useLrcStore.getState().doc.lines[0].text).toBe('original');
 run.finish(); await run.pending;
 expect(useLrcStore.getState().doc.lines[0].text).toBe('original');
});
it('F1: Redo during AI preserves the newer text', async () => {
 useLrcStore.getState().updateLine('a',{text:'edited'}); useLrcStore.getState().undo();
 const run=await startAlignment(); useLrcStore.getState().redo();
 run.finish(); await run.pending;
 expect(useLrcStore.getState().doc.lines[0].text).toBe('edited');
});
it('control: a normal edit invalidates a pending AI result', async () => {
 const run=await startAlignment(); useLrcStore.getState().updateLine('a',{text:'newer'});
 run.finish(); await run.pending; expect(useLrcStore.getState().doc.lines[0].text).toBe('newer');
});
it('history jump invalidates pending AI results', async () => {
 useLrcStore.getState().updateLine('a',{text:'edited'});
 const run=await startAlignment();useLrcStore.getState().jumpToHistory(0);
 run.finish();await run.pending;
 expect(useLrcStore.getState().doc.lines[0].text).toBe('original');
 expect(useLrcStore.getState().aiSyncStatus).toBe('idle');
 expect(invoke).toHaveBeenCalledWith('cancel_alignment', expect.anything());
});
it('a no-op Undo does not cancel an unchanged AI run', async () => {
 const run=await startAlignment();useLrcStore.getState().undo();run.finish();await run.pending;
 expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(7);
 expect(useLrcStore.getState().aiSyncStatus).toBe('done');
});
