export type MigrationExportStatus =
  "prepared" | "generating" | "completed" | "failed" | "canceled" | "expired";

export interface PrepareMigrationExportRequest {
  idempotencyKey: string;
  expectedVersion?: number;
  expectedSequence?: number;
}

export interface MigrationExportResponse {
  export: {
    id: string;
    status: MigrationExportStatus;
    project: {
      id: string;
      name: string;
      version: number;
      sequence: number;
    };
    progress: {
      fileCount: number;
      completedFileCount: number;
      totalBytes: number;
      completedBytes: number;
      retryCount: number;
    };
    archive: {
      byteSize: number;
      sha256: string;
    } | null;
    error: {
      code: string;
      message: string;
    } | null;
    cancelRequestedAt: string | null;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface MigrationExportDownloadResponse {
  exportId: string;
  url: string;
  expiresAt: string;
}
