// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PythonEnvSection } from './PythonEnvSection';
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
