// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PythonEnvSection } from './PythonEnvSection';
import { useBusyStore } from '../../stores/useBusyStore';
import { useUpdaterStore } from '../../stores/useUpdaterStore';
import { useI18nStore } from '../../stores/useI18nStore';
import { UpdateModal } from '../Update/UpdateModal';
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ipc);
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
afterEach(cleanup);
beforeEach(() => { ipc.invoke.mockReset(); });
it('shows upgrade failures and allows retry while the old interpreter is incompatible', async () => {
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_python_env_info') return { pythonReady: false, packagesReady: false };
    throw new Error('Package install failed; previous environment retained');
  });
  render(<PythonEnvSection />);
  const download = await screen.findByRole('button', { name: /Python|AI/ });
  await act(async () => { fireEvent.click(download); });
  expect(screen.getByRole('alert').textContent).toContain('previous environment retained');
  expect(screen.getByRole('button', { name: /Python|AI/ }).hasAttribute('disabled')).toBe(false);
});

it('refreshes completed installation even without progress events', async () => {
  let ready = false;
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_python_env_info') return { pythonReady: ready, packagesReady: ready };
    ready = true;
  });
  const { container } = render(<PythonEnvSection />);
  const download = await screen.findByRole('button', { name: /Python|AI/ });
  await act(async () => { fireEvent.click(download); });
  expect(ipc.invoke).toHaveBeenCalledWith('download_embedded_python');
  expect(container.textContent).not.toContain('0%');
  expect(screen.queryByRole('button', { name: /Python|AI/ })).toBeNull();
});

it('keeps updater blocked by a Python download after the settings section unmounts', async () => {
  let resolveDownload!: () => void;
  const download = new Promise<void>((resolve) => { resolveDownload = resolve; });
  ipc.invoke.mockImplementation((command: string) => {
    if (command === 'get_python_env_info') return Promise.resolve({ pythonReady: false, packagesReady: false });
    if (command === 'download_embedded_python') return download;
    return Promise.resolve(undefined);
  });
  useBusyStore.setState({ reasons: new Set() });
  const settings = render(<PythonEnvSection />);
  const downloadButton = await screen.findByRole('button', { name: /Python|AI/ });
  await act(async () => { fireEvent.click(downloadButton); });
  expect(useBusyStore.getState().reasons.size).toBeGreaterThan(0);
  settings.unmount();

  useUpdaterStore.setState({ status: 'available', version: '0.7.1', body: 'notes' });
  const updater = render(<UpdateModal />);
  expect(updater.getByRole('button', { name: useI18nStore.getState().t.updater.update }).hasAttribute('disabled')).toBe(true);

  await act(async () => { resolveDownload(); await download; });
  expect(useBusyStore.getState().reasons.size).toBe(0);
});
