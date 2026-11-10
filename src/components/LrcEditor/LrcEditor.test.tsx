// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockRejectedValue(new Error("unavailable")) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { LrcEditor, resolveAlignmentLanguage } from "./LrcEditor";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { defaultDocument } from "../../types/lrc";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../../stores/useDeviceStore";
import { useBusyStore } from "../../stores/useBusyStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { serviceControls } from "../../utils/serviceControls";
import { deviceControls } from "../../utils/deviceControls";
beforeEach(() => {
  useSettingsStore.setState({ showTranslationLines: false, showSpellCheck: false });
  vi.stubGlobal("DragEvent", class extends MouseEvent {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: ["a", "b", "c", "d"].map((id) => ({ id, text: id, timestamp: null })) },
    syncMode: "line", activeLineId: "a", isDirty: false, _history: [], _future: [], _lastEditKey: null });
});
afterEach(() => { cleanup(); delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps AI alignment language independent from the UI language when explicitly selected", () => {
  expect(resolveAlignmentLanguage("auto", "ko")).toBe("kor");
  expect(resolveAlignmentLanguage("auto", "ja")).toBe("jpn");
  expect(resolveAlignmentLanguage("eng", "ko")).toBe("eng");
  expect(resolveAlignmentLanguage("kor", "en")).toBe("kor");
});
it("resets the time shift range and delta when the document is replaced", () => {
  const t = useI18nStore.getState().t;
  const { getByRole, getAllByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.timeShift }));
  let numberInputs = getAllByRole("spinbutton") as HTMLInputElement[];
  fireEvent.change(numberInputs[0], { target: { value: "3" } });
  fireEvent.change(numberInputs[2], { target: { value: "1.5" } });

  act(() => useLrcStore.setState({
    doc: { ...defaultDocument(), lines: [
      { id: "new-a", text: "new a", timestamp: null },
      { id: "new-b", text: "new b", timestamp: null },
    ] },
    activeLineId: "new-b",
    _documentSession: useLrcStore.getState()._documentSession + 1,
  }));

  numberInputs = getAllByRole("spinbutton") as HTMLInputElement[];
  expect(numberInputs[0].value).toBe("2");
  expect(numberInputs[1].value).toBe("2");
  expect(numberInputs[2].value).toBe("0");
});
it("resets the time shift range when its selected rows are deleted", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "first", timestamp: 1 },
    { id: "b", text: "second", timestamp: 3 },
    { id: "c", text: "third", timestamp: 5 },
  ] }, activeLineId: "c" });
  const { container, getByRole, getAllByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.timeShift }));
  let numberInputs = getAllByRole("spinbutton") as HTMLInputElement[];
  fireEvent.change(numberInputs[0], { target: { value: "3" } });
  fireEvent.change(numberInputs[1], { target: { value: "3" } });
  fireEvent.change(numberInputs[2], { target: { value: "1" } });

  const selectedRow = container.querySelector('[data-line-id="c"]');
  fireEvent.click(selectedRow!.querySelector(`button[aria-label="${t.deleteLine}"]`)!);

  numberInputs = getAllByRole("spinbutton") as HTMLInputElement[];
  expect(numberInputs.map(({ value }) => value)).toEqual(["1", "2", "0"]);
});
it("starts a new undo group when editing resumes after focus leaves the editor", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "a", timestamp: null }] } });
  const { getByDisplayValue } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("a");

  fireEvent.change(input, { target: { value: "ab" } });
  fireEvent.focusOut(input);
  fireEvent.change(input, { target: { value: "abc" } });

  expect(useLrcStore.getState()._history).toHaveLength(2);
  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState().doc.lines[0].text).toBe("ab");
});
it("removes an individually deleted row from bulk selection", () => {
  const t = useI18nStore.getState().t;
  const { container, queryByText } = render(<LrcEditor onPreview={() => {}} />);
  const row = container.querySelector('[data-line-id="a"]');
  expect(row).not.toBeNull();
  fireEvent.click(row!, { ctrlKey: true });
  expect(queryByText(`1 ${t.bulkSelected}`)).toBeTruthy();

  fireEvent.click(row!.querySelector(`button[aria-label="${t.deleteLine}"]`)!);
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["b", "c", "d"]);
  expect(queryByText(`1 ${t.bulkSelected}`)).toBeNull();
});
it.each(["en", "ja"] as const)("shows Korean sidecar package errors in the selected %s UI language", (lang) => {
  useI18nStore.getState().setLang(lang);
  useLrcStore.setState({ aiSyncStatus: "error", aiSyncProgressStatus: "error", aiSyncMessage: "패키지 임포트 실패: /private/user/path" });
  const { getByText, queryByText } = render(<LrcEditor onPreview={() => {}} />);
  expect(getByText(useI18nStore.getState().t.aiSyncErrorPackages)).toBeTruthy();
  expect(queryByText(/패키지 임포트 실패/)).toBeNull();
  act(() => useI18nStore.getState().setLang("ko"));
});

