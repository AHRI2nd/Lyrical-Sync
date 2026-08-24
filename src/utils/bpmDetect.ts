// BPM(박자) 감지 + 비트 그리드 스냅. autoSpot.ts와 같은 철학의 "80% 도구" —
// 실제 음악 전체 믹스에 대한 자기상관은 배박/절반박 오류가 흔해, 정밀 비트 트래킹
// 모델이 아니라 사용자가 결과를 확인(필요하면 탭 템포로 직접 보정)하는 것을 전제로 한다.

export interface BpmResult {
  bpm: number;
  /** 첫 비트(그리드 0번째 줄)의 절대 시각(초) */
  offsetSec: number;
  /** 자기상관 피크가 평균 대비 얼마나 두드러지는지(0~1) — 참고용, 결과를 막지 않음 */
  confidence: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;
const HOP_SEC = 0.02; // 20ms — autoSpot과 동일 해상도

/**
 * `samples`(모노, [-1,1], `sampleRate`)에서 온셋 강도 엔벨로프(프레임 간 에너지 증가분)의
 * 자기상관으로 박자 주기 후보를 찾고, 그 주기에서 온셋이 가장 몰리는 위상을 첫 비트
 * 시각으로 추정한다.
 */
export function detectBpm(samples: Float32Array | number[], sampleRate: number): BpmResult | null {
  if (!(sampleRate > 0) || samples.length === 0) return null;

  const hopSize = Math.max(1, Math.round(HOP_SEC * sampleRate));
  const frameCount = Math.floor(samples.length / hopSize);
  if (frameCount < 8) return null;

  // 프레임별 RMS 에너지
  const energy = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const lo = f * hopSize;
    const hi = lo + hopSize;
    let sumSquares = 0;
    for (let i = lo; i < hi; i++) sumSquares += samples[i] * samples[i];
    energy[f] = Math.sqrt(sumSquares / hopSize);
  }

  // 온셋 강도: 에너지 증가분만(half-wave rectified diff) — 타격/어택 지점을 강조
  const onset = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  }

  const lagMinFrames = Math.max(1, Math.round(60 / MAX_BPM / HOP_SEC));
  const lagMaxFrames = Math.min(frameCount - 1, Math.round(60 / MIN_BPM / HOP_SEC));
  if (lagMaxFrames <= lagMinFrames) return null;

  // 자기상관: 각 후보 lag(박자 주기)에서 온셋 엔벨로프의 상관값
  let bestLag = lagMinFrames;
  let bestScore = -Infinity;
  const scores = new Float32Array(lagMaxFrames - lagMinFrames + 1);
  for (let lag = lagMinFrames; lag <= lagMaxFrames; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < frameCount; i++) {
      sum += onset[i] * onset[i + lag];
      count++;
    }
    const score = count > 0 ? sum / count : 0;
    scores[lag - lagMinFrames] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestScore <= 0) return null; // 온셋이 사실상 없음(무음 등)

  const bpm = 60 / (bestLag * HOP_SEC);

  let meanScore = 0;
  for (let i = 0; i < scores.length; i++) meanScore += scores[i];
  meanScore /= scores.length || 1;
  const confidence = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - meanScore) / bestScore)) : 0;

  // 위상: [0, 주기) 구간 중 온셋 엔벨로프 합이 최대인 오프셋을 첫 비트로
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let phase = 0; phase < bestLag; phase++) {
    let sum = 0;
    for (let i = phase; i < frameCount; i += bestLag) sum += onset[i];
    if (sum > bestPhaseScore) {
      bestPhaseScore = sum;
      bestPhase = phase;
    }
  }
  const offsetSec = bestPhase * HOP_SEC;

  return {
    bpm: Math.round(bpm * 100) / 100,
    offsetSec: Math.round(offsetSec * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}

/** bpm/offsetSec으로 정의된 비트 그리드에서 t(초)와 가장 가까운 비트 시각(0 미만 클램프). */
export function nearestBeat(t: number, bpm: number, offsetSec: number): number {
  const period = 60 / bpm;
  if (!(period > 0)) return t;
  const n = Math.round((t - offsetSec) / period);
  return Math.max(0, Math.round((offsetSec + n * period) * 1000) / 1000);
}
