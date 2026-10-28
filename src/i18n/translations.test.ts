import { expect, it } from 'vitest';
import { translations } from './translations';

it('keeps the supported language dictionaries in parity', () => {
  const expected = Object.keys(translations.ko).sort();
  expect(Object.keys(translations.en).sort()).toEqual(expected);
  expect(Object.keys(translations.ja).sort()).toEqual(expected);
});
