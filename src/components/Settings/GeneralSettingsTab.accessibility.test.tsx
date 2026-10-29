// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {GeneralSettingsTab} from './GeneralSettingsTab';
import {SettingsModal} from './SettingsModal';
import {useSettingsStore} from '../../stores/useSettingsStore';
import {useI18nStore} from '../../stores/useI18nStore';
afterEach(cleanup);
beforeEach(()=>useSettingsStore.setState({autoSave:true,showTranslationLines:false}));
for(const lang of ['ko','en','ja'] as const)it(`names all six general switches in ${lang}`,()=>{
 useI18nStore.getState().setLang(lang);const {t}=useI18nStore.getState();render(<GeneralSettingsTab checkState="idle" onCheckNow={()=>{}}/>);
 expect(screen.getAllByRole('switch')).toHaveLength(6);
 for(const name of [t.settingsAutoUpdate,t.settingsAutoSave,t.settingsElrcNotice,t.settingsGlyphMarkers,t.settingsSpellCheck,t.translationToggle])expect(screen.getByRole('switch',{name})).toBeTruthy();
});
it('retains the named switch toggle behavior',async()=>{
 useI18nStore.getState().setLang('en');render(<GeneralSettingsTab checkState="idle" onCheckNow={()=>{}}/>);const control=screen.getByRole('switch',{name:'Auto-save'});await userEvent.setup().click(control);expect(control.getAttribute('aria-checked')).toBe('false');expect(useSettingsStore.getState().autoSave).toBe(false);
});
it('names each settings range control',()=>{
 useI18nStore.getState().setLang('en');const t=useI18nStore.getState().t;render(<GeneralSettingsTab checkState="idle" onCheckNow={()=>{}}/>);
 expect(screen.getByRole('slider',{name:t.aiSyncBlankOffset})).toBeTruthy();
 expect(screen.getByRole('slider',{name:t.settingsUiScale})).toBeTruthy();
 expect(screen.getByRole('slider',{name:t.settingsLyricsFontSize})).toBeTruthy();
});
it('keeps settings open when cancelling the nested translation warning',async()=>{
 useI18nStore.getState().setLang('en');const close=vi.fn();render(<SettingsModal onClose={close} onUpdateFound={()=>{}}/>);const user=userEvent.setup();const control=screen.getByRole('switch',{name:useI18nStore.getState().t.translationToggle});await user.click(control);
 const warning=screen.getByRole('dialog',{name:useI18nStore.getState().t.translationWarningTitle});expect(warning.contains(document.activeElement)).toBe(true);await user.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();expect(screen.queryByRole('dialog',{name:useI18nStore.getState().t.translationWarningTitle})).toBeNull();expect(useSettingsStore.getState().showTranslationLines).toBe(false);expect(document.activeElement).toBe(control);
});