it.each(["en", "ja"] as const)("localizes sidecar error progress before the command rejection in %s", (lang) => {
  useI18nStore.getState().setLang(lang);
  useLrcStore.setState({
    aiSyncStatus: "running",
    aiSyncProgressStatus: "error",
    aiSyncMessage: "AI_SYNC_ERROR:audio_too_short",
  });
  const { getByText, queryByText } = render(<LrcEditor onPreview={() => {}} />);
  expect(getByText(useI18nStore.getState().t.aiSyncErrorAudioTooShort)).toBeTruthy();
  expect(queryByText(/AI_SYNC_ERROR|오디오가 CTC/)).toBeNull();
  act(() => useI18nStore.getState().setLang("ko"));
});

it("lets the user choose the AI language separately from the interface language", () => {
  const { getByLabelText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.change(getByLabelText(useI18nStore.getState().t.aiLanguageLabel), { target: { value: "jpn" } });
  expect(useSettingsStore.getState().aiAlignmentLanguage).toBe("jpn");
});
it.each(["spotify", "device"] as const)("explains File and YouTube support while AI is disabled in %s mode", (mode) => {
  useSettingsStore.setState({ spotifyMode: mode === "spotify", deviceMode: mode === "device" });
  useLrcStore.setState({ aiSyncStatus: "idle", aiSyncProgressStatus: "idle" });
  try {
    const t = useI18nStore.getState().t;
    const { getByRole, getByText } = render(<LrcEditor onPreview={() => {}} />);
    expect(getByRole("button", { name: t.aiAutoSync }).hasAttribute("disabled")).toBe(true);
    expect(getByText(t.aiSyncModeUnsupported)).toBeTruthy();
    expect(t.aiSyncModeUnsupported).toContain("YouTube");
  } finally {
    cleanup();
    act(() => useSettingsStore.setState({ spotifyMode: false, deviceMode: false }));
  }
});
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

it("keeps carriage-return-only lyrics editable and focused when they become single-line", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "first\rsecond", timestamp: 1 }] } });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const textarea = getByRole("textbox") as HTMLTextAreaElement;
  expect(textarea.tagName).toBe("TEXTAREA");

  textarea.focus();
  fireEvent.change(textarea, { target: { value: "single line" } });

  const input = getByRole("textbox");
  expect(input.tagName).toBe("INPUT");
  expect(document.activeElement).toBe(input);
  expect(useLrcStore.getState().doc.lines[0].text).toBe("single line");
});

it("keeps focus when removing the final newline from a lyric", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "first\nsecond", timestamp: 1 }] } });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const textarea = getByRole("textbox") as HTMLTextAreaElement;
  textarea.focus();
  fireEvent.change(textarea, { target: { value: "first second" } });

  const input = getByRole("textbox");
  expect(input.tagName).toBe("INPUT");
  expect(document.activeElement).toBe(input);
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

