// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { formatLrcLibDuration, LrcLibModal } from './LrcLibModal';
import { useLrcStore } from '../../stores/useLrcStore';
import { useI18nStore } from '../../stores/useI18nStore';

const { lrclibSearch } = vi.hoisted(() => ({ lrclibSearch: vi.fn() }));
vi.mock('../../utils/lrclib', () => ({ lrclibSearch, sortByAccuracy: (results: unknown[]) => results }));
afterEach(cleanup);

it.each([
  [59.4, '0:59'],
  [59.8, '1:00'],
  [60, '1:00'],
  [3599.8, '60:00'],
  [Number.NaN, ''],
])('formats duration %s without a 60-second field', (seconds, expected) => {
  expect(formatLrcLibDuration(seconds)).toBe(expected);
});

it('ignores composing Enter and Escape keys', () => {
  const onClose = vi.fn();
  useLrcStore.getState().newLrc();
  render(<LrcLibModal onClose={onClose} />);
  const title = screen.getAllByRole('textbox')[0];

  fireEvent.change(title, { target: { value: 'Song' } });
  fireEvent.keyDown(title, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(title, { key: 'Escape', isComposing: true });

  expect(lrclibSearch).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('exposes labeled search fields and an isolated dialog', () => {
  const { t } = useI18nStore.getState();
  render(<LrcLibModal onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: t.lrclib.title })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: t.lrclib.fieldTitle })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: t.lrclib.fieldArtist })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: t.lrclib.fieldAlbum })).toBeTruthy();
});
