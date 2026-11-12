import { create } from 'zustand';
import { type WaveformSource } from '../utils/waveformEnvelope';
import { createWaveformSourceFromSummary, type AudioWaveformSummary } from '../utils/audioWaveformSummary';

interface WaveformState {
  path: string | null;
  source: WaveformSource | null;
  preparing: boolean;
}
export const useWaveformStore = create<WaveformState>(() => ({ path: null, source: null, preparing: false }));

export function clearWaveform() {
  useWaveformStore.setState({ path: null, source: null, preparing: false });
}

export function beginWaveformPreparation(path: string) {
  useWaveformStore.setState({ path, source: null, preparing: true });
}

export function publishWaveformSummary(path: string, summary: AudioWaveformSummary) {
  useWaveformStore.setState({ path, source: createWaveformSourceFromSummary(summary), preparing: false });
}