it("does not split a translated line when undo restores glyph timing while the dialog is open", () => {
  const t = useI18nStore.getState().t;
  const syllables = [{ text: "original", time: 1 }];
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{
    id: "a", text: "original", translation: "translated", timestamp: 1, syllables,
  }] } });
  const { getByDisplayValue, getByRole } = render(<LrcEditor onPreview={() => {}} />);

  act(() => useLrcStore.getState().clearLineSyllables("a"));
  fireEvent.keyDown(getByDisplayValue("original"), { key: "Enter", shiftKey: true });
  expect(getByRole("dialog", { name: t.translationSplitTitle })).toBeTruthy();
  act(() => useLrcStore.getState().undo());

  fireEvent.change(getByRole("textbox", { name: t.translationFirstPart }), { target: { value: "first" } });
  fireEvent.change(getByRole("textbox", { name: t.translationSecondPart }), { target: { value: "second" } });
  fireEvent.click(getByRole("button", { name: t.translationSplitAction }));

  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({
    id: "a", text: "original", translation: "translated", syllables,
  });
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
it("does not let an older AI readiness failure disable a newer successful check", async () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  };
  const envA = deferred<{ packagesReady: boolean }>();
  const envB = deferred<{ packagesReady: boolean }>();
  let envCalls = 0;
  let modelChecks = 0;
  vi.mocked(invoke).mockImplementation((command: unknown) => {
    if (command === "set_models_dir_override") return Promise.resolve(undefined);
    if (command === "get_python_env_info") return [envA.promise, envB.promise][envCalls++];
    if (command === "get_models_dir") return Promise.resolve("/models/B");
    if (command === "check_model_files") {
      modelChecks += 1;
      return Promise.resolve([true]);
    }
    return Promise.resolve(undefined);
  });
  useSettingsStore.setState({ modelsDir: "/models/A", deviceMode: false, spotifyMode: false });
  useLrcStore.setState({ audioPath: "/tmp/audio.wav" });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const aiButton = getByRole("button", { name: useI18nStore.getState().t.aiAutoSync });

  await vi.waitFor(() => expect(envCalls).toBe(1));
  act(() => useSettingsStore.setState({ modelsDir: "/models/B" }));
  await vi.waitFor(() => expect(envCalls).toBe(2));
  await act(async () => { envB.resolve({ packagesReady: true }); await envB.promise; });
  await vi.waitFor(() => expect(modelChecks).toBeGreaterThan(0));
  await vi.waitFor(() => expect(aiButton.hasAttribute("disabled")).toBe(false));

  await act(async () => { envA.reject(new Error("stale readiness failure")); await envA.promise.catch(() => {}); });
  expect(aiButton.hasAttribute("disabled")).toBe(false);
});
it("rechecks AI readiness after the package installer releases its environment lease", async () => {
  let pipHandler: ((event: { payload: { done: boolean } }) => void) | undefined;
  let readinessCalls = 0;
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    if (event === "pip-install-progress") {
      pipHandler = handler as (event: { payload: { done: boolean } }) => void;
    }
    return () => {};
  });
  vi.mocked(invoke).mockImplementation((command: unknown) => {
    if (command === "set_models_dir_override") return Promise.resolve(undefined);
    if (command === "get_python_env_info") {
      readinessCalls += 1;
      const busy = [...useBusyStore.getState().reasons].some((reason) => reason === "python-download" || reason === "python-packages");
      return busy
        ? Promise.reject(new Error("AI environment is busy"))
        : Promise.resolve({ packagesReady: true });
    }
    if (command === "get_models_dir") return Promise.resolve("/models/default");
    if (command === "check_model_files") return Promise.resolve([true]);
    return Promise.resolve(undefined);
  });
  useSettingsStore.setState({ modelsDir: "", deviceMode: false, spotifyMode: false });
  useLrcStore.setState({ audioPath: "/tmp/audio.wav" });
  const { getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const aiButton = getByRole("button", { name: useI18nStore.getState().t.aiAutoSync });
  await vi.waitFor(() => expect(aiButton.hasAttribute("disabled")).toBe(false));
  await vi.waitFor(() => expect(typeof pipHandler).toBe("function"));

  act(() => useBusyStore.getState().markBusy("python-packages"));
  await vi.waitFor(() => expect(aiButton.hasAttribute("disabled")).toBe(true));
  act(() => pipHandler?.({ payload: { done: true } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  act(() => useBusyStore.getState().clearBusy("python-packages"));

  await vi.waitFor(() => expect(readinessCalls).toBe(2));
  await vi.waitFor(() => expect(aiButton.hasAttribute("disabled")).toBe(false));
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
it("updates a memoized row seek handler when switching from Spotify to device playback", () => {
  const serviceSeek = vi.spyOn(serviceControls, "seekTo").mockImplementation(() => {});
  const deviceSeek = vi.spyOn(deviceControls, "seekTo").mockImplementation(() => {});
  useServiceStore.setState({ isLoggedIn: true });
  useSettingsStore.setState({ spotifyMode: true, deviceMode: false });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "lyric", timestamp: 1 }] } });
  const { container } = render(<LrcEditor onPreview={() => {}} />);
  const row = container.querySelector('[data-line-id="a"]')!;

  fireEvent.click(row);
  expect(serviceSeek).toHaveBeenCalledWith(1);
  act(() => useSettingsStore.setState({ spotifyMode: false, deviceMode: true }));
  fireEvent.click(row);

  expect(deviceSeek).toHaveBeenCalledWith(1);
  expect(serviceSeek).toHaveBeenCalledTimes(1);
});
it("clears the previous local line repeat when seeking to another lyric row", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "first", timestamp: 1 },
    { id: "b", text: "next", timestamp: 2 },
  ] }, audioPath: "/music/song.mp3", loopLineId: "a" });
  const { container } = render(<LrcEditor onPreview={() => {}} />);

  fireEvent.click(container.querySelector('[data-line-id="b"]')!);

  expect(useLrcStore.getState().loopLineId).toBeNull();
});
it("continues to the next matching row after replacing the current row", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "needle one", timestamp: null },
    { id: "b", text: "needle two", timestamp: null },
    { id: "c", text: "needle three", timestamp: null },
  ] } });
  const { getByRole, getByPlaceholderText, getByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "needle" } });
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "changed" } });
  expect(getByText("1 / 3")).toBeTruthy();

  fireEvent.click(getByRole("button", { name: t.replaceBtn }));

  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual([
    "changed one", "needle two", "needle three",
  ]);
  expect(getByText("1 / 2")).toBeTruthy();
});

