// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {SettingsModal} from './SettingsModal';
import {useI18nStore} from '../../stores/useI18nStore';
import {translations} from '../../i18n/translations';
afterEach(cleanup);
beforeEach(()=>useI18nStore.setState({lang:'en',t:translations.en}));
it('keeps focus inside settings and makes the background inert until close',async()=>{
 const background=vi.fn();
 function Fixture(){const[open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Open settings</button><button onClick={background}>Background action</button>{open&&<SettingsModal onClose={()=>setOpen(false)}/>}</>;}
 render(<Fixture/>);const user=userEvent.setup();const trigger=screen.getByRole('button',{name:'Open settings'});await user.click(trigger);
 const dialog=screen.getByRole('dialog',{name:'Settings'});
 expect(dialog.contains(document.activeElement)).toBe(true);
 expect(trigger.closest('[inert]')).not.toBeNull();
 for(let n=0;n<25;n++){await user.tab();expect(dialog.contains(document.activeElement)).toBe(true);}
 await user.tab({shift:true});expect(dialog.contains(document.activeElement)).toBe(true);expect(background).not.toHaveBeenCalled();
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(trigger.closest('[inert]')).toBeNull();
});
