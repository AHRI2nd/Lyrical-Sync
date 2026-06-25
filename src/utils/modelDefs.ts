export type ModelCategory = "demucs" | "wav2vec2" | "ctc";

export interface ModelFile {
  filename: string; // models 디렉터리 내 상대 경로
  url: string;
  /** 선택적 SHA-256 (소문자 hex). 지정 시 다운로드 후 무결성 검증. 미지정이면 검증 생략. */
  sha256?: string;
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

  // ── CTC Forced Aligner ───────────────────────────────────────────────────────
  {
    id: "ctc-mms-300m",
    category: "ctc",
    name: "MMS-300M (1130 languages)",
    description: {
      ko: "1130개 언어를 지원하는 다국어 강제 정렬 모델 — 한국어·영어·일본어 포함",
      en: "Multilingual forced alignment model supporting 1130 languages — incl. Korean, English, Japanese",
      ja: "1130言語対応の多言語強制アライメントモデル — 日本語・英語・韓国語含む",
    },
    files: [
      { filename: "ctc-forced-aligner/config.json", url: "https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner/resolve/main/config.json" },
      { filename: "ctc-forced-aligner/preprocessor_config.json", url: "https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner/resolve/main/preprocessor_config.json" },
      { filename: "ctc-forced-aligner/tokenizer_config.json", url: "https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner/resolve/main/tokenizer_config.json" },
      { filename: "ctc-forced-aligner/vocab.json", url: "https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner/resolve/main/vocab.json" },
      { filename: "ctc-forced-aligner/special_tokens_map.json", url: "https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner/resolve/main/special_tokens_map.json" },
      { filename: "ctc-forced-aligner/model.safetensors", url: "https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner/resolve/main/model.safetensors" },
    ],
    totalSizeMb: 1204,
    required: true,
  },

  // ── wav2vec2 ─────────────────────────────────────────────────────────────────
  {
    id: "wav2vec2-base-960h",
    category: "wav2vec2",
    name: "wav2vec2-base-960h",
    description: {
      ko: "영어 전용 ASR 모델 — 영어 가사의 정렬 정확도를 높입니다 (선택)",
      en: "English-only ASR model — improves alignment accuracy for English lyrics (optional)",
      ja: "英語専用ASRモデル — 英語歌詞のアライメント精度を向上させます（任意）",
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
    required: false,
  },
];

export const CATEGORY_ORDER: ModelCategory[] = ["demucs", "ctc", "wav2vec2"];

export function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}
