import type {
  AssetResponse,
  CreateOfficialImageTaskRequest,
  CreditBalance,
  CreditLedgerPage,
  OfficialGenerationPreferences,
  OfficialGenerationTaskPage,
  OfficialGenerationTaskResponse,
  OfficialModelsResponse,
  RedeemCreditCodeResponse,
} from "@ai-canvas-cloud/contracts";
import { requestCloudJson } from "@/api/cloudApiClient";

export const fetchOfficialGenerationPreferences = () =>
  requestCloudJson<OfficialGenerationPreferences>(
    "/official-generation/preferences",
    { method: "GET" },
  );

export const updateOfficialGenerationPreferences = (enabled: boolean) =>
  requestCloudJson<OfficialGenerationPreferences>(
    "/official-generation/preferences",
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  );

export const fetchOfficialModels = () =>
  requestCloudJson<OfficialModelsResponse>("/official-models", {
    method: "GET",
  });

export const fetchCreditBalance = () =>
  requestCloudJson<CreditBalance>("/credits", { method: "GET" });

export const fetchCreditLedger = (cursor?: string | null) =>
  requestCloudJson<CreditLedgerPage>(
    `/credits/entries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    { method: "GET" },
  );

export const redeemCreditCode = (code: string) =>
  requestCloudJson<RedeemCreditCodeResponse>("/credits/redeem", {
    method: "POST",
    body: JSON.stringify({ code, idempotencyKey: crypto.randomUUID() }),
  });

export const createOfficialImageTask = (
  input: CreateOfficialImageTaskRequest,
) =>
  requestCloudJson<OfficialGenerationTaskResponse>("/official-image-tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const fetchOfficialImageTasks = (cursor?: string | null) =>
  requestCloudJson<OfficialGenerationTaskPage>(
    `/official-image-tasks${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    { method: "GET" },
  );

export const fetchOfficialImageTask = (taskId: string) =>
  requestCloudJson<OfficialGenerationTaskResponse>(
    `/official-image-tasks/${encodeURIComponent(taskId)}`,
    { method: "GET" },
  );

export const cancelOfficialImageTask = (taskId: string) =>
  requestCloudJson<OfficialGenerationTaskResponse>(
    `/official-image-tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: "POST" },
  );

export const acknowledgeOfficialImageTask = (taskId: string) =>
  requestCloudJson<OfficialGenerationTaskResponse>(
    `/official-image-tasks/${encodeURIComponent(taskId)}/acknowledge`,
    { method: "POST" },
  );

export const fetchOfficialResultAsset = (assetId: string) =>
  requestCloudJson<AssetResponse>(`/assets/${encodeURIComponent(assetId)}`, {
    method: "GET",
  });
