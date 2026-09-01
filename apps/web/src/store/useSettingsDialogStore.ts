import { create } from "zustand";

export type SettingsCategoryId =
  | "account"
  | "community"
  | "devices"
  | "models"
  | "credits"
  | "storage"
  | "canvas"
  | "appearance"
  | "tasks";

export const EXPOSED_SETTINGS_CATEGORY_IDS: SettingsCategoryId[] = [
  "account",
  "community",
  "devices",
  "models",
  "credits",
  "storage",
  "canvas",
  "appearance",
  "tasks",
];

const EXPOSED_SETTINGS_CATEGORIES = new Set(EXPOSED_SETTINGS_CATEGORY_IDS);

function normalizeExposedCategory(category: SettingsCategoryId) {
  return EXPOSED_SETTINGS_CATEGORIES.has(category) ? category : "account";
}

interface SettingsDialogStore {
  isOpen: boolean;
  activeCategory: SettingsCategoryId;
  open: (category?: SettingsCategoryId) => void;
  close: () => void;
  setActiveCategory: (category: SettingsCategoryId) => void;
}

export const useSettingsDialogStore = create<SettingsDialogStore>((set) => ({
  isOpen: false,
  activeCategory: "account",
  open: (category = "account") =>
    set({ isOpen: true, activeCategory: normalizeExposedCategory(category) }),
  close: () => set({ isOpen: false }),
  setActiveCategory: (category) =>
    set({ activeCategory: normalizeExposedCategory(category) }),
}));
