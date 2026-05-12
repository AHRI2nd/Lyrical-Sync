export type ModelCategory = "demucs" | "wav2vec2";

export interface ModelFile {
  filename: string; // models 디렉터리 내 상대 경로
  url: string;
}

export interface ModelDef {
  id: string;
  category: ModelCategory;
  name: string;
  description: { ko: string; en: string; ja: string };
  files: ModelFile[];
  totalSizeMb: number;
  required: boolean;
}

export const MODEL_DEFS: ModelDef[] = [
  // ── Demucs ──────────────────────────────────────────────────────────────────
  {
    id: "demucs-htdemucs",
    category: "demucs",
    name: "Demucs htdemucs",
    description: {
      ko: "전사 전 보컬을 분리해 인식 정확도를 높입니다",
      en: "Isolates vocals before transcription for better accuracy",
      ja: "文字起こし前にボーカルを分離して精度を向上させます",
    },
    files: [
      {
        filename: "demucs/htdemucs.th",
        url: "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th",
      },
    ],
    totalSizeMb: 83,
    required: false,
  },

  // ── wav2vec2 ─────────────────────────────────────────────────────────────────
  {
    id: "wav2vec2-base-960h",
    category: "wav2vec2",
    name: "wav2vec2-base-960h",
    description: {
      ko: "단어 단위 타임스탬프 정렬 — LRC 싱크의 핵심",
      en: "Word-level timestamp alignment — core of LRC sync",
      ja: "単語レベルのタイムスタンプ整列 — LRCシンクの核心",
    },
    files: [
      { filename: "wav2vec2/config.json", url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/config.json" },
      { filename: "wav2vec2/preprocessor_config.json", url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/preprocessor_config.json" },
      { filename: "wav2vec2/tokenizer_config.json", url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/tokenizer_config.json" },
      { filename: "wav2vec2/vocab.json", url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/vocab.json" },
      { filename: "wav2vec2/special_tokens_map.json", url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/special_tokens_map.json" },
      { filename: "wav2vec2/model.safetensors", url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/model.safetensors" },
    ],
    totalSizeMb: 380,
    required: true,
  },
];

export const CATEGORY_ORDER: ModelCategory[] = ["demucs", "wav2vec2"];

export function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb} MB`;
}
