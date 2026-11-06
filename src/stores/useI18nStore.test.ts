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
