// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PythonEnvSection } from './PythonEnvSection';
import { useBusyStore } from '../../stores/useBusyStore';
import { useUpdaterStore } from '../../stores/useUpdaterStore';
import { useI18nStore } from '../../stores/useI18nStore';
import { UpdateModal } from '../Update/UpdateModal';
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), failListeners: false, pipHandler: null as null | ((event: { payload: { line: string; done: boolean; success: boolean } }) => void) }));
vi.mock('@tauri-apps/api/core', () => ipc);
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (event: string, handler: (event: { payload: { line: string; done: boolean; success: boolean } }) => void) => {
  if (ipc.failListeners) throw new Error('progress listener unavailable');
  if (event === 'pip-install-progress') ipc.pipHandler = handler;
  return () => {};
}) }));
afterEach(cleanup);
beforeEach(() => { ipc.invoke.mockReset(); ipc.failListeners = false; ipc.pipHandler = null; useBusyStore.setState({ reasons: new Set(), errors: {} }); });
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

it('does not report Python as absent or offer installation when readiness lookup fails', async () => {
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_python_env_info') throw new Error('AI environment is busy');
  });
  render(<PythonEnvSection />);

  const lookupError = await screen.findByRole('alert');
  expect(lookupError.textContent).toBe(useI18nStore.getState().t.settingsVenvCheckFailed);
  expect(screen.queryByText(useI18nStore.getState().t.settingsVenvNotCreated)).toBeNull();
  expect(screen.queryByRole('button', { name: useI18nStore.getState().t.settingsVenvCreate })).toBeNull();
});

it('recovers from a readiness lookup failure after refresh', async () => {
  let fail = true;
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command !== 'get_python_env_info') return;
    if (fail) throw new Error('temporary lookup failure');
    return { pythonReady: true, packagesReady: true, pipInstallCmd: '', pythonPath: '/python' };
  });
  render(<PythonEnvSection />);
  await screen.findByRole('alert');

  fail = false;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: useI18nStore.getState().t.settingsVenvRefresh }));
  });

  expect(await screen.findByText(useI18nStore.getState().t.settingsVenvReady)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('ignores an older readiness response after a newer refresh succeeds', async () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  };
  const older = deferred<{ pythonReady: boolean; packagesReady: boolean; pipInstallCmd: string; pythonPath: string }>();
  const newer = deferred<{ pythonReady: boolean; packagesReady: boolean; pipInstallCmd: string; pythonPath: string }>();
  let lookupCount = 0;
  ipc.invoke.mockImplementation((command: string) => {
    if (command !== 'get_python_env_info') return Promise.resolve(undefined);
    return ++lookupCount === 1 ? older.promise : newer.promise;
  });
  render(<PythonEnvSection />);
  await vi.waitFor(() => expect(lookupCount).toBe(1));

  act(() => useBusyStore.setState({ reasons: new Set(['python-packages']) }));
  act(() => useBusyStore.setState({ reasons: new Set() }));
  await vi.waitFor(() => expect(lookupCount).toBe(2));
  await act(async () => {
    newer.resolve({ pythonReady: true, packagesReady: true, pipInstallCmd: '', pythonPath: '/python' });
  });
  expect(await screen.findByText(useI18nStore.getState().t.settingsVenvReady)).toBeTruthy();

  await act(async () => {
    older.resolve({ pythonReady: false, packagesReady: false, pipInstallCmd: '', pythonPath: '' });
  });
  expect(screen.getByText(useI18nStore.getState().t.settingsVenvReady)).toBeTruthy();
  expect(screen.queryByRole('button', { name: useI18nStore.getState().t.settingsVenvCreate })).toBeNull();
});

