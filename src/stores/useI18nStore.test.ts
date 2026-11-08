import { expect, it, vi } from 'vitest';
import { normalizeLang, useI18nStore } from './useI18nStore';

it('falls back to Korean for unsupported language values', () => {
  expect(normalizeLang('fr')).toBe('ko');
});

it.each(['ko', 'en', 'ja'] as const)('accepts supported language %s', (lang) => {
  expect(normalizeLang(lang)).toBe(lang);
});

it('keeps language selection functional when localStorage writes fail', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });

  expect(() => useI18nStore.getState().setLang('en')).not.toThrow();
  expect(useI18nStore.getState().lang).toBe('en');

  setItem.mockRestore();
  useI18nStore.getState().setLang('ko');
});

it('does not let persisted properties replace the language setter', async () => {
  localStorage.setItem('lyrical-sync-lang', JSON.stringify({
    state: { lang: 'en', setLang: 'not a function', t: { corrupted: true } },
    version: 0,
  }));

  await useI18nStore.persist.rehydrate();

  expect(useI18nStore.getState().lang).toBe('en');
  expect(typeof useI18nStore.getState().setLang).toBe('function');
  useI18nStore.getState().setLang('ja');
  expect(useI18nStore.getState().lang).toBe('ja');

  localStorage.removeItem('lyrical-sync-lang');
  useI18nStore.getState().setLang('ko');
});

it('falls back to Korean when the persisted language is unsupported', async () => {
  localStorage.setItem('lyrical-sync-lang', JSON.stringify({ state: { lang: 'fr' }, version: 0 }));

  await useI18nStore.persist.rehydrate();

  expect(useI18nStore.getState().lang).toBe('ko');
  expect(useI18nStore.getState().t).toBe((await import('../i18n/translations')).translations.ko);

  localStorage.removeItem('lyrical-sync-lang');
  useI18nStore.getState().setLang('ko');
});