it("counts and navigates each occurrence within and across lyric rows", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "x x x", timestamp: null },
    { id: "b", text: "x", timestamp: null },
  ] } });
  const { getByRole, getByPlaceholderText, getByText, container } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "x" } });

  expect(getByText("1 / 4")).toBeTruthy();
  const first = container.querySelector<HTMLInputElement>('[data-line-id="a"] .ls-lyric-input')!;
  expect([first.selectionStart, first.selectionEnd]).toEqual([0, 1]);

  fireEvent.click(getByRole("button", { name: `${t.findNext} (Enter)` }));
  expect(getByText("2 / 4")).toBeTruthy();
  expect([first.selectionStart, first.selectionEnd]).toEqual([2, 3]);

  fireEvent.click(getByRole("button", { name: `${t.findNext} (Enter)` }));
  expect(getByText("3 / 4")).toBeTruthy();
  expect([first.selectionStart, first.selectionEnd]).toEqual([4, 5]);

  fireEvent.click(getByRole("button", { name: `${t.findNext} (Enter)` }));
  expect(getByText("4 / 4")).toBeTruthy();
  const last = container.querySelector<HTMLInputElement>('[data-line-id="b"] .ls-lyric-input')!;
  expect([last.selectionStart, last.selectionEnd]).toEqual([0, 1]);

  fireEvent.click(getByRole("button", { name: `${t.findNext} (Enter)` }));
  expect(getByText("1 / 4")).toBeTruthy();
});

it("replaces only the selected occurrence and advances to the next original match", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "x x x", timestamp: null }] } });
  const { getByRole, getByPlaceholderText, getByText, container } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "x" } });
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "yy" } });
  fireEvent.click(getByRole("button", { name: t.replaceBtn }));

  expect(useLrcStore.getState().doc.lines[0].text).toBe("yy x x");
  expect(getByText("1 / 2")).toBeTruthy();
  const input = container.querySelector<HTMLInputElement>('[data-line-id="a"] .ls-lyric-input')!;
  expect([input.selectionStart, input.selectionEnd]).toEqual([3, 4]);
});

it("keeps replace-all occurrence-wide and reports no matches for an empty query", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "x x", timestamp: null },
    { id: "b", text: "x", timestamp: null },
  ] } });
  const { getByRole, getByPlaceholderText, getByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  const findInput = getByPlaceholderText(t.findPlaceholder);
  fireEvent.change(findInput, { target: { value: "x" } });
  expect(getByText("1 / 3")).toBeTruthy();
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "z" } });
  fireEvent.click(getByRole("button", { name: t.replaceAll }));

  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["z z", "z"]);
  expect(getByText(t.noMatches)).toBeTruthy();
  fireEvent.change(findInput, { target: { value: "" } });
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["z z", "z"]);
});

it("uses the same Unicode case-folding for find and replacement", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "İstanbul", timestamp: null }] } });
  const { getByRole, getByPlaceholderText, getByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "i" } });
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "x" } });

  expect(getByText(t.noMatches)).toBeTruthy();
  expect(useLrcStore.getState().doc.lines[0].text).toBe("İstanbul");
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
it("does not expand a pending replace-all to rows added while glyph confirmation is open", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "needle old", timestamp: 1, syllables: [{ text: "needle old", time: 1 }] },
    { id: "b", text: "other row", timestamp: 2 },
  ] } });
  const { getByRole, getByPlaceholderText, getByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "needle" } });
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "changed" } });
  fireEvent.click(getByRole("button", { name: t.replaceAll }));
  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();

  useLrcStore.getState().updateLine("b", { text: "needle new" });
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));

  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({ text: "needle old", syllables: [{ text: "needle old", time: 1 }] });
  expect(useLrcStore.getState().doc.lines[1].text).toBe("needle new");
});

