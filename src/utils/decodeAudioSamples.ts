import { readAudioBytes } from "./readAudioBytes";

// 한 번에 처리할 샘플 수 — 이 단위로 끊어서 메인 스레드에 제어권을 양보한다.
const MIXDOWN_CHUNK_SIZE = 200_000;

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// 자동 스팟팅(RMS 에너지 분석)용 원본 PCM 샘플 추출. Wavesurfer의 exportPeaks()는
// 픽셀당 min/max로 다운샘플된 값이라 20ms 윈도우 RMS 계산엔 정밀도가 부족해 별도 디코드.
export async function decodeAudioSamples(audioPath: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const { bytes } = await readAudioBytes(audioPath);
  const ctx = new AudioContext();
  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channels = audioBuffer.numberOfChannels;
    const { length, sampleRate } = audioBuffer;
    const channelData: Float32Array[] = [];
    for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c));

    // 채널 평균으로 모노화 — 긴 트랙(수백만 샘플)을 한 번에 돌리면 메인 스레드가
    // 오래 멈추므로, 청크 단위로 끊어 매 청크 후 이벤트 루프에 제어권을 양보한다.
    const samples = new Float32Array(length);
    for (let start = 0; start < length; start += MIXDOWN_CHUNK_SIZE) {
      const end = Math.min(start + MIXDOWN_CHUNK_SIZE, length);
      for (let c = 0; c < channels; c++) {
        const data = channelData[c];
        for (let i = start; i < end; i++) samples[i] += data[i] / channels;
      }
      if (end < length) await yieldToMainThread();
    }
    return { samples, sampleRate };
  } finally {
    ctx.close();
  }
}
