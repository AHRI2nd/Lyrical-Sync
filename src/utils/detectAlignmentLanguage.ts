/** Select one alignment language from the original lyric script. */
export function detectAlignmentLanguage(text: string): "eng" | "kor" | "jpn" {
  const normalized = text.normalize("NFKC");
  const hangul = (normalized.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g) ?? []).length;
  const kana = (normalized.match(/[\u3040-\u30ff\u31f0-\u31ff]/g) ?? []).length;
  const han = (normalized.match(/\p{Script=Han}/gu) ?? []).length;
  if (hangul > 0 && hangul >= kana + han) return "kor";
  if (kana + han > 0) return "jpn";
  return "eng";
}
