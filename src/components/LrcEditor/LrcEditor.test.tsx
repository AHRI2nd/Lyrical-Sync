// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockRejectedValue(new Error("unavailable")) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { LrcEditor } from "./LrcEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { defaultDocument } from "../../types/lrc";
import { invoke } from "@tauri-apps/api/core";
import { useDeviceStore } from "../../stores/useDeviceStore";
beforeEach(() => {
  useSettingsStore.setState({ showTranslationLines: false, showSpellCheck: false });
  vi.stubGlobal("DragEvent", class extends MouseEvent {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: ["a", "b", "c", "d"].map((id) => ({ id, text: id, timestamp: null })) },
    syncMode: "line", activeLineId: "a", isDirty: false, _history: [], _future: [] });
});
afterEach(() => { cleanup(); delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("edits translation text without altering enhanced original timing and obeys spellcheck", () => {
  useSettingsStore.setState({ showTranslationLines: true, showSpellCheck: true });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", timestamp: 1,
    translation: "translated", syllables: [{ text: "original", time: 1 }] }] } });
  const { getByDisplayValue } = render(<LrcEditor onPreview={() => {}} />);
  const translation = getByDisplayValue("translated");
  expect(translation.getAttribute("spellcheck")).toBe("true");
  expect(getByDisplayValue("original").getAttribute("spellcheck")).toBe("true");
  fireEvent.change(translation, { target: { value: "new\ntranslation" } });
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "original", translation: "new\ntranslation", syllables: [{ text: "original", time: 1 }] });
  act(() => useSettingsStore.setState({ showTranslationLines: false }));
  expect(useLrcStore.getState().doc.lines[0].translation).toBe("new\ntranslation");
});
it("keeps imported multiline subtitle bodies intact while editing", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "first\nsecond", timestamp: 1 }] } });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const lyric = getByRole("textbox");
  expect(lyric.tagName).toBe("TEXTAREA");
  expect((lyric as HTMLTextAreaElement).value).toBe("first\nsecond");
  fireEvent.change(lyric, { target: { value: "first\nchanged" } });
  expect(useLrcStore.getState().doc.lines[0].text).toBe("first\nchanged");
});


it("asks for explicit translation parts when splitting and cancellation leaves the cue untouched", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", translation: "complete translation", timestamp: 1 }] } });
  const { getByDisplayValue, getByRole, getByText } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("original") as HTMLInputElement;
  input.setSelectionRange(3, 3);
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(getByText(t.translationSplitTitle)).toBeTruthy();
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect((getByRole("textbox", { name: t.translationFirstPart }) as HTMLTextAreaElement).value).toBe("complete translation");
  fireEvent.click(getByRole("button", { name: t.cancelLabel }));
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "original", translation: "complete translation" });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.change(getByRole("textbox", { name: t.translationFirstPart }), { target: { value: "first part" } });
  fireEvent.change(getByRole("textbox", { name: t.translationSecondPart }), { target: { value: "second part" } });
  fireEvent.click(getByRole("button", { name: t.translationSplitAction }));
  expect(useLrcStore.getState().doc.lines.map(l => [l.text, l.translation])).toEqual([["ori", "first part"], ["ginal", "second part"]]);
});


it("cancels a pending translation split when its document is replaced", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", translation: "translated", timestamp: 1 }] } });
  const { getByDisplayValue, queryByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.keyDown(getByDisplayValue("original"), { key: "Enter", shiftKey: true });
  act(() => useLrcStore.setState({ doc: defaultDocument(), _documentSession: useLrcStore.getState()._documentSession + 1 }));
  expect(queryByRole("dialog", { name: t.translationSplitTitle })).toBeNull();
  expect(useLrcStore.getState().doc.lines).toEqual([]);
});
it("keeps ordinary Enter available for multiline cue editing instead of inserting a lyric row", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "first\nsecond", timestamp: 1 }] } });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  expect(fireEvent.keyDown(getByRole("textbox"), { key: "Enter" })).toBe(true);
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
});

