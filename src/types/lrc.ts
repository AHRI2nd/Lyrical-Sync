export interface LrcMetadata {
  title: string;
  artist: string;
  album: string;
  by: string;
  offset: number;
}

// Enhanced LRC(A2) 단어/글자 단위 토큰. text를 모두 이으면 줄 텍스트가 된다.
// time=null = 아직 찍지 않음. 공백 토큰은 isStampable=false 로 스탬프 대상에서 제외.
export interface LrcSyllable {
  text: string;
  time: number | null; // seconds
}

export interface LrcLine {
  id: string;
  timestamp: number | null; // seconds
  text: string;
  // 존재하면 Enhanced LRC(글자/단어 동기화) 줄. 없으면 일반 줄 단위.
  syllables?: LrcSyllable[];
}

export interface LrcDocument {
  metadata: LrcMetadata;
  lines: LrcLine[];
  extraTags: Record<string, string>;
}

export const defaultMetadata = (): LrcMetadata => ({
  title: "",
  artist: "",
  album: "",
  by: "",
  offset: 0,
});

export const defaultDocument = (): LrcDocument => ({
  metadata: defaultMetadata(),
  lines: [],
  extraTags: {},
});
