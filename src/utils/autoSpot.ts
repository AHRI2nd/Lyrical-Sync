// 무음 기반 자동 스팟팅: 발화로 보이는 구간마다 빈 타임스탬프 줄을 깔아, 처음부터
// 타이밍을 잡을 때 빈 그리드가 아니라 "여기서 누가 말하기 시작한다"에서 출발하게 함.
//
// 음성 인식(VAD 모델)이 아니라 짧은 구간 RMS 에너지를 임계값과 비교하는 것뿐이다.
// 모델도, 발화/음악/소음 구분도 없다. 의도적으로 "80% 도구": "여기서 소리가 나는가"를
// 싸고 예측 가능하게 잡아내고, 실제 가사 입력은 사람이 검토하며 채운다. 시끄러운
// 룸톤이나 음악 스팅에 대한 오탐은 두 번 클릭으로 지우면 되는 구간이고, 속삭이는
// 대사를 놓치는 것도 더 정교한 모델을 써도 임계값 튜닝이 필요한 건 마찬가지다.

export interface SpeechSegment {
  start: number;
  end: number;
}

/**
 * `samples`(모노, [-1, 1], `sampleRate`)에서 로컬 에너지가 `minSpeechSec` 이상
 * `thresholdDb`를 넘는 구간을 찾는다. `minSilenceSec`보다 짧은 무음 간격은 같은
 * 구간(숨쉬기나 문장 중간의 짧은 멈춤)으로 취급해 병합한다. 각 구간은 양끝에
 * `paddingSec`만큼 여유를 두되(리드인/리드아웃 한 박자), 이웃 구간을 침범하지 않는다.
 */
export function detectSpeechSegments(
  samples: Float32Array | number[],
  sampleRate: number,
  thresholdDb = -35,
  minSilenceSec = 0.3,
  minSpeechSec = 0.3,
  paddingSec = 0.1
): SpeechSegment[] {
  if (!(sampleRate > 0) || samples.length === 0) return [];

  const windowSec = 0.02; // 20ms 분석 윈도우 — 단어 시작을 놓치지 않을 만큼 짧게
  const windowSize = Math.max(1, Math.round(windowSec * sampleRate));
  const windowCount = Math.ceil(samples.length / windowSize);

  const active: boolean[] = new Array(windowCount).fill(false);
  for (let w = 0; w < windowCount; w++) {
    const lo = w * windowSize;
    const hi = Math.min(samples.length, lo + windowSize);
    if (hi <= lo) continue;
    let sumSquares = 0;
    for (let i = lo; i < hi; i++) sumSquares += samples[i] * samples[i];
    const rms = Math.sqrt(sumSquares / (hi - lo));
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    active[w] = db >= thresholdDb;
  }

  // 원시 활성 구간(윈도우 단위)
  const runs: { start: number; end: number }[] = [];
  let runStart: number | null = null;
  for (let w = 0; w < windowCount; w++) {
    if (active[w]) {
      if (runStart === null) runStart = w;
    } else if (runStart !== null) {
      runs.push({ start: runStart, end: w });
      runStart = null;
    }
  }
  if (runStart !== null) runs.push({ start: runStart, end: windowCount });
  if (runs.length === 0) return [];

  // minSilenceSec보다 짧은 간격으로 떨어진 구간은 병합
  const minSilenceWindows = Math.round(minSilenceSec / windowSec);
  const merged: { start: number; end: number }[] = [{ ...runs[0] }];
  for (let i = 1; i < runs.length; i++) {
    const run = runs[i];
    const last = merged[merged.length - 1];
    if (run.start - last.end <= minSilenceWindows) {
      last.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }

  // 너무 짧아 실제 대사로 보기 어려운 구간 제거, 초 단위로 변환 후 패딩 적용
  const inSeconds = merged
    .map((r) => ({ start: r.start * windowSec, end: r.end * windowSec }))
    .filter((s) => s.end - s.start >= minSpeechSec);
  const duration = samples.length / sampleRate;

  // 한 구간의 끝 패딩과 다음 구간의 시작 패딩은 같은 간격을 두고 경쟁한다.
  // 각 변을 먼 쪽 경계까지 독립적으로 클램프하는 대신 간격을 반으로 나눠 적용하면,
  // 요청한 패딩이 간격 전체보다 커도 두 패딩이 서로를 침범하지 않음을 보장한다.
  return inSeconds.map((seg, i) => {
    const prevEnd = i > 0 ? inSeconds[i - 1].end : 0;
    const nextStart = i + 1 < inSeconds.length ? inSeconds[i + 1].start : duration;
    const backHalf = Math.max(0, (seg.start - prevEnd) / 2);
    const fwdHalf = Math.max(0, (nextStart - seg.end) / 2);
    const start = Math.max(0, seg.start - Math.min(paddingSec, backHalf));
    const end = Math.min(duration, seg.end + Math.min(paddingSec, fwdHalf));
    return { start, end };
  });
}
