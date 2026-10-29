// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { YtdlpSection } from './YtdlpSection';
import { useI18nStore } from '../../stores/useI18nStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import userEvent from '@testing-library/user-event';
import { useBusyStore } from '../../stores/useBusyStore';
import { useUpdaterStore } from '../../stores/useUpdaterStore';
import { UpdateModal } from '../Update/UpdateModal';

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset().mockResolvedValue(() => {});
  useSettingsStore.setState({ ytdlpAudioQuality: 'best' });
  useBusyStore.setState({ reasons: new Set() });
  useI18nStore.getState().setLang('ko');
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

it.each(['ko', 'en', 'ja'] as const)('localizes the checking state in %s', async (lang) => {
  useI18nStore.getState().setLang(lang);
  invoke.mockImplementation((command: string) => command === 'check_ytdlp' ? new Promise(() => {}) : Promise.resolve(undefined));
  render(<YtdlpSection />);
  expect(screen.getByText(useI18nStore.getState().t.ytdlpChecking)).toBeTruthy();
});

it('keeps an install failure visible after refreshing the installed version', async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'check_ytdlp') return null;
    if (command === 'download_ytdlp') throw new Error('network stalled');
    return undefined;
  });
  render(<YtdlpSection />);
  fireEvent.click(await screen.findByRole('button', { name: useI18nStore.getState().t.ytdlpDownload }));
  expect(await screen.findByText(/network stalled/)).toBeTruthy();
});

it('retains install ownership across remounts and blocks the updater', async () => {
  let resolveDownload!: () => void;
  const download = new Promise<void>((resolve) => { resolveDownload = resolve; });
  invoke.mockImplementation((command: string) => {
    if (command === 'check_ytdlp') return Promise.resolve(null);
    if (command === 'download_ytdlp') return download;
    return Promise.resolve(undefined);
  });
  const first = render(<YtdlpSection />);
  fireEvent.click(await screen.findByRole('button', { name: useI18nStore.getState().t.ytdlpDownload }));
  await vi.waitFor(() => expect(useBusyStore.getState().reasons.has('ytdlp-install')).toBe(true));
  first.unmount();
  render(<YtdlpSection />);
  useUpdaterStore.setState({ status: 'available', version: '0.7.1', body: 'notes' });
  const updaterButton = render(<UpdateModal />).getByRole('button', { name: useI18nStore.getState().t.updater.update });
  expect(updaterButton.hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: useI18nStore.getState().t.ytdlpDownload })).toBeNull();

  await act(async () => { resolveDownload(); await download; });
  await vi.waitFor(() => expect(useBusyStore.getState().reasons.has('ytdlp-install')).toBe(false));
});

it('does not show a failed-install alert for an acknowledged cancellation', async () => {
  let rejectDownload!: (error: Error) => void;
  let onProgress: ((event: { payload: { downloaded: number; total: number; done: boolean; error?: string } }) => void) | undefined;
  const download = new Promise<void>((_resolve, reject) => { rejectDownload = reject; });
  listen.mockImplementation(async (_event: string, handler: typeof onProgress) => {
    onProgress = handler;
    return () => {};
  });
  invoke.mockImplementation((command: string) => {
    if (command === 'check_ytdlp') return Promise.resolve(null);
    if (command === 'download_ytdlp') return download;
    return Promise.resolve(undefined);
  });
  render(<YtdlpSection />);
  fireEvent.click(await screen.findByRole('button', { name: useI18nStore.getState().t.ytdlpDownload }));
  await vi.waitFor(() => expect(onProgress).toBeTypeOf('function'));

  await act(async () => {
    onProgress?.({ payload: { downloaded: 0, total: 0, done: true, error: 'yt-dlp download failed: cancelled' } });
  });
  expect(screen.queryByRole('alert')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: useI18nStore.getState().t.ytdlpCancel }));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_ytdlp_install'));
  await act(async () => { rejectDownload(new Error('cancelled')); });
  await vi.waitFor(() => expect(useBusyStore.getState().reasons.has('ytdlp-install')).toBe(false));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('ignores an older latest-release response after a newer refresh', async () => {
  let resolveFirst!: (response: { ok: boolean; json: () => Promise<{ tag_name: string }> }) => void;
  let resolveSecond!: (response: { ok: boolean; json: () => Promise<{ tag_name: string }> }) => void;
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; })));
  invoke.mockImplementation(async (command: string) => command === 'check_ytdlp' ? 'v2' : undefined);
  render(<YtdlpSection />);
  await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'));

  const refreshButton = await screen.findByRole('button', { name: useI18nStore.getState().t.ytdlpRefresh });
  await vi.waitFor(() => expect(refreshButton.hasAttribute('disabled')).toBe(false));
  fireEvent.click(refreshButton);
  await vi.waitFor(() => expect(resolveSecond).toBeTypeOf('function'));
  await act(async () => {
    resolveSecond({ ok: true, json: async () => ({ tag_name: 'v2' }) });
  });
  await act(async () => {
    resolveFirst({ ok: true, json: async () => ({ tag_name: 'v1' }) });
  });

  expect(screen.queryByRole('button', { name: useI18nStore.getState().t.ytdlpUpdate })).toBeNull();
});
