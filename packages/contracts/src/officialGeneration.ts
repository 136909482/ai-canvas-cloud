export type OfficialImageResolution = "1K" | "2K" | "4K";
export type OfficialModelStatus = "active" | "disabled";
export type OfficialProviderProtocol = "openai-compatible" | "dashscope";
export type OfficialImageParameterTemplate =
  "generic" | "gpt-image" | "nano-banana";
export type OfficialImageParameterTemplateSetting =
  "auto" | OfficialImageParameterTemplate;

export const OFFICIAL_IMAGE_TEMPLATE_LABELS = {
  auto: "自动识别",
  generic: "通用图片",
  "gpt-image": "GPT Image",
  "nano-banana": "Google Nano Banana",
} as const;

export function resolveOfficialImageParameterTemplate(
  setting: OfficialImageParameterTemplateSetting | undefined,
  modelId: string,
): OfficialImageParameterTemplate {
  if (setting && setting !== "auto") return setting;
  const normalized = modelId.trim().toLowerCase();
  if (/(?:^|[-_/])gpt[-_]?image(?:[-_/]|$)/.test(normalized))
    return "gpt-image";
  if (
    /nano[-_ ]?banana/.test(normalized) ||
    (normalized.includes("gemini") && normalized.includes("image"))
  )
    return "nano-banana";
  return "generic";
}

export interface OfficialGenerationPreferences {
  platformEnabled: boolean;
  userEnabled: boolean;
  effectiveEnabled: boolean;
}

export interface UpdateOfficialGenerationPreferencesRequest {
  enabled: boolean;
}

export interface OfficialModelPrices {
  "1K": number | null;
  "2K": number | null;
  "4K": number | null;
}

export interface OfficialModelSummary {
  id: string;
  name: string;
  parameterTemplate?: OfficialImageParameterTemplate;
  capabilities: {
    generate: boolean;
    edit: boolean;
    references: boolean;
  };
  prices: OfficialModelPrices;
}

export interface OfficialModelsResponse {
  preferences: OfficialGenerationPreferences;
  models: OfficialModelSummary[];
}

export type CreditLedgerEntryType =
  | "signup_bonus"
  | "redemption"
  | "admin_adjustment"
  | "generation_reserve"
  | "generation_capture"
  | "generation_release";

export interface CreditBalance {
  available: number;
  reserved: number;
  updatedAt: string;
}

export interface CreditLedgerEntry {
  id: string;
  type: CreditLedgerEntryType;
  availableDelta: number;
  reservedDelta: number;
  availableBalance: number;
  reservedBalance: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
}

export interface CreditLedgerPage {
  items: CreditLedgerEntry[];
  nextCursor: string | null;
}

export interface RedeemCreditCodeRequest {
  code: string;
  idempotencyKey: string;
}

export interface RedeemCreditCodeResponse {
  credited: number;
  balance: CreditBalance;
}

export type OfficialImageOperation = "generate" | "edit";
export type OfficialGenerationTaskStatus =
  "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface CreateOfficialImageTaskRequest {
  projectId: string;
  clientTaskId: string;
  idempotencyKey: string;
  modelId: string;
  resolution: OfficialImageResolution;
  operationType: OfficialImageOperation;
  prompt: string;
  negativePrompt?: string | null;
  ratio: string;
  quality?: "auto" | "low" | "medium" | "high";
  background?: "auto" | "opaque" | "transparent";
  inputAssetIds?: string[];
  editAssetId?: string | null;
  maskAssetId?: string | null;
}

export interface OfficialGenerationTask {
  id: string;
  clientTaskId: string;
  projectId: string;
  modelId: string;
  modelName: string;
  resolution: OfficialImageResolution;
  price: number;
  operationType: OfficialImageOperation;
  status: OfficialGenerationTaskStatus;
  failureCategory: string | null;
  resultAssetId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface OfficialGenerationTaskResponse {
  task: OfficialGenerationTask;
  balance: CreditBalance;
}

export interface OfficialGenerationTaskPage {
  items: OfficialGenerationTask[];
  nextCursor: string | null;
}

export interface AdminOfficialProviderSummary {
  id: string;
  displayName: string;
  protocol: OfficialProviderProtocol;
  baseUrl: string;
  credentialsConfigured: boolean;
  createdAt: string;
}

export interface AdminCreateOfficialProviderRequest {
  displayName: string;
  protocol: OfficialProviderProtocol;
  baseUrl: string;
  apiKey: string;
}

export interface AdminOfficialProviderModelOption {
  id: string;
  name: string | null;
}

export interface AdminOfficialModel extends OfficialModelSummary {
  parameterTemplateSetting?: OfficialImageParameterTemplateSetting;
  providerRevisionId: string;
  providerName: string;
  upstreamModelId: string;
  status: OfficialModelStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUpsertOfficialModelRequest {
  parameterTemplate?: OfficialImageParameterTemplateSetting;
  providerRevisionId: string;
  publicName: string;
  upstreamModelId: string;
  capabilities: OfficialModelSummary["capabilities"];
  prices: OfficialModelPrices;
  status: OfficialModelStatus;
}

export interface AdminCreditSettings {
  signupBonus: number;
  signupBonusEnabledAt: string | null;
  updatedAt: string;
}

export interface AdminUpdateCreditSettingsRequest {
  signupBonus: number;
}

export interface AdminCreateRedemptionBatchRequest {
  creditAmount: number;
  codeCount: number;
  expiresAt?: string | null;
  note?: string | null;
}

export interface AdminRedemptionBatch {
  id: string;
  creditAmount: number;
  codeCount: number;
  redeemedCount: number;
  expiresAt: string | null;
  note: string | null;
  status: "active" | "revoked";
  createdAt: string;
}

export interface AdminCreatedRedemptionBatch extends AdminRedemptionBatch {
  codes: string[];
}

export interface AdminCreditAdjustmentRequest {
  delta: number;
  reason: string;
}
