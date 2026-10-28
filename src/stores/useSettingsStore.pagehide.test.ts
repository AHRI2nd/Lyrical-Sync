// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { installMemoryLocalStorage } from '../test/memoryLocalStorage';
import { useSettingsStore } from './useSettingsStore';

it('flushes pending settings synchronously when the page is hidden', () => {
  const { storage, restore } = installMemoryLocalStorage();
  const setItem = vi.spyOn(storage, 'setItem');
  vi.useFakeTimers();
  try {
    useSettingsStore.getState().setUiScale(1.24);
    expect(setItem).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(setItem).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getItem('lyrical-sync-settings') ?? '{}').state.uiScale).toBe(1.24);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    restore();
  }
});
