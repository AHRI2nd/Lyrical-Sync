// @vitest-environment jsdom
import React,{StrictMode,useRef,useState} from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useModalFocus} from './useModalFocus';
afterEach(cleanup);
function Dialog({name,onClose,children,priority=50}:{name:string;onClose?:()=>void;children?:React.ReactNode;priority?:number}){
 const ref=useRef<HTMLDivElement>(null);useModalFocus(ref,onClose,true,priority);return <div ref={ref} role="dialog" aria-label={name} tabIndex={-1}>{children}</div>;
}
it('wraps Tab in both directions, redirects outside focus and restores preexisting inert',async()=>{
 const outside=document.createElement('button');outside.textContent='Outside';document.body.append(outside);outside.focus();
 const inert=document.createElement('div');inert.setAttribute('inert','');document.body.append(inert);
 const view=render(<Dialog name="test"><button>First</button><button disabled>Disabled</button><button hidden>Hidden</button><button>Last</button></Dialog>);
 const user=userEvent.setup();expect(document.activeElement).toBe(screen.getByRole('button',{name:'First'}));
 await user.tab({shift:true});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Last'}));
 await user.tab();expect(document.activeElement).toBe(screen.getByRole('button',{name:'First'}));
 outside.focus();expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
 view.unmount();expect(document.activeElement).toBe(outside);expect(outside.hasAttribute('inert')).toBe(false);expect(inert.hasAttribute('inert')).toBe(true);outside.remove();inert.remove();
});
it('handles only the top nested dialog and restores focus to its opener',async()=>{
 const parentClosed=vi.fn();function Fixture(){const[child,setChild]=useState(false);return <Dialog name="Parent" onClose={parentClosed}><button onClick={()=>setChild(true)}>Open child</button>{child&&<Dialog name="Child" onClose={()=>setChild(false)}><button>Child control</button></Dialog>}</Dialog>;}
 render(<Fixture/>);const user=userEvent.setup();const opener=screen.getByRole('button',{name:'Open child'});await user.click(opener);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'Child control'}));await user.keyboard('{Escape}');
 expect(screen.queryByRole('dialog',{name:'Child'})).toBeNull();expect(document.activeElement).toBe(opener);expect(parentClosed).not.toHaveBeenCalled();
 await user.keyboard('{Escape}');expect(parentClosed).toHaveBeenCalledOnce();
});
it('respects priority above later sibling dialogs',()=>{
 const first=vi.fn(),second=vi.fn();render(<><Dialog name="Priority" priority={80} onClose={first}><button>Priority control</button></Dialog><Dialog name="Later" onClose={second}><button>Later control</button></Dialog></>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'Priority control'}));fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(first).toHaveBeenCalledOnce();expect(second).not.toHaveBeenCalled();
});
it('keeps an empty downloading dialog focused without dismissing on Escape',async()=>{
 render(<Dialog name="Downloading"/>);expect(document.activeElement).toBe(screen.getByRole('dialog'));const user=userEvent.setup();await user.tab();await user.keyboard('{Escape}');expect(document.activeElement).toBe(screen.getByRole('dialog'));
});
it('preserves IME Escape and target-specific key handling',()=>{
 const close=vi.fn();render(<Dialog name="IME" onClose={close}><input onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation();}}/></Dialog>);
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});fireEvent.keyDown(document,{key:'Escape',isComposing:true});expect(close).not.toHaveBeenCalled();
});
it('cleans up isolation through StrictMode and repeated mount cycles',()=>{
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();const view=render(<StrictMode><Dialog name="Strict"><button>Inside</button></Dialog></StrictMode>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'Inside'}));view.unmount();expect(document.activeElement).toBe(trigger);expect(document.querySelector('[inert]')).toBeNull();trigger.remove();
});

it('selects an initially mounted child despite its effect running before its parent',()=>{
 const parent=vi.fn(),child=vi.fn();render(<Dialog name="Parent" onClose={parent}><button>Parent control</button><Dialog name="Child" onClose={child}><button>Child control</button></Dialog></Dialog>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'Child control'}));fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(child).toHaveBeenCalledOnce();expect(parent).not.toHaveBeenCalled();
});
