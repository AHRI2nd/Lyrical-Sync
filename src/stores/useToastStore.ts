import { create } from "zustand";

export type ToastType = "success" | "error" | "info";
export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (type: ToastType, message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (type, message) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    // 에러는 더 오래 표시(읽을 시간 확보)
    const ttl = type === "error" ? 5000 : 2500;
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// React 외부(스토어/유틸)에서 호출하기 위한 헬퍼
export const toast = {
  success: (m: string) => useToastStore.getState().push("success", m),
  error: (m: string) => useToastStore.getState().push("error", m),
  info: (m: string) => useToastStore.getState().push("info", m),
};
