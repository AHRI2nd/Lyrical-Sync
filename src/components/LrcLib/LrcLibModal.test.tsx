// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { formatLrcLibDuration, LrcLibModal } from './LrcLibModal';
import { useLrcStore } from '../../stores/useLrcStore';
import { useI18nStore } from '../../stores/useI18nStore';

const { lrclibSearch } = vi.hoisted(() => ({ lrclibSearch: vi.fn() }));
vi.mock('../../utils/lrclib', () => ({ lrclibSearch, sortByAccuracy: (results: unknown[]) => results }));
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

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

it('removes old LRCLIB results while a new search is pending', async () => {
  const t = useI18nStore.getState().t;
  const oldResult = {
    id: 1, trackName: 'Old Song', artistName: 'Old Artist', albumName: 'Old Album',
    duration: 120, instrumental: false, syncedLyrics: '[00:01.00]old', plainLyrics: null,
  };
  const next = deferred<typeof oldResult[]>();
  lrclibSearch.mockReset().mockResolvedValueOnce([oldResult]).mockReturnValueOnce(next.promise);
  useLrcStore.getState().newLrc();
  render(<LrcLibModal onClose={() => {}} />);
  const title = screen.getByRole('textbox', { name: t.lrclib.fieldTitle });
  const search = screen.getByRole('button', { name: t.lrclib.search });

  fireEvent.change(title, { target: { value: 'Old Song' } });
  fireEvent.click(search);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText('Old Song')).toBeTruthy();

  fireEvent.change(title, { target: { value: 'New Song' } });
  fireEvent.click(screen.getByRole('button', { name: t.lrclib.search }));
  expect(screen.queryByText('Old Song')).toBeNull();
  expect(screen.getAllByText(t.lrclib.searching)).toHaveLength(2);

  await act(async () => { next.resolve([]); await next.promise; });
});
