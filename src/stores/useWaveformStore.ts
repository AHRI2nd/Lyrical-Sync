import { create } from 'zustand';
import { createWaveformSource, type DecodedAudio, type WaveformSource } from '../utils/waveformEnvelope';

interface WaveformState {
  path: string | null;
  source: WaveformSource | null;
  preparing: boolean;
}
export const useWaveformStore = create<WaveformState>(() => ({ path: null, source: null, preparing: false }));
let preparation: AbortController | null = null;

export function clearWaveform() {
  preparation?.abort();
  preparation = null;
  useWaveformStore.setState({ path: null, source: null, preparing: false });
}

export async function prepareWaveform(path: string, buffer: DecodedAudio) {
  clearWaveform();
  const controller = new AbortController();
  preparation = controller;
  useWaveformStore.setState({ path, preparing: true });
  try {
    const source = await createWaveformSource(buffer, controller.signal);
    if (!controller.signal.aborted) useWaveformStore.setState({ source, preparing: false });
  } catch {
    if (!controller.signal.aborted) clearWaveform();
  } finally {
    if (preparation === controller) preparation = null;
  }
}
