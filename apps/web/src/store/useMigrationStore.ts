import { create } from "zustand";
import type { MigrationImportSummary } from "@ai-canvas-cloud/contracts";
import {
  cancelMigrationExport,
  cancelMigrationImport,
  getMigrationExport,
  getMigrationImport,
  retryMigrationExport,
  type ParsedMigrationPackage,
} from "@/api/migrations";

interface PersistedMigrationIds {
  importId: string | null;
  exportProjectId: string | null;
  exportId: string | null;
}

interface MigrationStore {
  importSummary: MigrationImportSummary | null;
  importPackage: ParsedMigrationPackage | null;
  importBusy: boolean;
  exportSummary: {
    id: string;
    projectId: string;
    status: string;
    project: { id: string; name: string; version: number; sequence: number };
    progress: {
      fileCount: number;
      completedFileCount: number;
      totalBytes: number;
      completedBytes: number;
      retryCount: number;
    };
    archive: { byteSize: number; sha256: string } | null;
    error: { code: string; message: string } | null;
    expiresAt: string;
    cancelRequestedAt: string | null;
  } | null;
  exportBusy: boolean;
  hydrate: () => Promise<void>;
  setImport: (
    summary: MigrationImportSummary,
    packageData?: ParsedMigrationPackage | null,
  ) => void;
  setImportBusy: (busy: boolean) => void;
  clearImport: () => void;
  setExport: (
    projectId: string,
    summary: MigrationStore["exportSummary"],
  ) => void;
  setExportBusy: (busy: boolean) => void;
  clearExport: () => void;
  cancelImport: () => Promise<void>;
  cancelExport: () => Promise<void>;
  retryExport: () => Promise<void>;
}

const STORAGE_KEY = "ai-canvas-cloud:migration-state";

function readIds(): PersistedMigrationIds {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as Partial<PersistedMigrationIds>;
    return {
      importId: value.importId ?? null,
      exportProjectId: value.exportProjectId ?? null,
      exportId: value.exportId ?? null,
    };
  } catch {
    return { importId: null, exportProjectId: null, exportId: null };
  }
}

function writeIds(ids: PersistedMigrationIds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export const useMigrationStore = create<MigrationStore>()((set, get) => ({
  importSummary: null,
  importPackage: null,
  importBusy: false,
  exportSummary: null,
  exportBusy: false,

  hydrate: async () => {
    if (typeof window === "undefined") return;
    set({
      importSummary: null,
      importPackage: null,
      exportSummary: null,
      importBusy: false,
      exportBusy: false,
    });
    const ids = readIds();
    const [importResponse, exportResponse] = await Promise.all([
      ids.importId
        ? getMigrationImport(ids.importId).catch(() => null)
        : Promise.resolve(null),
      ids.exportProjectId && ids.exportId
        ? getMigrationExport(ids.exportProjectId, ids.exportId).catch(
            () => null,
          )
        : Promise.resolve(null),
    ]);
    if (importResponse) set({ importSummary: importResponse.import });
    else if (ids.importId) writeIds({ ...ids, importId: null });
    if (exportResponse && ids.exportProjectId)
      set({
        exportSummary: {
          ...exportResponse.export,
          projectId: ids.exportProjectId,
        },
      });
    else if (ids.exportId)
      writeIds({ ...ids, exportId: null, exportProjectId: null });
  },

  setImport: (summary, packageData) => {
    const ids = readIds();
    writeIds({ ...ids, importId: summary.id });
    set((state) => ({
      importSummary: summary,
      importPackage:
        packageData === undefined ? state.importPackage : packageData,
    }));
  },
  setImportBusy: (importBusy) => set({ importBusy }),
  clearImport: () => {
    const ids = readIds();
    writeIds({ ...ids, importId: null });
    set({ importSummary: null, importPackage: null, importBusy: false });
  },
  setExport: (projectId, summary) => {
    const ids = readIds();
    writeIds({
      ...ids,
      exportProjectId: projectId,
      exportId: summary?.id ?? null,
    });
    set({ exportSummary: summary });
  },
  setExportBusy: (exportBusy) => set({ exportBusy }),
  clearExport: () => {
    const ids = readIds();
    writeIds({ ...ids, exportId: null, exportProjectId: null });
    set({ exportSummary: null, exportBusy: false });
  },
  cancelImport: async () => {
    const summary = get().importSummary;
    if (!summary) return;
    set({ importBusy: true });
    try {
      const response = await cancelMigrationImport(summary.id);
      set({ importSummary: response.import });
    } finally {
      set({ importBusy: false });
    }
  },
  cancelExport: async () => {
    const summary = get().exportSummary;
    if (!summary) return;
    const ids = readIds();
    if (!ids.exportProjectId) return;
    set({ exportBusy: true });
    try {
      const response = await cancelMigrationExport(
        ids.exportProjectId,
        summary.id,
      );
      set({
        exportSummary: { ...response.export, projectId: ids.exportProjectId },
      });
    } finally {
      set({ exportBusy: false });
    }
  },
  retryExport: async () => {
    const summary = get().exportSummary;
    const ids = readIds();
    if (!summary || !ids.exportProjectId) return;
    set({ exportBusy: true });
    try {
      const response = await retryMigrationExport(
        ids.exportProjectId,
        summary.id,
      );
      set({
        exportSummary: { ...response.export, projectId: ids.exportProjectId },
      });
    } finally {
      set({ exportBusy: false });
    }
  },
}));