it("does not apply replace-all after undo changes the affected rows", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "old first", timestamp: 1, syllables: [{ text: "old first", time: 1 }] },
    { id: "b", text: "old second", timestamp: 2, syllables: [{ text: "old second", time: 2 }] },
  ] } });
  useLrcStore.getState().updateLine("b", { text: "different" });
  const revisionBeforeUndo = useLrcStore.getState()._editRevision;
  const { getByRole, getByPlaceholderText, getByText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "old" } });
  fireEvent.change(getByPlaceholderText(t.replacePlaceholder), { target: { value: "new" } });
  fireEvent.click(getByRole("button", { name: t.replaceAll }));
  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();

  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState()._editRevision).toBeGreaterThan(revisionBeforeUndo);
  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["old first", "old second"]);
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));

  expect(useLrcStore.getState().doc.lines.map((line) => line.text)).toEqual(["old first", "old second"]);
  expect(useLrcStore.getState().doc.lines[1].syllables).toEqual([{ text: "old second", time: 2 }]);
});

it("edits a translation for each pasted line and applies all rows as one undo action", () => {
  const t = useI18nStore.getState().t;
  useSettingsStore.setState({ showTranslationLines: true });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", translation: "old translation", timestamp: 1 }] } });
  const { getByDisplayValue, getByRole, getAllByRole } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("old lyric") as HTMLInputElement;
  input.setSelectionRange(4, 4);
  fireEvent.paste(input, { clipboardData: { getData: () => "new first\nnew second" } });
  expect(getByRole("dialog", { name: t.translationPasteTitle })).toBeTruthy();
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect((getByRole("textbox", { name: `${t.translationPasteLine} 1: old new first` }) as HTMLTextAreaElement).value).toBe("old translation");
  const pasteTranslationInputs = getAllByRole("textbox").filter((element) => element.tagName === "TEXTAREA");
  fireEvent.change(pasteTranslationInputs[pasteTranslationInputs.length - 2], { target: { value: "first translation" } });
  fireEvent.change(pasteTranslationInputs[pasteTranslationInputs.length - 1], { target: { value: "second translation" } });
  fireEvent.click(getByRole("button", { name: t.translationPasteApply }));

  expect(useLrcStore.getState().doc.lines.map((line) => [line.text, line.translation, line.timestamp])).toEqual([
    ["old new first", "first translation", 1], ["new secondlyric", "second translation", null],
  ]);
  expect(useLrcStore.getState()._history).toHaveLength(1);
  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState().doc.lines).toEqual([{ id: "a", text: "old lyric", translation: "old translation", timestamp: 1 }]);
});

it("cancels multiline paste translation editing without changing the source row", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", translation: "old translation", timestamp: 1 }] } });
  const { getByDisplayValue, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("old lyric") as HTMLInputElement;
  input.setSelectionRange(0, input.value.length);
  fireEvent.paste(input, { clipboardData: { getData: () => "new first\nnew second" } });
  fireEvent.click(getByRole("button", { name: t.cancelLabel }));
  expect(useLrcStore.getState().doc.lines).toEqual([{ id: "a", text: "old lyric", translation: "old translation", timestamp: 1 }]);
  expect(useLrcStore.getState()._history).toHaveLength(0);
});

it("confirms glyph clearing before opening translated-paste editors", () => {
  const t = useI18nStore.getState().t;
  useSettingsStore.setState({ showTranslationLines: true });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{
    id: "a", text: "old lyric", translation: "old translation", timestamp: 1,
    syllables: [{ text: "old lyric", time: 1 }],
  }] } });
  const { getByDisplayValue, getByRole, getByText } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("old lyric") as HTMLTextAreaElement;
  input.setSelectionRange(0, input.value.length);
  fireEvent.paste(input, { clipboardData: { getData: () => "new first\nnew second" } });
  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();
  expect(useLrcStore.getState().doc.lines[0].syllables).toEqual([{ text: "old lyric", time: 1 }]);
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));
  expect(getByRole("dialog", { name: t.translationPasteTitle })).toBeTruthy();
  fireEvent.click(getByRole("button", { name: t.translationPasteApply }));
  expect(useLrcStore.getState().doc.lines.map((line) => [line.text, line.translation, line.syllables])).toEqual([
    ["new first", "old translation", undefined], ["new second", "", undefined],
  ]);
  act(() => useLrcStore.getState().undo());
  expect(useLrcStore.getState().doc.lines[0]).toMatchObject({
    text: "old lyric", translation: "old translation", syllables: [{ text: "old lyric", time: 1 }],
  });
});

