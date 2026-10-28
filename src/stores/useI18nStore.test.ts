import { expect, it } from 'vitest';
import { normalizeLang } from './useI18nStore';

it('falls back to Korean for unsupported language values', () => {
  expect(normalizeLang('fr')).toBe('ko');
});

it.each(['ko', 'en', 'ja'] as const)('accepts supported language %s', (lang) => {
  expect(normalizeLang(lang)).toBe(lang);
});
