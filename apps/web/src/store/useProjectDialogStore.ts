import { create } from "zustand";

interface ProjectDialogStore {
  isOpen: boolean;
  pendingAction: "create" | null;
  open: () => void;
  openCreate: () => void;
  close: () => void;
}

export const useProjectDialogStore = create<ProjectDialogStore>((set) => ({
  isOpen: false,
  pendingAction: null,
  open: () => set({ isOpen: true, pendingAction: null }),
  openCreate: () => set({ isOpen: true, pendingAction: "create" }),
  close: () => set({ isOpen: false, pendingAction: null }),
}));
