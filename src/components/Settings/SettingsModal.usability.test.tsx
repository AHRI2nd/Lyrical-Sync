// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {act,render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const check=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/plugin-updater',()=>({check}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
import {SettingsModal} from './SettingsModal';
import {UpdateModal} from '../Update/UpdateModal';
import {useUpdaterStore} from '../../stores/useUpdaterStore';
import {useI18nStore} from '../../stores/useI18nStore';
afterEach(cleanup);
beforeEach(()=>{check.mockReset();useUpdaterStore.setState({status:'idle',error:null,_update:null});useI18nStore.getState().setLang('en');});
it('keeps focus inside settings and makes the background inert until close',async()=>{
 const background=vi.fn();
 function Fixture(){const[open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Open settings</button><button onClick={background}>Background action</button>{open&&<SettingsModal onClose={()=>setOpen(false)} onUpdateFound={()=>{}}/>}</>;}
 render(<Fixture/>);const user=userEvent.setup();const trigger=screen.getByRole('button',{name:'Open settings'});await user.click(trigger);
 const dialog=screen.getByRole('dialog',{name:'Settings'});
 expect(dialog.contains(document.activeElement)).toBe(true);
 expect(trigger.closest('[inert]')).not.toBeNull();
 for(let n=0;n<25;n++){await user.tab();expect(dialog.contains(document.activeElement)).toBe(true);}
 await user.tab({shift:true});expect(dialog.contains(document.activeElement)).toBe(true);expect(background).not.toHaveBeenCalled();
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(trigger.closest('[inert]')).toBeNull();
});

it('focuses update errors above settings and closes only the update with Escape',async()=>{
 useUpdaterStore.setState({status:'error',error:'Unavailable'});const close=vi.fn();render(<><SettingsModal onClose={close} onUpdateFound={()=>{}}/><UpdateModal/></>);
 const dialog=screen.getByRole('dialog',{name:useI18nStore.getState().t.updater.errorTitle});expect(dialog.contains(document.activeElement)).toBe(true);
 await userEvent.setup().keyboard('{Escape}');expect(close).not.toHaveBeenCalled();expect(useUpdaterStore.getState().status).toBe('idle');expect(screen.getByRole('dialog',{name:'Settings'}).contains(document.activeElement)).toBe(true);
});
it('does not dismiss a downloading update or its underlying settings',async()=>{
 useUpdaterStore.setState({status:'downloading'});const close=vi.fn();render(<><SettingsModal onClose={close} onUpdateFound={()=>{}}/><UpdateModal/></>);
 const dialog=screen.getByRole('dialog',{name:useI18nStore.getState().t.updater.title});await userEvent.setup().keyboard('{Escape}');expect(useUpdaterStore.getState().status).toBe('downloading');expect(close).not.toHaveBeenCalled();expect(document.activeElement).toBe(dialog);
});
it('shows a retryable error instead of claiming a failed update check is current',async()=>{
 check.mockRejectedValueOnce(new Error('Server unavailable')).mockResolvedValueOnce(null);render(<SettingsModal onClose={()=>{}} onUpdateFound={()=>{}}/>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Check Now'}));
 expect(screen.queryByText("You're up to date.")).toBeNull();expect(screen.getByRole('alert').textContent).toBe(useI18nStore.getState().t.updater.errorTitle);
 await user.click(screen.getByRole('button',{name:'Check Now'}));expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText("You're up to date.")).toBeTruthy();
});
it('closes settings for an available update without a false success label',async()=>{
 check.mockResolvedValue({version:'0.8.0',body:'Test release'});const close=vi.fn(),found=vi.fn();render(<SettingsModal onClose={close} onUpdateFound={found}/>);await userEvent.setup().click(screen.getByRole('button',{name:'Check Now'}));expect(close).toHaveBeenCalledOnce();expect(found).toHaveBeenCalledOnce();expect(screen.queryByText("You're up to date.")).toBeNull();
});

it('keeps the real updater dialog focused across download and result transitions',()=>{
 useUpdaterStore.setState({status:'available'});render(<UpdateModal/>);const t=useI18nStore.getState().t;
 screen.getByRole('button',{name:t.updater.update}).focus();act(()=>useUpdaterStore.setState({status:'downloading'}));expect(document.activeElement).toBe(screen.getByRole('dialog'));
 act(()=>useUpdaterStore.setState({status:'ready'}));screen.getByRole('button',{name:t.updater.restart}).focus();act(()=>useUpdaterStore.setState({status:'error',error:'Install failed'}));expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);expect(document.activeElement).toBe(screen.getByRole('button',{name:t.updater.close}));
});
