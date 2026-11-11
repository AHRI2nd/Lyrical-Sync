// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

const { invokeMock, listenMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), listenMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { LrcEditor } from "./LrcEditor";
import { ModelDownloadSection } from "../Settings/ModelDownloadSection";
import { useModelDownloadStore } from "../../stores/useModelDownloadStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { MODEL_DEFS } from "../../utils/modelDefs";

afterEach(() => cleanup());

it("records overlapping startup and Models-tab inventory calls and repeated tab checks", async () => {
  let finishInitialInventory!: (files: boolean[]) => void;
  let inventoryGate = new Promise<boolean[]>((resolve) => { finishInitialInventory = resolve; });
  const inventoryCalls: Array<{ modelId: string; startedAt: number }> = [];
  let outstanding = 0;
  let maxOutstanding = 0;

  invokeMock.mockReset().mockImplementation((command: string, args?: { modelId?: string }) => {
    if (command === "set_models_dir_override") return Promise.resolve(undefined);
    if (command === "get_models_dir") return Promise.resolve("/fixture/models");
    if (command === "get_python_env_info") return Promise.resolve({ packagesReady: true });
    if (command === "check_model_files") {
      inventoryCalls.push({ modelId: args?.modelId ?? "", startedAt: performance.now() });
      outstanding += 1;
      maxOutstanding = Math.max(maxOutstanding, outstanding);
      return inventoryGate.finally(() => { outstanding -= 1; });
    }
    return Promise.resolve(undefined);
  });
  listenMock.mockReset().mockResolvedValue(() => {});

  useSettingsStore.setState({ modelsDir: "" });
  useModelDownloadStore.setState({
    modelsPath: "",
    operations: {},
    models: Object.fromEntries(MODEL_DEFS.map((model) => [model.id, { status: "not-installed", progress: 0 }])),
  });

  function Fixture() {
    const [showModels, setShowModels] = useState(false);
    return (
      <>
        <LrcEditor onPreview={() => {}} />
        <button type="button" onClick={() => setShowModels((visible) => !visible)}>Toggle Models tab</button>
        {showModels && <ModelDownloadSection />}
      </>
    );
  }

  const ctc = MODEL_DEFS.find((model) => model.required)!;
  const demucs = MODEL_DEFS.find((model) => !model.required)!;
  render(<Fixture />);

  await waitFor(() => expect(inventoryCalls).toHaveLength(1));
  expect(inventoryCalls[0].modelId).toBe(ctc.id);
  expect(maxOutstanding).toBe(1);

  // Model settings can be opened while the editor's startup inventory is still running.
  fireEvent.click(screen.getByRole("button", { name: "Toggle Models tab" }));
  await waitFor(() => expect(inventoryCalls).toHaveLength(2));
  expect(inventoryCalls.filter((call) => call.modelId === ctc.id)).toHaveLength(1);
  expect(inventoryCalls.filter((call) => call.modelId === demucs.id)).toHaveLength(1);
  expect(maxOutstanding).toBe(2);

  await act(async () => { finishInitialInventory([true]); await inventoryGate; });
  inventoryGate = Promise.resolve([true]);
  await waitFor(() => expect(inventoryCalls).toHaveLength(3));
  expect(inventoryCalls.filter((call) => call.modelId === ctc.id)).toHaveLength(2);
  expect(inventoryCalls.filter((call) => call.modelId === demucs.id)).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Toggle Models tab" }));
  fireEvent.click(screen.getByRole("button", { name: "Toggle Models tab" }));
  await waitFor(() => expect(inventoryCalls).toHaveLength(6));
  expect(inventoryCalls.filter((call) => call.modelId === ctc.id)).toHaveLength(4);
  expect(inventoryCalls.filter((call) => call.modelId === demucs.id)).toHaveLength(2);
});
