// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { YtdlpSection } from './YtdlpSection';
import { useI18nStore } from '../../stores/useI18nStore';

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset().mockResolvedValue(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ tag_name: 'v1' }) })));
});

it('finishes the download state when the progress done event is missing', async () => {
  invoke.mockImplementation(async (command: string) => command === 'check_ytdlp' ? null : undefined);
  render(<YtdlpSection />);
  const buttonName = useI18nStore.getState().t.ytdlpDownload;
  const button = await screen.findByRole('button', { name: buttonName });

  await act(async () => { fireEvent.click(button); });

  expect(await screen.findByRole('button', { name: buttonName })).toBeTruthy();
});
