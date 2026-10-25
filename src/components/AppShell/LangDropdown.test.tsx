// @vitest-environment jsdom
import {afterEach,it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {LangDropdown} from './LangDropdown';
import {useI18nStore} from '../../stores/useI18nStore';
afterEach(cleanup);
it('names the language selector in each supported language',()=>{
 for(const [lang,label] of [['ko','언어 선택'],['en','Choose language'],['ja','言語を選択']] as const){
  useI18nStore.getState().setLang(lang);render(<LangDropdown/>);expect(screen.getByRole('button',{name:label})).toBeTruthy();cleanup();
 }
});
it('returns focus to the trigger when Escape closes the choices',async()=>{
 useI18nStore.getState().setLang('en');render(<LangDropdown/>);const user=userEvent.setup();const trigger=screen.getByRole('button');
 await user.click(trigger);const english=screen.getByRole('button',{name:/English/});english.focus();await user.keyboard('{Escape}');
 expect(screen.queryByRole('button',{name:/日本語/})).toBeNull();expect(document.activeElement).toBe(trigger);expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
it('keeps pointer selection and exposes the current language',async()=>{
 useI18nStore.getState().setLang('en');render(<LangDropdown/>);const user=userEvent.setup();await user.click(screen.getByRole('button'));
 expect(screen.getByRole('button',{name:/English/}).getAttribute('aria-pressed')).toBe('true');await user.click(screen.getByRole('button',{name:/日本語/}));
 expect(useI18nStore.getState().lang).toBe('ja');expect(screen.queryByRole('button',{name:/English/})).toBeNull();
});
