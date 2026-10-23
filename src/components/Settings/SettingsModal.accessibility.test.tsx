// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {SettingsModal} from './SettingsModal';
import {useSettingsStore} from '../../stores/useSettingsStore';
import {useI18nStore} from '../../stores/useI18nStore';
import {translations} from '../../i18n/translations';
afterEach(cleanup);
beforeEach(()=>useSettingsStore.setState({autoSave:true,recoveryEnabled:true,showTranslationLines:false}));
for(const lang of ['ko','en','ja'] as const)it(`names all Store settings switches in ${lang}`,()=>{
 useI18nStore.setState({lang,t:translations[lang]});const {t}=useI18nStore.getState();render(<SettingsModal onClose={()=>{}}/>);
 expect(screen.getAllByRole('switch')).toHaveLength(6);
 for(const name of [t.settingsRecovery,t.settingsAutoSave,t.settingsElrcNotice,t.settingsGlyphMarkers,t.settingsSpellCheck,t.translationToggle])expect(screen.getByRole('switch',{name})).toBeTruthy();
});
it('restores the Store recovery opener after cancelling its privacy warning',async()=>{
 useI18nStore.setState({lang:'en',t:translations.en});const close=vi.fn();render(<SettingsModal onClose={close}/>);const user=userEvent.setup();const control=screen.getByRole('switch',{name:useI18nStore.getState().t.settingsRecovery});await user.click(control);
 expect(screen.getByRole('dialog',{name:useI18nStore.getState().t.settingsRecovery}).contains(document.activeElement)).toBe(true);expect(control.closest('[inert]')).not.toBeNull();await user.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();expect(useSettingsStore.getState().recoveryEnabled).toBe(true);expect(document.activeElement).toBe(control);
});
it('keeps Store settings open when cancelling the nested translation warning',async()=>{
 useI18nStore.setState({lang:'en',t:translations.en});const close=vi.fn();render(<SettingsModal onClose={close}/>);const user=userEvent.setup();const control=screen.getByRole('switch',{name:useI18nStore.getState().t.translationToggle});await user.click(control);await user.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();expect(useSettingsStore.getState().showTranslationLines).toBe(false);expect(document.activeElement).toBe(control);
});
