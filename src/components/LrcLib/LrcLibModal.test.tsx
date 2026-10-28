// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LrcLibModal } from './LrcLibModal';
import { useLrcStore } from '../../stores/useLrcStore';

const { lrclibSearch } = vi.hoisted(() => ({ lrclibSearch: vi.fn() }));
vi.mock('../../utils/lrclib', () => ({ lrclibSearch, sortByAccuracy: (results: unknown[]) => results }));
afterEach(cleanup);

it('ignores composing Enter and Escape keys', () => {
  const onClose = vi.fn();
  useLrcStore.getState().newLrc();
  render(<LrcLibModal onClose={onClose} />);
  const title = screen.getAllByRole('textbox')[0];

  fireEvent.change(title, { target: { value: 'Song' } });
  fireEvent.keyDown(title, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(window, { key: 'Escape', isComposing: true });

  expect(lrclibSearch).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
