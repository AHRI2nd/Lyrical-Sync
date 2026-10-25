// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { useYouTubeLoad } from "./useYouTubeLoad";
import { useBusyStore } from "../../stores/useBusyStore";
import { useLrcStore } from "../../stores/useLrcStore";
beforeEach(() => {
 invokeMock.mockReset().mockResolvedValue(undefined);
 useBusyStore.setState({reasons:new Set()});
 useLrcStore.getState().newLrc();useLrcStore.getState().setAudioPath(null);
});
afterEach(cleanup);
function start() {
 let resolve!: (value:string)=>void;
 let reject!: (error:Error)=>void;
 const response=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
 invokeMock.mockImplementation((command:string)=>command==='ytdlp_load_audio'?response:Promise.resolve(undefined));
 const apply=vi.fn((path:string)=>useLrcStore.getState().setAudioPath(path));
 const hook=renderHook(()=>useYouTubeLoad(apply));
 act(()=>hook.result.current.setYtUrl('https://synthetic.invalid/watch'));
 let pending!:Promise<void>;
 act(()=>{pending=hook.result.current.handleYtLoad();});
 return {...hook,apply,pending,resolve,reject};
}
it('applies an unchanged download and releases busy ownership', async () => {
 const run=start();await act(async()=>{run.resolve('/completed.wav');await run.pending;});
 expect(run.apply).toHaveBeenCalledWith('/completed.wav');expect(useBusyStore.getState().reasons.size).toBe(0);
});
it.each(['different','same path','new document'])('ignores a result after a later selection: %s', async change => {
 const run=start();
 if(change==='different') useLrcStore.getState().setAudioPath('/later.wav');
 if(change==='same path') useLrcStore.getState().setAudioPath(null);
 if(change==='new document') useLrcStore.getState().newLrc();
 await act(async()=>{run.resolve('/obsolete.wav');await run.pending;});
 expect(run.apply).not.toHaveBeenCalled();expect(run.result.current.ytLoading).toBe(false);
 expect(useBusyStore.getState().reasons.size).toBe(0);
});
it('keeps cancellation busy until native completion without applying a late success', async () => {
 const run=start();act(()=>run.result.current.handleYtCancel());
 expect(invokeMock).toHaveBeenCalledWith('cancel_ytdlp_load');
 expect(run.result.current.ytLoading).toBe(true);expect(useBusyStore.getState().reasons.size).toBe(1);
 await act(async()=>{run.resolve('/cancelled.wav');await run.pending;});
 expect(run.apply).not.toHaveBeenCalled();expect(useBusyStore.getState().reasons.size).toBe(0);
});
it('does not apply a download after unmount and retains busy until completion', async () => {
 const run=start();run.unmount();expect(useBusyStore.getState().reasons.size).toBe(1);
 run.resolve('/unmounted.wav');await run.pending;
 expect(run.apply).not.toHaveBeenCalled();expect(useBusyStore.getState().reasons.size).toBe(0);
});
it('rejects duplicate submissions before the first settles', async () => {
 const run=start();let duplicate!:Promise<void>;
 act(()=>{duplicate=run.result.current.handleYtLoad();});
 const count=invokeMock.mock.calls.filter(([command])=>command==='ytdlp_load_audio').length;
 await act(async()=>{run.resolve('/completed.wav');await Promise.all([run.pending,duplicate]);});
 expect(count).toBe(1);
});
it('releases only its own busy reason after native failure', async () => {
 const run=start();useBusyStore.getState().markBusy('other-work');
 await act(async()=>{run.reject(new Error('download failed'));await run.pending;});
 expect(run.result.current.ytError).toContain('download failed');expect(run.apply).not.toHaveBeenCalled();
 expect([...useBusyStore.getState().reasons]).toEqual(['other-work']);
});
