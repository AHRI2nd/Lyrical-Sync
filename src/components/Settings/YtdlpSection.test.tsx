// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { YtdlpSection } from './YtdlpSection';
import { useI18nStore } from '../../stores/useI18nStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import userEvent from '@testing-library/user-event';

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset().mockResolvedValue(() => {});
  useSettingsStore.setState({ ytdlpAudioQuality: 'best' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ tag_name: 'v1' }) })));
});
afterEach(cleanup);

it('finishes the download state when the progress done event is missing', async () => {
  invoke.mockImplementation(async (command: string) => command === 'check_ytdlp' ? null : undefined);
  render(<YtdlpSection />);
  const buttonName = useI18nStore.getState().t.ytdlpDownload;
  const button = await screen.findByRole('button', { name: buttonName });

  await act(async () => { fireEvent.click(button); });

  expect(await screen.findByRole('button', { name: buttonName })).toBeTruthy();
});

it('exposes audio quality as a keyboard-operable radio group', async () => {
  const user = userEvent.setup();
  const t = useI18nStore.getState().t;
  render(<YtdlpSection />);
  const best = await screen.findByRole('radio', { name: t.ytdlpQualityBest });
  const radios = screen.getAllByRole('radio');
  expect(radios).toHaveLength(3);
  expect(screen.getByRole('group', { name: t.ytdlpAudioQuality }).contains(best)).toBe(true);
  await user.click(best);
  await user.keyboard('{ArrowDown}');
  expect(useSettingsStore.getState().ytdlpAudioQuality).toBe('192');
});