it('reports missing progress updates without treating a running install as failed', async () => {
  ipc.failListeners = true;
  let resolveInstall!: () => void;
  const install = new Promise<void>((resolve) => { resolveInstall = resolve; });
  ipc.invoke.mockImplementation((command: string) => {
    if (command === 'get_python_env_info') return Promise.resolve({ pythonReady: true, packagesReady: false });
    if (command === 'install_python_packages') return install;
    return Promise.resolve(undefined);
  });
  render(<PythonEnvSection />);
  const installButton = await screen.findByRole('button', { name: useI18nStore.getState().t.settingsVenvInstallBtn });

  fireEvent.click(installButton);
  expect(await screen.findByText(useI18nStore.getState().t.settingsVenvProgressUnavailable)).toBeTruthy();
  expect(ipc.invoke).toHaveBeenCalledWith('install_python_packages');
  expect(screen.queryByRole('alert')).toBeNull();

  await act(async () => { resolveInstall(); await install; });
});

it('refreshes completed installation and settles busy state when progress listeners fail', async () => {
  ipc.failListeners = true;
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

it('retains an installation failure for the settings section after it unmounts', async () => {
  let rejectInstall!: (error: Error) => void;
  const install = new Promise<void>((_resolve, reject) => { rejectInstall = reject; });
  ipc.invoke.mockImplementation((command: string) => {
    if (command === 'get_python_env_info') return Promise.resolve({ pythonReady: true, packagesReady: false, pipInstallCmd: '', pythonPath: '/python' });
    if (command === 'install_python_packages') return install;
    return Promise.resolve(undefined);
  });
  const first = render(<PythonEnvSection />);
  const button = await screen.findByRole('button', { name: useI18nStore.getState().t.settingsVenvInstallBtn });
  fireEvent.click(button);
  await vi.waitFor(() => expect(useBusyStore.getState().reasons.has('python-packages')).toBe(true));
  first.unmount();

  await act(async () => { rejectInstall(new Error('Package installation failed')); await install.catch(() => {}); });
  expect(useBusyStore.getState().reasons.has('python-packages')).toBe(false);
  render(<PythonEnvSection />);

  expect((await screen.findByRole('alert')).textContent).toContain('Package installation failed');
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

it('keeps download state visible after the settings section remounts', async () => {
  let resolveDownload!: () => void;
  const download = new Promise<void>((resolve) => { resolveDownload = resolve; });
  ipc.invoke.mockImplementation((command: string) => {
    if (command === 'get_python_env_info') return Promise.resolve({ pythonReady: false, packagesReady: false });
    if (command === 'download_embedded_python') return download;
    return Promise.resolve(undefined);
  });
  const first = render(<PythonEnvSection />);
  const button = await screen.findByRole('button', { name: /Python|AI/ });
  fireEvent.click(button);
  await vi.waitFor(() => expect(useBusyStore.getState().reasons.has('python-download')).toBe(true));
  first.unmount();

  render(<PythonEnvSection />);
  const refreshButton = await screen.findByRole('button', { name: useI18nStore.getState().t.settingsVenvRefresh });
  expect(refreshButton.hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(useI18nStore.getState().t.settingsVenvCmdWarning)).toBeTruthy();

  await act(async () => { resolveDownload(); await download; });
  await vi.waitFor(() => expect(useBusyStore.getState().reasons.has('python-download')).toBe(false));
  await vi.waitFor(() => expect(ipc.invoke).toHaveBeenCalledTimes(3));
  const retryButton = await screen.findByRole('button', { name: useI18nStore.getState().t.settingsVenvCreate });
  expect(retryButton.hasAttribute('disabled')).toBe(false);
});

it('bounds retained package-install log lines while preserving the newest output', async () => {
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_python_env_info') return { pythonReady: true, packagesReady: false };
    return new Promise<void>(() => {});
  });
  render(<PythonEnvSection />);
  await vi.waitFor(() => expect(ipc.pipHandler).toBeTypeOf('function'));

  act(() => {
    for (let index = 0; index < 250; index += 1) {
      ipc.pipHandler?.({ payload: { line: `line-${index}`, done: false, success: false } });
    }
  });

  const log = document.querySelector('.h-32.overflow-y-auto');
  expect(log?.children.length).toBeLessThanOrEqual(200);
  expect(log?.textContent).toContain('line-249');
  expect(log?.textContent).not.toContain('line-0');
});
