// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { HistoryPanel } from "./HistoryPanel";
import { useLrcStore } from "../../stores/useLrcStore";
import { defaultDocument } from "../../types/lrc";
import { useI18nStore } from "../../stores/useI18nStore";
beforeEach(() => { cleanup(); useLrcStore.setState({doc:{...defaultDocument(),lines:[{id:'1',text:'original',timestamp:null}]},_history:[],_future:[],_historyInfo:[],_futureInfo:[],_lastEditKey:null}); });
it("navigates labeled past states and can restore the future", () => {
  const t=useI18nStore.getState().t;
  useLrcStore.getState().updateLine('1',{text:'edited'}); render(<HistoryPanel />);
  fireEvent.click(screen.getByRole('button',{name:t.historyPanelTitle}));
  fireEvent.click(screen.getByRole('button',{name:new RegExp(t.historyLabels.editText)}));
  expect(useLrcStore.getState().doc.lines[0].text).toBe('original');
  fireEvent.click(screen.getByRole('button',{name:t.historyPanelTitle}));
  fireEvent.click(screen.getByRole('button',{name:new RegExp(t.historyLabels.editText)}));
  expect(useLrcStore.getState().doc.lines[0].text).toBe('edited');
});
it("closes on Escape and keeps an empty history disabled", () => {
  const t=useI18nStore.getState().t; render(<HistoryPanel />);
  expect(screen.getByRole('button',{name:t.historyPanelTitle}).hasAttribute('disabled')).toBe(true);
  useLrcStore.getState().addLine(); fireEvent.click(screen.getByRole('button',{name:t.historyPanelTitle}));
  fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('button',{name:t.historyCurrent})).toBeNull();
});
