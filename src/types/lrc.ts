export interface LrcMetadata {
  title: string;
  artist: string;
  album: string;
  by: string;
  offset: number;
}

export interface LrcLine {
  id: string;
  timestamp: number | null; // seconds
  text: string;
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
