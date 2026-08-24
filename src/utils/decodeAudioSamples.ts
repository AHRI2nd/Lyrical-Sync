import { readAudioBytes } from "./readAudioBytes";

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
    // 채널 평균으로 모노화
    const samples = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) samples[i] += data[i] / channels;
    }
    return { samples, sampleRate };
  } finally {
    ctx.close();
  }
}
