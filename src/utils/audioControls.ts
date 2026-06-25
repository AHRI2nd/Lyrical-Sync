// AudioPlayer가 마운트될 때 등록하고 전역 키 핸들러에서 호출합니다
export const audioControls = {
  togglePlay: () => {},
  pause: () => {},
  skip: (_delta: number) => {},
  stopAndReset: () => {},
  seekTo: (_seconds: number) => {},
  // 전체 트랙의 정규화 파형 peaks (없으면 null). 글자 동기화 레인 파형용.
  getPeaks: (): number[] | null => null,
};