it.each([{ isComposing: true }, { keyCode: 229 }])("keeps IME Enter available without editing rows (%j)", (composition) => {
  const { getByDisplayValue } = render(<LrcEditor onPreview={() => {}} />);
  const original = structuredClone(useLrcStore.getState().doc.lines);
  fireEvent.keyDown(getByDisplayValue("a"), { key: "Enter", ...composition });
  fireEvent.keyDown(getByDisplayValue("a"), { key: "Enter", shiftKey: true, ...composition });
  expect(useLrcStore.getState().doc.lines).toEqual(original);
});
it("ignores an unchanged enhanced lyric value", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", timestamp: 1, syllables: [{ text: "original", time: 1 }] }] } });
  const { getByDisplayValue, queryByText } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("original") as HTMLInputElement;
  input.value = "uncommitted composition";
  fireEvent.change(input, { target: { value: "original" } });
  expect(queryByText(t.charSync.retokenizeTitle)).toBeNull();
  expect(useLrcStore.getState().doc.lines[0].syllables).toEqual([{ text: "original", time: 1 }]);
});
it("does not apply a pending retokenize confirmation to a replacement document with the same row ID", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", timestamp: 1,
    syllables: [{ text: "old lyric", time: 1 }] }] }, activeLineId: "a" });
  const { getByDisplayValue, getByText, getByRole, queryByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.change(getByDisplayValue("old lyric"), { target: { value: "pending old edit" } });
  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();
  const staleConfirmation = getByRole("button", { name: t.charSync.retokenizeOk });

  act(() => useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "a", text: "new document", timestamp: 2,
      syllables: [{ text: "new document", time: 2 }] }] },
    _documentSession: useLrcStore.getState()._documentSession + 1,
    activeLineId: "a",
  }));
  fireEvent.click(staleConfirmation);

  expect(queryByText(t.charSync.retokenizeTitle)).toBeNull();
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({
    text: "new document", syllables: [{ text: "new document", time: 2 }],
  });
});
it("does not apply a pending unit change to a replacement document with the same row ID", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", timestamp: 1,
    syllables: [{ text: "old lyric", time: 1 }] }] }, activeLineId: "a", syncMode: "line", syncUnit: "char" });
  const { getByRole, getByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.charSync.modeChar }));
  fireEvent.click(getByRole("button", { name: t.charSync.unitWord }));
  expect(getByText(t.charSync.unitChangeMsg)).toBeTruthy();
  const staleConfirmation = getByRole("button", { name: t.charSync.retokenizeOk });

  act(() => useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "a", text: "new document", timestamp: 2,
      syllables: [{ text: "new document", time: 2 }] }] },
    _documentSession: useLrcStore.getState()._documentSession + 1,
    activeLineId: "a",
  }));
  fireEvent.click(staleConfirmation);

  expect(useLrcStore.getState().syncUnit).toBe("char");
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({
    text: "new document", syllables: [{ text: "new document", time: 2 }],
  });
});
it("does not start AI sync from a glyph warning after the audio selection changes", async () => {
  const t = useI18nStore.getState().t;
  vi.mocked(invoke).mockImplementation((command: unknown) => {
    if (command === "get_python_env_info") return Promise.resolve({ packagesReady: true });
    if (command === "check_model_files") return Promise.resolve([true]);
    return Promise.resolve(undefined);
  });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "timed lyric", timestamp: 1,
    syllables: [{ text: "timed lyric", time: 1 }] }] }, activeLineId: "a", audioPath: "/tmp/old-audio.wav", syncMode: "line" });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const aiButton = await getByRole("button", { name: t.aiAutoSync });
  await vi.waitFor(() => expect(aiButton.hasAttribute("disabled")).toBe(false));
  fireEvent.click(aiButton);
  const staleConfirmation = getByRole("button", { name: t.aiSyncGlyphWarnOk });

  act(() => useLrcStore.getState().setAudioPath("/tmp/new-audio.wav"));
  fireEvent.click(staleConfirmation);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(invoke).not.toHaveBeenCalledWith("run_alignment", expect.anything());
});
it("ignores AI readiness results for a model directory that is no longer selected", async () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  };
  const envA = deferred<{ packagesReady: boolean }>();
  const filesA = deferred<boolean[]>();
  const envB = deferred<{ packagesReady: boolean }>();
  const filesB = deferred<boolean[]>();
  let envCalls = 0;
  let fileCalls = 0;
  vi.mocked(invoke).mockImplementation((command: unknown) => {
    if (command === "set_models_dir_override") return Promise.resolve(undefined);
    if (command === "get_python_env_info") return [envA.promise, envB.promise][envCalls++];
    if (command === "check_model_files") return [filesA.promise, filesB.promise][fileCalls++];
    return Promise.resolve(undefined);
  });
  useSettingsStore.setState({ modelsDir: "/models/A", deviceMode: false, spotifyMode: false });
  useLrcStore.setState({ audioPath: "/tmp/audio.wav" });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const aiButton = getByRole("button", { name: useI18nStore.getState().t.aiAutoSync });

  await vi.waitFor(() => expect(envCalls).toBe(1));
  await act(async () => { envA.resolve({ packagesReady: true }); await envA.promise; });
  await vi.waitFor(() => expect(fileCalls).toBe(1));
  act(() => useSettingsStore.setState({ modelsDir: "/models/B" }));
  await vi.waitFor(() => expect(envCalls).toBe(2));
  await act(async () => { envB.resolve({ packagesReady: true }); await envB.promise; });
  await vi.waitFor(() => expect(fileCalls).toBe(2));
  await act(async () => { filesB.resolve([true]); await filesB.promise; });
  await vi.waitFor(() => expect(aiButton.hasAttribute("disabled")).toBe(false));

  await act(async () => { filesA.resolve([false]); await filesA.promise; });
  expect(aiButton.hasAttribute("disabled")).toBe(false);
});
it("routes line seeking to the device controller when device mode is selected", () => {
  useSettingsStore.setState({ deviceMode: true, spotifyMode: false });
  useDeviceStore.setState({ hasSession: true, positionMs: 4321 });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "device lyric", timestamp: 1 }] } });
  const { container } = render(<LrcEditor onPreview={() => {}} />);
  expect(document.body.textContent).toContain("현재: 0:00:04.321");
  fireEvent.click(container.querySelector('[data-line-id="a"]')!);
  expect(invoke).toHaveBeenCalledWith("now_playing_seek", { positionMs: 1000 });
  expect(invoke).not.toHaveBeenCalledWith("seek_audio", expect.anything());
  expect(document.body.textContent).toContain("현재: 0:00:01.000");
});
it("asks before an individual find-and-replace clears timed glyphs", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", timestamp: 1,
    syllables: [{ text: "old lyric", time: 1 }] }] } });
  const { getByRole, getByPlaceholderText, getByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "old" } });
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "new" } });
  expect(getByText("1 / 1")).toBeTruthy();
  fireEvent.click(getByRole("button", { name: t.replaceBtn }));

  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({
    text: "old lyric", syllables: [{ text: "old lyric", time: 1 }],
  });
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "new lyric", syllables: undefined });
});
it("asks before multiline paste replaces timed glyphs and preserves the source on cancel", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", timestamp: 1,
    syllables: [{ text: "old lyric", time: 1 }] }] } });
  const { getByDisplayValue, getByText, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("old lyric") as HTMLTextAreaElement;
  input.setSelectionRange(0, input.value.length);
  fireEvent.paste(input, { clipboardData: { getData: () => "new\nrow" } });
  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "old lyric", syllables: [{ text: "old lyric", time: 1 }] });
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeCancel }));
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect(useLrcStore.getState().doc.lines[0].syllables).toEqual([{ text: "old lyric", time: 1 }]);
  fireEvent.paste(getByDisplayValue("old lyric"), { clipboardData: { getData: () => "new\nrow" } });
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["new", "row"]);
  expect(useLrcStore.getState()._history).toHaveLength(1);
  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect(useLrcStore.getState().doc.lines[0].syllables).toEqual([{ text: "old lyric", time: 1 }]);
});
it("asks before replace-all clears timed glyphs and treats identical replacement as a no-op", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", timestamp: 1,
    syllables: [{ text: "old lyric", time: 1 }] }] } });
  const { getByRole, getByPlaceholderText, getByText, queryByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "old" } });
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "old" } });
  fireEvent.click(getByRole("button", { name: t.replaceAll }));
  expect(queryByText(t.charSync.retokenizeTitle)).toBeNull();
  expect(useLrcStore.getState().doc.lines[0].syllables).toEqual([{ text: "old lyric", time: 1 }]);
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "new" } });
  fireEvent.click(getByRole("button", { name: t.replaceAll }));
  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();
  expect(useLrcStore.getState().doc.lines[0].text).toBe("old lyric");
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "new lyric", syllables: undefined });
  expect(useLrcStore.getState()._history).toHaveLength(1);
  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "old lyric", syllables: [{ text: "old lyric", time: 1 }] });
});
it("asks before merging timed glyph lines and leaves both intact until confirmed", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "first", timestamp: 1, syllables: [{ text: "first", time: 1 }] },
    { id: "b", text: "second", timestamp: 2, syllables: [{ text: "second", time: 2 }] },
  ] } });
  const { getByRole, getByText, getAllByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getAllByRole("button", { name: t.mergeLineUp })[1]);
  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();
  expect(useLrcStore.getState().doc.lines).toHaveLength(2);
  expect(useLrcStore.getState().doc.lines[1].syllables).toEqual([{ text: "second", time: 2 }]);
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "first second", syllables: undefined });
  expect(useLrcStore.getState()._history).toHaveLength(1);
});
it("rejects pending translation parts when the source has changed", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", translation: "translated", timestamp: 1 }] } });
  const { getByDisplayValue, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.keyDown(getByDisplayValue("original"), { key: "Enter", shiftKey: true });
  act(() => useLrcStore.getState().updateLine("a", { text: "changed" }));
  fireEvent.click(getByRole("button", { name: t.translationSplitAction }));
  expect(useLrcStore.getState().doc.lines.map(l => l.text)).toEqual(["changed"]);
});
it("cancels a translation split with Escape while preserving composition", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", translation: "translated", timestamp: 1 }] } });
  const { getByDisplayValue, queryByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.keyDown(getByDisplayValue("original"), { key: "Enter", shiftKey: true });
  fireEvent.keyDown(window, { key: "Escape", isComposing: true });
  expect(queryByRole("dialog", { name: t.translationSplitTitle })).not.toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(queryByRole("dialog", { name: t.translationSplitTitle })).toBeNull();
});
it("requires explicit parts for an empty translation and retains both empty strings", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "original", translation: "", timestamp: 1 }] } });
  const { getByDisplayValue, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("original") as HTMLInputElement;
  input.setSelectionRange(3, 3);
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect((getByRole("textbox", { name: t.translationFirstPart }) as HTMLTextAreaElement).value).toBe("");
  expect((getByRole("textbox", { name: t.translationSecondPart }) as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(getByRole("button", { name: t.translationSplitAction }));
  expect(useLrcStore.getState().doc.lines.map(line => [line.text, line.translation])).toEqual([["ori", ""], ["ginal", ""]]);
});

it.each([2.369, 3602.369, 2.36912345])("preserves timestamp %s and history when inline editing is left unchanged", (timestamp) => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "precise", timestamp }] }, _history: [], _future: [] });
  const original = useLrcStore.getState().doc;
  const { container, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const timestampButton = container.querySelector('[data-line-id="a"] .ls-line-time button')!;
  fireEvent.click(timestampButton);
  const input = container.querySelector('[data-line-id="a"] .ls-line-time input')!;
  fireEvent.blur(input);
  expect(useLrcStore.getState().doc).toBe(original);
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(timestamp);
  expect(useLrcStore.getState()._history).toHaveLength(0);
  expect(getByRole("textbox").getAttribute("value")).toBe("precise");
});

