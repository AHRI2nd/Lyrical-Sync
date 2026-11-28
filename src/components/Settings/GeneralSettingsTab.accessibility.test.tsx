// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {GeneralSettingsTab} from './GeneralSettingsTab';
import {SettingsModal} from './SettingsModal';
import {useSettingsStore} from '../../stores/useSettingsStore';
import {useI18nStore} from '../../stores/useI18nStore';
afterEach(cleanup);
beforeEach(()=>useSettingsStore.setState({autoSave:true,showTranslationLines:false}));
it('preserves update check states and action', async()=>{
 useI18nStore.getState().setLang('en');const t=useI18nStore.getState().t;const check=vi.fn();
 const view=render(<GeneralSettingsTab checkState="idle" onCheckNow={check}/>);
 await userEvent.setup().click(screen.getByRole('button',{name:t.settingsCheckNow}));expect(check).toHaveBeenCalledTimes(1);
 view.rerender(<GeneralSettingsTab checkState="checking" onCheckNow={check}/>);
 expect(screen.getByRole('button',{name:t.settingsChecking}).hasAttribute('disabled')).toBe(true);
 view.rerender(<GeneralSettingsTab checkState="error" onCheckNow={check}/>);
 expect(screen.getByRole('alert').textContent).toBe(t.updater.errorTitle);
 view.rerender(<GeneralSettingsTab checkState="upToDate" onCheckNow={check}/>);
 expect(screen.getByText(t.settingsUpToDate)).toBeTruthy();
});
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
it('updates each range and resets the two scale settings',async()=>{
 useSettingsStore.setState({blankLineOffset:1,uiScale:1,lyricsFontScale:1});
 useI18nStore.getState().setLang('en');const t=useI18nStore.getState().t;render(<GeneralSettingsTab checkState="idle" onCheckNow={()=>{}}/>);
 fireEvent.change(screen.getByRole('slider',{name:t.aiSyncBlankOffset}),{target:{value:'2'}});
 fireEvent.change(screen.getByRole('slider',{name:t.settingsUiScale}),{target:{value:'1.15'}});
 fireEvent.change(screen.getByRole('slider',{name:t.settingsLyricsFontSize}),{target:{value:'1.2'}});
 expect(useSettingsStore.getState().blankLineOffset).toBe(2);
 expect(useSettingsStore.getState().uiScale).toBe(1.15);
 expect(useSettingsStore.getState().lyricsFontScale).toBe(1.2);
 const reset=screen.getAllByRole('button',{name:t.settingsUiScaleReset});
 await userEvent.setup().click(reset[0]);await userEvent.setup().click(reset[1]);
 expect(useSettingsStore.getState().uiScale).toBe(1);
 expect(useSettingsStore.getState().lyricsFontScale).toBe(1);
 useSettingsStore.setState({blankLineOffset:1});
});
it('keeps settings open when cancelling the nested translation warning',async()=>{
 useI18nStore.getState().setLang('en');const close=vi.fn();render(<SettingsModal onClose={close} onUpdateFound={()=>{}}/>);const user=userEvent.setup();const control=screen.getByRole('switch',{name:useI18nStore.getState().t.translationToggle});await user.click(control);
 const warning=screen.getByRole('dialog',{name:useI18nStore.getState().t.translationWarningTitle});expect(warning.contains(document.activeElement)).toBe(true);await user.keyboard('{Escape}');expect(close).not.toHaveBeenCalled();expect(screen.queryByRole('dialog',{name:useI18nStore.getState().t.translationWarningTitle})).toBeNull();expect(useSettingsStore.getState().showTranslationLines).toBe(false);expect(document.activeElement).toBe(control);
});
