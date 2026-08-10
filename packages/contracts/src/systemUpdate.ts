export type SystemUpdateState =
  "idle" | "queued" | "running" | "succeeded" | "failed";

export interface SystemUpdateStatusResponse {
  enabled: boolean;
  state: SystemUpdateState;
  updateAvailable: boolean;
  currentDigest: string | null;
  latestDigest: string | null;
  requestId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
  checkedAt: string;
}

export interface SystemUpdateRequestResponse {
  accepted: true;
  requestId: string;
  state: "queued";
}
