import { expect, it } from "vitest";
import { MODEL_DEFS } from "./modelDefs";
import koGuide from "../../etc/AI_Installation_guide.ko.md?raw";
import enGuide from "../../etc/AI_Installation_guide.en.md?raw";
import jaGuide from "../../etc/AI_Installation_guide.ja.md?raw";

const guides = [koGuide, enGuide, jaGuide];

it("keeps every AI installation guide aligned with the available model inventory", () => {
  for (const content of guides) {
    for (const model of MODEL_DEFS) expect(content).toContain(model.id);
    expect(content).not.toContain("wav2vec2-base-960h");
  }
});

it("distinguishes model language capability from the languages users can select", () => {
  for (const content of guides) {
    expect(content).toMatch(/Auto|자동|自動/);
    expect(content).not.toMatch(/ISO 639-3|1,100\+ other languages supported|1,100개 언어 지원/);
  }
});

it("describes the current one-click alignment flow and conditional confirmation", () => {
  for (const content of guides) {
    expect(content).not.toMatch(/Click \*\*Run\*\*|\*\*「実行」\*\*/);
    expect(content).toMatch(/timestamps|시간|タイムスタンプ/);
    expect(content).toMatch(/confirm before .*cleared|확인 창.*표시|削除前に確認/);
    const languageStep = content.match(/^\d+\. .*?(?:Choose Auto|언어 목록에서 자동|言語一覧から自動).*$/m)?.index;
    const actionStep = content.match(/^\d+\. .*?(?:Click \*\*"AI Auto-Sync"\*\*|AI 자동 싱크.*클릭|AI自動同期.*クリック).*$/m)?.index;
    expect(languageStep).toBeDefined();
    expect(actionStep).toBeDefined();
    expect(actionStep).toBeGreaterThan(languageStep!);
  }
});

it("does not claim unsupported automatic quarantine removal or prescribe removing it", () => {
  for (const content of guides) {
    expect(content).not.toMatch(/automatically removes the quarantine|자동으로 quarantine 속성을 제거|quarantine属性を削除/);
    expect(content).not.toContain("xattr -rd com.apple.quarantine");
  }
});
