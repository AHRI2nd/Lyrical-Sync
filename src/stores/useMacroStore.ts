import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { useLrcStore } from "./useLrcStore";
import type { MacroStep, SavedMacro } from "../types/macro";

interface MacroState {
  isRecording: boolean;
  currentSteps: MacroStep[];
  savedMacros: SavedMacro[];
  startRecording: () => void;
  discardRecording: () => void;
  /** 녹화 중일 때만 스텝을 기록(녹화 중이 아니면 조용히 무시) — 허용목록 호출부가
   *  항상 호출해도 되게 함(is-recording 분기를 각 호출부가 신경 쓸 필요 없음) */
  recordStep: (step: MacroStep) => void;
  /** 현재 기록된 스텝을 이름 붙여 저장하고 녹화 상태를 리셋 */
  saveMacro: (name: string) => void;
  deleteMacro: (id: string) => void;
  renameMacro: (id: string, name: string) => void;
  /** id의 매크로를 순서대로 재생. 선택 범위 기반 스텝은 scopeIds(비어있으면 전체)로 해석 */
  replayMacro: (id: string, scopeIds: string[]) => void;
}

let nextSeq = 1;
const genId = () => `${Date.now()}-${nextSeq++}`;

// zustand persist 기본 storage(window.localStorage)는 모듈 로드 시점에 즉시 평가되므로,
// 이 모듈이 window보다 먼저 임포트되는 환경(예: 테스트)에서 실패하면 이후로도 계속
// storage-unavailable로 남는다. localStorage를 지연 참조하는 얇은 어댑터로 그 문제를 피한다.
const lazyLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

export const useMacroStore = create<MacroState>()(
  persist(
    (set, get) => ({
      isRecording: false,
      currentSteps: [],
      savedMacros: [],

      startRecording: () => set({ isRecording: true, currentSteps: [] }),
      discardRecording: () => set({ isRecording: false, currentSteps: [] }),

      recordStep: (step) => {
        if (!get().isRecording) return;
        set((s) => ({ currentSteps: [...s.currentSteps, step] }));
      },

      saveMacro: (name) => {
        const { currentSteps } = get();
        if (currentSteps.length === 0) {
          set({ isRecording: false });
          return;
        }
        const macro: SavedMacro = { id: genId(), name, steps: currentSteps, createdAt: Date.now() };
        set((s) => ({ savedMacros: [macro, ...s.savedMacros], isRecording: false, currentSteps: [] }));
      },

      deleteMacro: (id) => set((s) => ({ savedMacros: s.savedMacros.filter((m) => m.id !== id) })),

      renameMacro: (id, name) =>
        set((s) => ({ savedMacros: s.savedMacros.map((m) => (m.id === id ? { ...m, name } : m)) })),

      replayMacro: (id, scopeIds) => {
        const macro = get().savedMacros.find((m) => m.id === id);
        if (!macro) return;
        const lrc = useLrcStore.getState();
        // shiftLines/clearTimestamps/deleteLines 자체는 "빈 배열 = 아무 것도 안 함"이라(전체
        // 대상 관례가 없음), 매크로의 "빈 선택 = 전체" 의미를 여기서 직접 해석해 채워준다.
        const targetIds = scopeIds.length > 0 ? scopeIds : lrc.doc.lines.map((l) => l.id);
        for (const step of macro.steps) {
          switch (step.action) {
            case "scaleTimestamps":
              lrc.scaleTimestamps(step.params.factor);
              break;
            case "applyOffset":
              // 파라미터 없음 — 재생 시점 문서의 metadata.offset을 그대로 적용(0이면 무동작).
              // "다시 그 버튼을 누른다"는 그대로의 의미이지, 기록 당시 오프셋 값을 저장/이식하지 않음.
              lrc.applyOffset();
              break;
            case "replaceAll":
              lrc.replaceInLines(step.params.find, step.params.replace, step.params.caseSensitive);
              break;
            case "shiftLines":
              lrc.shiftLines(targetIds, step.params.delta);
              break;
            case "clearTimestamps":
              lrc.clearTimestamps(targetIds);
              break;
            case "deleteLines":
              lrc.deleteLines(targetIds);
              break;
          }
        }
      },
    }),
    {
      name: "lyrical-sync-macros",
      storage: createJSONStorage(() => lazyLocalStorage),
      // isRecording/currentSteps는 세션 한정 상태 — 저장 대상에서 빼야
      // 크래시 시 "녹화 중" 플래그가 다음 실행에 그대로 남아 이후 허용목록 동작이
      // 죽은 세션의 currentSteps에 계속 쌓이는 문제가 생기지 않는다.
      partialize: (state) => ({ savedMacros: state.savedMacros }),
    }
  )
);
