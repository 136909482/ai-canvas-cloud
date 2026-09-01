import { Type } from "@sinclair/typebox";

const Uuid = Type.String({ format: "uuid" });
const NullableString = Type.Union([Type.String(), Type.Null()]);
const Resolution = Type.Union([
  Type.Literal("1K"),
  Type.Literal("2K"),
  Type.Literal("4K"),
]);
const Prices = Type.Object(
  {
    "1K": Type.Union([
      Type.Integer({ minimum: 1, maximum: 1_000_000 }),
      Type.Null(),
    ]),
    "2K": Type.Union([
      Type.Integer({ minimum: 1, maximum: 1_000_000 }),
      Type.Null(),
    ]),
    "4K": Type.Union([
      Type.Integer({ minimum: 1, maximum: 1_000_000 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
const Capabilities = Type.Object(
  {
    generate: Type.Boolean(),
    edit: Type.Boolean(),
    references: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const OfficialGenerationPreferencesSchema = Type.Object(
  {
    platformEnabled: Type.Boolean(),
    userEnabled: Type.Boolean(),
    effectiveEnabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const UpdateOfficialGenerationPreferencesRequestSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);
export const OfficialModelSummarySchema = Type.Object(
  { id: Uuid, name: Type.String(), capabilities: Capabilities, prices: Prices },
  { additionalProperties: false },
);
export const OfficialModelsResponseSchema = Type.Object(
  {
    preferences: OfficialGenerationPreferencesSchema,
    models: Type.Array(OfficialModelSummarySchema),
  },
  { additionalProperties: false },
);
export const CreditBalanceSchema = Type.Object(
  {
    available: Type.Integer({ minimum: 0 }),
    reserved: Type.Integer({ minimum: 0 }),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);
export const CreditLedgerEntrySchema = Type.Object(
  {
    id: Uuid,
    type: Type.String(),
    availableDelta: Type.Integer(),
    reservedDelta: Type.Integer(),
    availableBalance: Type.Integer({ minimum: 0 }),
    reservedBalance: Type.Integer({ minimum: 0 }),
    referenceType: NullableString,
    referenceId: NullableString,
    note: NullableString,
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
export const CreditLedgerPageSchema = Type.Object(
  {
    items: Type.Array(CreditLedgerEntrySchema),
    nextCursor: NullableString,
  },
  { additionalProperties: false },
);
export const RedeemCreditCodeRequestSchema = Type.Object(
  {
    code: Type.String({ minLength: 8, maxLength: 128 }),
    idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }),
  },
  { additionalProperties: false },
);
export const RedeemCreditCodeResponseSchema = Type.Object(
  { credited: Type.Integer({ minimum: 1 }), balance: CreditBalanceSchema },
  { additionalProperties: false },
);
export const CreateOfficialImageTaskRequestSchema = Type.Object(
  {
    projectId: Uuid,
    clientTaskId: Uuid,
    idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }),
    modelId: Uuid,
    resolution: Resolution,
    operationType: Type.Union([Type.Literal("generate"), Type.Literal("edit")]),
    prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
    negativePrompt: Type.Optional(
      Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()]),
    ),
    ratio: Type.String({ minLength: 1, maxLength: 32 }),
    inputAssetIds: Type.Optional(
      Type.Array(Uuid, { maxItems: 8, uniqueItems: true }),
    ),
    editAssetId: Type.Optional(Type.Union([Uuid, Type.Null()])),
    maskAssetId: Type.Optional(Type.Union([Uuid, Type.Null()])),
  },
  { additionalProperties: false },
);
export const OfficialGenerationTaskSchema = Type.Object(
  {
    id: Uuid,
    clientTaskId: Uuid,
    projectId: Uuid,
    modelId: Uuid,
    modelName: Type.String(),
    resolution: Resolution,
    price: Type.Integer({ minimum: 1 }),
    operationType: Type.Union([Type.Literal("generate"), Type.Literal("edit")]),
    status: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("canceled"),
    ]),
    failureCategory: NullableString,
    resultAssetId: Type.Union([Uuid, Type.Null()]),
    createdAt: Type.String(),
    startedAt: NullableString,
    completedAt: NullableString,
  },
  { additionalProperties: false },
);
export const OfficialGenerationTaskResponseSchema = Type.Object(
  { task: OfficialGenerationTaskSchema, balance: CreditBalanceSchema },
  { additionalProperties: false },
);
export const OfficialGenerationTaskPageSchema = Type.Object(
  {
    items: Type.Array(OfficialGenerationTaskSchema),
    nextCursor: NullableString,
  },
  { additionalProperties: false },
);

export const AdminCreateOfficialProviderRequestSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    protocol: Type.Union([
      Type.Literal("openai-compatible"),
      Type.Literal("dashscope"),
    ]),
    baseUrl: Type.String({ minLength: 8, maxLength: 2048 }),
    apiKey: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
);
export const AdminUpsertOfficialModelRequestSchema = Type.Object(
  {
    providerRevisionId: Uuid,
    publicName: Type.String({ minLength: 1, maxLength: 120 }),
    upstreamModelId: Type.String({ minLength: 1, maxLength: 256 }),
    capabilities: Capabilities,
    prices: Prices,
    status: Type.Union([Type.Literal("active"), Type.Literal("disabled")]),
  },
  { additionalProperties: false },
);
export const AdminUpdateCreditSettingsRequestSchema = Type.Object(
  { signupBonus: Type.Integer({ minimum: 0, maximum: 1_000_000 }) },
  { additionalProperties: false },
);
export const AdminCreateRedemptionBatchRequestSchema = Type.Object(
  {
    creditAmount: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    codeCount: Type.Integer({ minimum: 1, maximum: 10_000 }),
    expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    note: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
export const AdminCreditAdjustmentRequestSchema = Type.Object(
  {
    delta: Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
    reason: Type.String({ minLength: 3, maxLength: 500 }),
  },
  { additionalProperties: false },
);
