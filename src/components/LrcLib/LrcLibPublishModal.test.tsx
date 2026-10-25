// @vitest-environment jsdom
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke}));
import {LrcLibPublishModal} from './LrcLibPublishModal';
import {useLrcStore} from '../../stores/useLrcStore';
import {useI18nStore} from '../../stores/useI18nStore';
import {defaultDocument} from '../../types/lrc';
beforeEach(()=>{invoke.mockReset();useI18nStore.getState().setLang('en');useLrcStore.setState({doc:{...defaultDocument(),metadata:{...defaultDocument().metadata,title:'Audit synthetic title',artist:'Audit synthetic artist'},lines:[{id:'audit',text:'Synthetic audit words',timestamp:0}]},duration:2});});
afterEach(cleanup);
async function start(onClose:()=>void){render(<LrcLibPublishModal onClose={onClose}/>);const t=useI18nStore.getState().t.lrclibPublish;const user=userEvent.setup();await user.click(screen.getByRole('button',{name:t.publish}));await user.click(screen.getByRole('button',{name:t.confirm}));return {user,t};}
it('allows leaving a stalled publish operation without terminating the app',async()=>{
 invoke.mockReturnValue(new Promise(()=>{}));const close=vi.fn();const {user,t}=await start(close);
 fireEvent.keyDown(window,{key:'Escape'});await user.click(screen.getByRole('button',{name:t.cancel}));expect(close).toHaveBeenCalled();
});
it('control: an explicit network rejection restores a usable cancel action',async()=>{
 invoke.mockRejectedValue(new Error('Synthetic network failure'));const close=vi.fn();const {user,t}=await start(close);await waitFor(()=>expect(screen.getByRole('button',{name:t.cancel}).hasAttribute('disabled')).toBe(false));await user.click(screen.getByRole('button',{name:t.cancel}));expect(close).toHaveBeenCalledOnce();
});
it('control: completed publishing allows close',async()=>{
 invoke.mockResolvedValue(undefined);const close=vi.fn();const {user,t}=await start(close);await user.click(await screen.findByRole('button',{name:t.close}));expect(close).toHaveBeenCalledOnce();
});

it('cancels the matching native run when a pending modal is unmounted',async()=>{
 invoke.mockImplementation((command)=>command==='lrclib_publish'?new Promise(()=>{}):Promise.resolve());
 await start(vi.fn());const runId=invoke.mock.calls.find(([command])=>command==='lrclib_publish')?.[1]?.runId;
 expect(typeof runId).toBe('string');cleanup();expect(invoke).toHaveBeenCalledWith('cancel_lrclib_publish',{runId});
});
it('Escape releases a pending publish without waiting for the native response',async()=>{
 invoke.mockImplementation((command)=>command==='lrclib_publish'?new Promise(()=>{}):Promise.resolve());
 const close=vi.fn();const {user}=await start(close);await user.keyboard('{Escape}');expect(close).toHaveBeenCalledOnce();
});