it("does not apply pending translated paste after the source document changes", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", translation: "old translation", timestamp: 1 }] } });
  const { getByDisplayValue, getByRole } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("old lyric") as HTMLInputElement;
  input.setSelectionRange(0, input.value.length);
  fireEvent.paste(input, { clipboardData: { getData: () => "new first\nnew second" } });
  act(() => useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "replacement", translation: "other", timestamp: 2 }] }, _editRevision: useLrcStore.getState()._editRevision + 1 }));
  fireEvent.click(getByRole("button", { name: t.translationPasteApply }));
  expect(useLrcStore.getState().doc.lines).toEqual([{ id: "a", text: "replacement", translation: "other", timestamp: 2 }]);
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
it("does not merge a different line pair if adjacency changes while confirmation is open", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [
    { id: "a", text: "first", timestamp: 1, syllables: [{ text: "first", time: 1 }] },
    { id: "b", text: "second", timestamp: 2, syllables: [{ text: "second", time: 2 }] },
  ] } });
  const { getByRole, getAllByRole } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getAllByRole("button", { name: t.mergeLineUp })[1]);
  act(() => useLrcStore.setState({ doc: { ...useLrcStore.getState().doc, lines: [
    useLrcStore.getState().doc.lines[0],
    { id: "middle", text: "inserted", timestamp: 1.5 },
    useLrcStore.getState().doc.lines[1],
  ] } }));
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));
  expect(useLrcStore.getState().doc.lines.map((line) => line.id)).toEqual(["a", "middle", "b"]);
});

it("asks before splitting a timed glyph line and preserves it when cancelled", () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{
    id: "a", text: "original", timestamp: 1, syllables: [{ text: "original", time: 1 }],
  }] } });
  const { getByDisplayValue, getByRole, getByText } = render(<LrcEditor onPreview={() => {}} />);
  const input = getByDisplayValue("original") as HTMLInputElement;
  input.setSelectionRange(3, 3);
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(getByText(t.charSync.retokenizeTitle)).toBeTruthy();
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeCancel }));
  expect(useLrcStore.getState().doc.lines).toHaveLength(1);
  expect(useLrcStore.getState().doc.lines[0].syllables).toEqual([{ text: "original", time: 1 }]);
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.click(getByRole("button", { name: t.charSync.retokenizeOk }));
  expect(useLrcStore.getState().doc.lines).toHaveLength(2);
  expect(useLrcStore.getState().doc.lines.every((line) => line.syllables === undefined)).toBe(true);
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
  const dialog = queryByRole("dialog", { name: t.translationSplitTitle })!;
  const textarea = dialog.querySelector("textarea")!;
  fireEvent.keyDown(textarea, { key: "Escape", isComposing: true });
  expect(queryByRole("dialog", { name: t.translationSplitTitle })).not.toBeNull();
  fireEvent.keyDown(textarea, { key: "Escape" });
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

it.each([
  { ctrlKey: true, metaKey: false, shortcut: "Ctrl+F" },
  { ctrlKey: false, metaKey: true, shortcut: "Cmd+F" },
])("does not open Find or steal focus from an active dialog with $shortcut", async ({ ctrlKey, metaKey }) => {
  const t = useI18nStore.getState().t;
  useSettingsStore.setState({ showTranslationLines: true });
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "old lyric", translation: "old translation", timestamp: 1 }] } });
  const { getByDisplayValue, getByRole, queryByPlaceholderText } = render(<LrcEditor onPreview={() => {}} />);
  const lyricInput = getByDisplayValue("old lyric") as HTMLTextAreaElement;
  lyricInput.setSelectionRange(0, lyricInput.value.length);
  fireEvent.paste(lyricInput, { clipboardData: { getData: () => "new first\nnew second" } });

  const dialog = getByRole("dialog", { name: t.translationPasteTitle });
  const translationInput = dialog.querySelector("textarea")!;
  translationInput.focus();
  expect(dialog.contains(document.activeElement)).toBe(true);

  fireEvent.keyDown(window, { code: "KeyF", key: "f", ctrlKey, metaKey });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(queryByPlaceholderText(t.findPlaceholder)).toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(true);
});

