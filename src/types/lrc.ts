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
  /** Original SRT cue end, retained so overlapping cue intervals survive import/export. */
  srtEndTime?: number;
  /** Bounded single-line SubRip cue settings, retained for same-format SRT saves. */
  srtCueSettings?: string;
  /** Source offsets of raw, supported SRT inline style tags; encoded literal tags are excluded. */
  srtInlineFormatting?: { start: number; end: number; tag: "b" | "i" | "u"; closing: boolean }[];
  text: string;
  // 존재하면 Enhanced LRC(글자/단어 동기화) 줄. 없으면 일반 줄 단위.
  syllables?: LrcSyllable[];
  // 2차(번역) 가사 줄. 표준 LRC엔 없는 개념 — lrcParser가 "같은 타임스탬프 + / 접두사"
  // 규약으로 직렬화/파싱한다 (parseLrc/serializeLrc 참고).
  translation?: string;
}

export interface LrcDocument {
  metadata: LrcMetadata;
  lines: LrcLine[];
  extraTags: Record<string, string>;
  /** Original ordinary metadata entries, only retained for repeated keys.
   * The last entry for a key reflects the editable metadata/extraTags value. */
  metadataTagSequence?: { key: string; value: string }[];
  /** Unsupported reserved control tags retained for display, not emitted as active controls. */
  invalidControlTags?: { key: string; value: string }[];
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
