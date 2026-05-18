// AudioPlayer가 마운트될 때 등록하고 전역 키 핸들러에서 호출합니다
export const audioControls = {
  togglePlay: () => {},
  pause: () => {},
  skip: (_delta: number) => {},
  stopAndReset: () => {},
  seekTo: (_seconds: number) => {},
};