it("commits an hour-aware timestamp while composition and Escape preserve the original", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "precise", timestamp: 2.369 }] }, _history: [] });
  const { container, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: "0:00:02.369" }));
  let input = container.querySelector('.ls-line-time input')!;
  fireEvent.change(input, { target: { value: "1:00:02.369" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(2.369);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(2.369);
  fireEvent.click(getByRole("button", { name: "0:00:02.369" }));
  input = container.querySelector('.ls-line-time input')!;
  fireEvent.change(input, { target: { value: "1:00:02.369" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(3602.369);
  expect(useLrcStore.getState()._history).toHaveLength(1);
});

it.each([false,true])('keeps replacement dollar text literal in the editor (all=%s)', all => {
 const t=useI18nStore.getState().t;
 useLrcStore.setState({doc:{...defaultDocument(),lines:[{id:'a',text:'original original',timestamp:1}]}});
 const {getByPlaceholderText,getByRole}=render(<LrcEditor onPreview={()=>{}} />);
 fireEvent.keyDown(window,{code:'KeyF',ctrlKey:true});
 fireEvent.change(getByPlaceholderText(t.findPlaceholder),{target:{value:'original'}});
 fireEvent.change(getByPlaceholderText(t.replacePlaceholder),{target:{value:'$&'}});
 fireEvent.click(getByRole('button',{name:all?t.replaceAll:t.replaceBtn}));
 expect(useLrcStore.getState().doc.lines[0].text).toBe(all?'$& $&':'$& original');
});
it("does not carry bulk selection into a replacement document", () => {
  const t = useI18nStore.getState().t;
  const { container, queryByText } = render(<LrcEditor onPreview={() => {}} />);
  const oldRow = container.querySelector('[data-line-id="a"]');
  expect(oldRow).toBeTruthy();
  fireEvent.click(oldRow!, { ctrlKey: true });
  expect(queryByText(`1 ${t.bulkSelected}`)).toBeTruthy();
  act(() => useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "a", text: "replacement", timestamp: 2 }] },
    _documentSession: useLrcStore.getState()._documentSession + 1,
  }));
  expect(queryByText(`1 ${t.bulkSelected}`)).toBeNull();
  expect(useLrcStore.getState().doc.lines[0].text).toBe("replacement");
});

it("does not commit a timestamp draft into a replacement document with a reused row ID", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old", timestamp: null }] } });
  const { getByPlaceholderText, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: "-:--:--.---" }));
  const input = getByPlaceholderText("H:MM:SS.mmm");
  fireEvent.change(input, { target: { value: "0:00:12.000" } });
  act(() => useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [{ id: "a", text: "replacement", timestamp: 2 }] },
    _documentSession: useLrcStore.getState()._documentSession + 1,
  }));
  fireEvent.blur(input);
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "replacement", timestamp: 2 });
});
