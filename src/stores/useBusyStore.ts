import { create } from "zustand";

// 모델 다운로드·YouTube 오디오 다운로드처럼 여러 컴포넌트에 흩어진 백그라운드 작업을
// 하나의 "지금 뭔가 진행 중" 신호로 모음. 업데이트 다운로드/재시작이 이 작업들과
// 겹치면(고정 임시 파일 충돌, 강제 종료로 인한 부분 다운로드 손상) 문제가 생길 수 있어
// UpdateModal이 이 신호를 보고 버튼을 비활성화한다.
interface BusyState {
  reasons: Set<string>;
  markBusy: (id: string) => void;
  clearBusy: (id: string) => void;
}

export const useBusyStore = create<BusyState>((set) => ({
  reasons: new Set(),
  markBusy: (id) => set((s) => ({ reasons: new Set(s.reasons).add(id) })),
  clearBusy: (id) =>
    set((s) => {
      if (!s.reasons.has(id)) return s;
      const next = new Set(s.reasons);
      next.delete(id);
      return { reasons: next };
    }),
}));