it.each([
  { ctrlKey: true, metaKey: false },
  { ctrlKey: false, metaKey: true },
])("opens Find with Ctrl/Cmd+F when no dialog is active", async ({ ctrlKey, metaKey }) => {
  const t = useI18nStore.getState().t;
  const { getByPlaceholderText } = render(<LrcEditor onPreview={() => {}} />);

  fireEvent.keyDown(window, { code: "KeyF", key: "f", ctrlKey, metaKey });

  const findInput = getByPlaceholderText(t.findPlaceholder);
  await waitFor(() => expect(document.activeElement).toBe(findInput));
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
it("does not restore a stale timestamp draft over a newer same-document value", () => {
  useLrcStore.setState({ doc: { ...defaultDocument(), lines: [{ id: "a", text: "lyric", timestamp: 1 }] } });
  const { getByRole, getByPlaceholderText } = render(<LrcEditor onPreview={() => {}} />);
  fireEvent.click(getByRole("button", { name: "0:00:01.000" }));
  const input = getByPlaceholderText("H:MM:SS.mmm");

  act(() => useLrcStore.getState().updateLine("a", { timestamp: 3 }));
  fireEvent.blur(input);

  expect(useLrcStore.getState().doc.lines[0].timestamp).toBe(3);
});

it("does not describe a failed model inventory check as a missing model", async () => {
  const t = useI18nStore.getState().t;
  useSettingsStore.setState({ modelsDir: "", deviceMode: false, spotifyMode: false });
  useBusyStore.setState({ reasons: new Set() });
  vi.mocked(invoke).mockImplementation((command: unknown) => {
    if (command === "get_python_env_info") return Promise.resolve({ packagesReady: true });
    if (command === "get_models_dir") return Promise.resolve("/models");
    if (command === "check_model_files") return Promise.reject(new Error("access denied"));
    return Promise.resolve(undefined);
  });
  useLrcStore.setState({ audioPath: "/tmp/audio.wav" });
  const { findByText, getByRole, queryByText } = render(<LrcEditor onPreview={() => {}} />);

  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("check_model_files", expect.anything()));
  await findByText(t.aiSyncModelInventoryError);
  expect(queryByText(t.aiSyncNoModel)).toBeNull();
  expect(getByRole("button", { name: t.aiAutoSync }).hasAttribute("disabled")).toBe(true);
});

it("retries a failed model inventory check from the editor", async () => {
  const t = useI18nStore.getState().t;
  useSettingsStore.setState({ modelsDir: "", deviceMode: false, spotifyMode: false });
  useBusyStore.setState({ reasons: new Set() });
  let checks = 0;
  vi.mocked(invoke).mockImplementation((command: unknown) => {
    if (command === "get_python_env_info") return Promise.resolve({ packagesReady: true });
    if (command === "get_models_dir") return Promise.resolve("/models");
    if (command === "check_model_files") {
      checks += 1;
      return checks < 3 ? Promise.reject(new Error("access denied")) : Promise.resolve([true]);
    }
    return Promise.resolve(undefined);
  });
  useLrcStore.setState({ audioPath: "/tmp/audio.wav" });
  const { findByText, getByRole, queryByText } = render(<LrcEditor onPreview={() => {}} />);

  await findByText(t.aiSyncModelInventoryError);
  fireEvent.click(getByRole("button", { name: t.aiSyncRetryModelCheck }));
  await vi.waitFor(() => expect(getByRole("button", { name: t.aiSyncRetryModelCheck }).hasAttribute("disabled")).toBe(false));
  expect(queryByText(t.aiSyncModelInventoryError)).toBeTruthy();

  fireEvent.click(getByRole("button", { name: t.aiSyncRetryModelCheck }));

  await vi.waitFor(() => expect(getByRole("button", { name: t.aiAutoSync }).hasAttribute("disabled")).toBe(false));
  expect(queryByText(t.aiSyncModelInventoryError)).toBeNull();
  expect(checks).toBe(3);
});

it("reports a successful empty model inventory as missing instead of an inventory error", async () => {
  const t = useI18nStore.getState().t;
  useSettingsStore.setState({ modelsDir: "", deviceMode: false, spotifyMode: false });
  useBusyStore.setState({ reasons: new Set() });
  vi.mocked(invoke).mockImplementation((command: unknown) => {
    if (command === "get_python_env_info") return Promise.resolve({ packagesReady: true });
    if (command === "get_models_dir") return Promise.resolve("/models");
    if (command === "check_model_files") return Promise.resolve([false]);
    return Promise.resolve(undefined);
  });
  useLrcStore.setState({ audioPath: "/tmp/audio.wav" });
  const { findByText, getByRole, queryByText } = render(<LrcEditor onPreview={() => {}} />);

  await findByText(t.aiSyncNoModel);
  expect(queryByText(t.aiSyncModelInventoryError)).toBeNull();
  expect(queryByText(t.aiSyncRetryModelCheck)).toBeNull();
  expect(getByRole("button", { name: t.aiAutoSync }).hasAttribute("disabled")).toBe(true);
});

it("keeps large lyric documents to a bounded mounted row window", () => {
  useLrcStore.setState({
    doc: {
      ...defaultDocument(),
      lines: Array.from({ length: 1_000 }, (_, index) => ({
        id: `large-${index}`,
        text: `Lyric row ${index}`,
        timestamp: index,
      })),
    },
    activeLineId: null,
  });

  const { container } = render(<LrcEditor onPreview={() => {}} />);
  const mountedRows = container.querySelectorAll(".ls-line-list [data-line-id]");

  expect(mountedRows.length).toBeLessThan(100);
  expect(container.querySelector('[data-line-id="large-999"]')).toBeNull();

  act(() => useLrcStore.setState({ activeLineId: "large-999" }));
  expect(container.querySelector('[data-line-id="large-999"]')?.getAttribute("aria-posinset")).toBe("1000");
  expect(container.querySelectorAll(".ls-line-list [data-line-id]").length).toBeLessThan(100);
});

it("moves the rendered window when the large lyric list scrolls", async () => {
  useLrcStore.setState({
    doc: {
      ...defaultDocument(),
      lines: Array.from({ length: 1_000 }, (_, index) => ({
        id: `scroll-${index}`,
        text: `Lyric row ${index}`,
        timestamp: index,
      })),
    },
    activeLineId: null,
  });

  const { container } = render(<LrcEditor onPreview={() => {}} />);
  const list = container.querySelector<HTMLElement>(".ls-line-list")!;
  list.scrollTop = 20_000;
  fireEvent.scroll(list);

  await waitFor(() => {
    const renderedIndices = Array.from(list.querySelectorAll<HTMLElement>("[data-line-index]"))
      .map((row) => Number(row.dataset.lineIndex));
    expect(Math.min(...renderedIndices)).toBeGreaterThan(400);
    expect(Math.max(...renderedIndices)).toBeLessThan(600);
  });
});

it("reveals and selects a find occurrence in an unmounted large-document row", async () => {
  const t = useI18nStore.getState().t;
  useLrcStore.setState({
    doc: {
      ...defaultDocument(),
      lines: Array.from({ length: 600 }, (_, index) => ({
        id: `search-${index}`,
        text: index === 599 ? "needle at the end" : `Lyric row ${index}`,
        timestamp: index,
      })),
    },
    activeLineId: null,
  });

  const { container, getByRole, getByPlaceholderText } = render(<LrcEditor onPreview={() => {}} />);
  expect(container.querySelector('[data-line-id="search-599"]')).toBeNull();
  fireEvent.click(getByRole("button", { name: t.editorTools }));
  fireEvent.click(getByRole("button", { name: t.findReplace }));
  fireEvent.change(getByPlaceholderText(t.findPlaceholder), { target: { value: "needle" } });
  fireEvent.click(getByRole("button", { name: `${t.findNext} (Enter)` }));

  await waitFor(() => {
    const row = container.querySelector('[data-line-id="search-599"]');
    expect(row).not.toBeNull();
    const input = row?.querySelector("input");
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(6);
  });
});

it("keeps Tab navigation in document order across an unmounted virtual row", async () => {
  useLrcStore.setState({
    doc: {
      ...defaultDocument(),
      lines: Array.from({ length: 1_000 }, (_, index) => ({
        id: `tab-${index}`,
        text: `Lyric row ${index}`,
        timestamp: index,
      })),
    },
    activeLineId: null,
  });

  const { container } = render(<LrcEditor onPreview={() => {}} />);
  const list = container.querySelector<HTMLElement>(".ls-line-list")!;
  const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-line-index]"));
  const lastRenderedIndex = Number(rows[rows.length - 1].dataset.lineIndex);
  const nextIndex = lastRenderedIndex + 1;
  expect(list.querySelector(`[data-line-index="${nextIndex}"]`)).toBeNull();
  const rowControls = Array.from(rows[rows.length - 1].querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
  ));
  const lastControl = rowControls[rowControls.length - 1];
  lastControl.focus();

  expect(fireEvent.keyDown(lastControl, { key: "Tab" })).toBe(false);
  await waitFor(() => {
    const nextRow = list.querySelector<HTMLElement>(`[data-line-index="${nextIndex}"]`);
    expect(nextRow).not.toBeNull();
    expect(document.activeElement?.closest("[data-line-index]")).toBe(nextRow);
  });
});
