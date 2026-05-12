export type ModelCategory = "demucs" | "whisper" | "wav2vec2";

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
}

export const MODEL_DEFS: ModelDef[] = [
  // ── Demucs ──────────────────────────────────────────────────────────────────
  {
    id: "demucs-htdemucs",
    category: "demucs",
    name: "Demucs htdemucs",
    description: {
      ko: "보컬·드럼·베이스·기타를 분리합니다",
      en: "Separates vocals, drums, bass, and guitar",
      ja: "ボーカル・ドラム・ベース・ギターを分離します",
    },
    files: [
      {
        filename: "demucs/htdemucs.th",
        url: "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th",
      },
    ],
    totalSizeMb: 83,
  },

  // ── Whisper ─────────────────────────────────────────────────────────────────
  {
    id: "whisper-tiny",
    category: "whisper",
    name: "Whisper tiny",
    description: {
      ko: "가장 빠름, 정확도 낮음 · WhisperX 기본",
      en: "Fastest, lower accuracy · WhisperX default",
      ja: "最速・低精度 · WhisperXデフォルト",
    },
    files: [
      {
        filename: "whisper/tiny.pt",
        url: "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
      },
    ],
    totalSizeMb: 75,
  },
  {
    id: "whisper-base",
    category: "whisper",
    name: "Whisper base",
    description: {
      ko: "균형잡힌 속도와 정확도",
      en: "Balanced speed and accuracy",
      ja: "速度と精度のバランス",
    },
    files: [
      {
        filename: "whisper/base.pt",
        url: "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
      },
    ],
    totalSizeMb: 148,
  },
  {
    id: "whisper-small",
    category: "whisper",
    name: "Whisper small",
    description: {
      ko: "좋은 정확도, 적당한 속도",
      en: "Good accuracy, moderate speed",
      ja: "高精度・適度な速度",
    },
    files: [
      {
        filename: "whisper/small.pt",
        url: "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
      },
    ],
    totalSizeMb: 488,
  },

  // ── wav2vec2 ─────────────────────────────────────────────────────────────────
  {
    id: "wav2vec2-base-960h",
    category: "wav2vec2",
    name: "wav2vec2-base-960h",
    description: {
      ko: "단어 단위 타임스탬프 정렬 (WhisperX 사용)",
      en: "Word-level timestamp alignment used by WhisperX",
      ja: "WhisperXが使う単語レベルのタイムスタンプ整列",
    },
    files: [
      {
        filename: "wav2vec2/config.json",
        url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/config.json",
      },
      {
        filename: "wav2vec2/preprocessor_config.json",
        url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/preprocessor_config.json",
      },
      {
        filename: "wav2vec2/tokenizer_config.json",
        url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/tokenizer_config.json",
      },
      {
        filename: "wav2vec2/vocab.json",
        url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/vocab.json",
      },
      {
        filename: "wav2vec2/special_tokens_map.json",
        url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/special_tokens_map.json",
      },
      {
        filename: "wav2vec2/model.safetensors",
        url: "https://huggingface.co/facebook/wav2vec2-base-960h/resolve/main/model.safetensors",
      },
    ],
    totalSizeMb: 380,
  },
];

export const CATEGORY_ORDER: ModelCategory[] = ["demucs", "whisper", "wav2vec2"];
