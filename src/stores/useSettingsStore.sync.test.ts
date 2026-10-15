import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
it('rejects invalid shared preferences and cannot restore serialized actions', async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({state:{ previewFontScale:99,previewActiveColor:'oops',previewAccentColor:'#ff00aa',showSpellCheck:'yes',setPreviewFontScale:'bad',spotifyMode:true }}), setItem:vi.fn(),removeItem:vi.fn() });
  const {useSettingsStore}=await import('./useSettingsStore'); const s=useSettingsStore.getState();
  expect(s.previewFontScale).toBe(1); expect(s.previewActiveColor).toBe('#ffffff'); expect(s.previewAccentColor).toBe('#ff00aa');
  expect(s.showSpellCheck).toBe(false); expect(typeof s.setPreviewFontScale).toBe('function'); expect(s.spotifyMode).toBe(true);
});
it('ignores invalid preview setters and survives blocked delayed storage', async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw Error('blocked');},removeItem:()=>{throw Error('blocked');}});
  const {useSettingsStore}=await import('./useSettingsStore'); const s=useSettingsStore.getState();
  s.setPreviewFontScale(Infinity); s.setPreviewActiveColor('garbage'); s.setShowSpellCheck('bad' as never);
  expect(useSettingsStore.getState().previewFontScale).toBe(1); expect(useSettingsStore.getState().showSpellCheck).toBe(false);
  s.setPreviewAccentColor('#aabbcc'); expect(()=>vi.runAllTimers()).not.toThrow(); expect(useSettingsStore.getState().previewAccentColor).toBe('#aabbcc');
});
