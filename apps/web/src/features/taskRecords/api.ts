import type { GenerationTaskRecordsResponse } from "@ai-canvas-cloud/contracts";
import { requestCloudJson } from "@/api/cloudApiClient";

export function fetchTaskRecords(cursor?: string | null) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return requestCloudJson<GenerationTaskRecordsResponse>(
    `/task-records${query}`,
    { method: "GET" },
  );
}
