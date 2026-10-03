import { create } from "zustand";

interface ToastState {
  message: string | null;
  tone: "default" | "success" | "error";
  show: (message: string, tone?: ToastState["tone"]) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  tone: "default",
  show: (message, tone = "default") => set({ message, tone }),
  hide: () => set({ message: null }),
}));
