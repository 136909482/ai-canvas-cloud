import type {
  CustomImageFileMapping,
  CustomImagePollMapping,
  CustomImageProviderImportV1,
  CustomImageProviderManifestV1,
  CustomImageRequestMapping,
  CustomImageResultMapping,
  CustomImageTemplateValue,
  ProviderAuthMode,
} from "@/types";

export const CUSTOM_IMAGE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const CUSTOM_IMAGE_MANIFEST_MAX_BYTES = 256 * 1024;

const DANGEROUS_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const TEMPLATE_VARIABLES = new Set([
  "$model",
  "$prompt",
  "$negativePrompt",
  "$params.ratio",
  "$params.resolution",
  "$params.quality",
  "$params.size",
  "$params.width",
  "$params.height",
  "$inputImages.urls",
  "$editImage.url",
  "$mask.url",
  "$taskId",
]);
const AUTH_MODES = new Set<ProviderAuthMode>([
  "none",
  "bearer",
  "x-api-key",
  "api-key",
]);

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new Error(`${path}：${message}`);
}

function requireRecord(value: unknown, path: string): RecordValue {
  if (!isRecord(value)) fail(path, "必须是对象");
  return value;
}

function requireString(value: unknown, path: string) {
  if (typeof value !== "string" || !value.trim())
    fail(path, "必须是非空字符串");
  return value.trim();
}

function assertKeys(value: RecordValue, allowed: string[], path: string) {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) fail(`${path}.${unknown}`, "不支持此字段");
}

export function validateCustomProviderRelativePath(
  value: unknown,
  path: string,
) {
  const result = requireString(value, path);
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(result) || result.startsWith("/")) {
    fail(path, "必须是 Base URL 下的相对路径");
  }
  const pathname = result.split(/[?#]/, 1)[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  let decodedSegments: string[];
  try {
    decodedSegments = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    fail(path, "包含无效的 URL 编码");
  }
  if (decodedSegments.some((segment) => segment === "." || segment === "..")) {
    fail(path, "不得包含路径穿越片段");
  }
  if (decodedSegments.some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment))) {
    fail(path, "包含危险路径片段");
  }
  if (result.length > 512) fail(path, "长度不能超过 512 个字符");
  return result.replace(/^\.\//, "");
}

export function validateCustomProviderValuePath(value: unknown, path: string) {
  const result = requireString(value, path);
  const segments = result.split(".").filter(Boolean);
  if (!segments.length || segments.length > 32)
    fail(path, "路径层级必须为 1 到 32 层");
  if (
    segments.some(
      (segment) =>
        DANGEROUS_PATH_SEGMENTS.has(segment) ||
        (segment !== "*" &&
          !/^[$a-zA-Z_][$\w-]*$/.test(segment) &&
          !/^\d+$/.test(segment)),
    )
  ) {
    fail(path, "只允许字段名、数字索引和 * 通配符");
  }
  return segments.join(".");
}

function parseTemplateValue(
  value: unknown,
  path: string,
): CustomImageTemplateValue {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (value.startsWith("$") && !TEMPLATE_VARIABLES.has(value)) {
      fail(path, `不支持模板变量 ${value}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      parseTemplateValue(item, `${path}[${index}]`),
    );
  }
  const record = requireRecord(value, path);
  if (Object.keys(record).some((key) => DANGEROUS_PATH_SEGMENTS.has(key))) {
    fail(path, "包含危险对象字段");
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      parseTemplateValue(item, `${path}.${key}`),
    ]),
  );
}

function parseTemplateRecord(value: unknown, path: string) {
  if (value === undefined) return undefined;
  const parsed = parseTemplateValue(value, path);
  if (!isRecord(parsed)) fail(path, "必须是对象");
  return parsed as Record<string, CustomImageTemplateValue>;
}

function parseStringList(value: unknown, path: string) {
  if (!Array.isArray(value)) fail(path, "必须是字符串数组");
  const parsed = value.map((item, index) =>
    requireString(item, `${path}[${index}]`),
  );
  if (!parsed.length) fail(path, "至少需要一个值");
  return [...new Set(parsed)];
}

function parseResultMapping(
  value: unknown,
  path: string,
): CustomImageResultMapping {
  const record = requireRecord(value, path);
  assertKeys(record, ["imageUrlPaths", "base64Paths"], path);
  const imageUrlPaths =
    record.imageUrlPaths === undefined
      ? []
      : parseStringList(record.imageUrlPaths, `${path}.imageUrlPaths`).map(
          (item, index) =>
            validateCustomProviderValuePath(
              item,
              `${path}.imageUrlPaths[${index}]`,
            ),
        );
  const base64Paths =
    record.base64Paths === undefined
      ? []
      : parseStringList(record.base64Paths, `${path}.base64Paths`).map(
          (item, index) =>
            validateCustomProviderValuePath(
              item,
              `${path}.base64Paths[${index}]`,
            ),
        );
  if (!imageUrlPaths.length && !base64Paths.length) {
    fail(path, "至少配置一个图片 URL 或 base64 提取路径");
  }
  return { imageUrlPaths, base64Paths };
}

function parseFiles(
  value: unknown,
  path: string,
): CustomImageFileMapping[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(path, "必须是数组");
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = requireRecord(item, itemPath);
    assertKeys(record, ["field", "source", "multiple"], itemPath);
    const source = record.source;
    if (
      source !== "referenceImages" &&
      source !== "editImage" &&
      source !== "mask"
    ) {
      fail(`${itemPath}.source`, "必须是 referenceImages、editImage 或 mask");
    }
    return {
      field: requireString(record.field, `${itemPath}.field`),
      source,
      ...(record.multiple === true ? { multiple: true } : {}),
    };
  });
}

function parseRequest(value: unknown, path: string): CustomImageRequestMapping {
  const record = requireRecord(value, path);
  assertKeys(
    record,
    [
      "path",
      "method",
      "contentType",
      "query",
      "body",
      "files",
      "taskIdPath",
      "result",
    ],
    path,
  );
  if (record.method !== undefined && record.method !== "POST") {
    fail(`${path}.method`, "提交请求只允许 POST");
  }
  if (record.contentType !== "json" && record.contentType !== "multipart") {
    fail(`${path}.contentType`, "必须是 json 或 multipart");
  }
  const taskIdPath =
    record.taskIdPath === undefined
      ? undefined
      : validateCustomProviderValuePath(
          record.taskIdPath,
          `${path}.taskIdPath`,
        );
  const result =
    record.result === undefined
      ? undefined
      : parseResultMapping(record.result, `${path}.result`);
  return {
    path: validateCustomProviderRelativePath(record.path, `${path}.path`),
    method: "POST",
    contentType: record.contentType,
    ...(parseTemplateRecord(record.query, `${path}.query`)
      ? {
          query: parseTemplateRecord(record.query, `${path}.query`),
        }
      : {}),
    ...(parseTemplateRecord(record.body, `${path}.body`)
      ? {
          body: parseTemplateRecord(record.body, `${path}.body`),
        }
      : {}),
    ...(record.contentType === "multipart" &&
    parseFiles(record.files, `${path}.files`)
      ? {
          files: parseFiles(record.files, `${path}.files`),
        }
      : {}),
    ...(taskIdPath ? { taskIdPath } : {}),
    ...(result ? { result } : {}),
  };
}

function parsePoll(value: unknown, path: string): CustomImagePollMapping {
  const record = requireRecord(value, path);
  assertKeys(
    record,
    [
      "path",
      "method",
      "query",
      "body",
      "intervalSeconds",
      "timeoutSeconds",
      "statusPath",
      "successValues",
      "failureValues",
      "errorPath",
      "result",
    ],
    path,
  );
  const method = record.method === undefined ? "GET" : record.method;
  if (method !== "GET" && method !== "POST")
    fail(`${path}.method`, "必须是 GET 或 POST");
  const intervalSeconds =
    record.intervalSeconds === undefined ? 5 : record.intervalSeconds;
  if (
    typeof intervalSeconds !== "number" ||
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds < 2 ||
    intervalSeconds > 60
  ) {
    fail(`${path}.intervalSeconds`, "必须在 2 到 60 秒之间");
  }
  const timeoutSeconds =
    record.timeoutSeconds === undefined ? 1800 : record.timeoutSeconds;
  if (
    typeof timeoutSeconds !== "number" ||
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds < 60 ||
    timeoutSeconds > 3600
  ) {
    fail(`${path}.timeoutSeconds`, "必须在 60 到 3600 秒之间");
  }
  return {
    path: validateCustomProviderRelativePath(record.path, `${path}.path`),
    method,
    ...(parseTemplateRecord(record.query, `${path}.query`)
      ? {
          query: parseTemplateRecord(record.query, `${path}.query`),
        }
      : {}),
    ...(method === "POST" && parseTemplateRecord(record.body, `${path}.body`)
      ? {
          body: parseTemplateRecord(record.body, `${path}.body`),
        }
      : {}),
    intervalSeconds,
    timeoutSeconds,
    statusPath: validateCustomProviderValuePath(
      record.statusPath,
      `${path}.statusPath`,
    ),
    successValues: parseStringList(
      record.successValues,
      `${path}.successValues`,
    ),
    failureValues: parseStringList(
      record.failureValues,
      `${path}.failureValues`,
    ),
    ...(record.errorPath === undefined
      ? {}
      : {
          errorPath: validateCustomProviderValuePath(
            record.errorPath,
            `${path}.errorPath`,
          ),
        }),
    result: parseResultMapping(record.result, `${path}.result`),
  };
}

function parseManifestDefinition(value: unknown) {
  const record = requireRecord(value, "manifest");
  assertKeys(
    record,
    [
      "schemaVersion",
      "name",
      "executionMode",
      "capabilities",
      "submit",
      "poll",
    ],
    "manifest",
  );
  if (record.schemaVersion !== CUSTOM_IMAGE_MANIFEST_SCHEMA_VERSION) {
    fail("manifest.schemaVersion", "当前只支持版本 1");
  }
  if (record.executionMode !== "sync" && record.executionMode !== "polling") {
    fail("manifest.executionMode", "必须是 sync 或 polling");
  }
  const executionMode: "sync" | "polling" = record.executionMode;
  const capabilities = requireRecord(
    record.capabilities,
    "manifest.capabilities",
  );
  assertKeys(capabilities, ["generate", "edit"], "manifest.capabilities");
  if (
    capabilities.generate !== true ||
    typeof capabilities.edit !== "boolean"
  ) {
    fail("manifest.capabilities", "generate 必须为 true，edit 必须为布尔值");
  }
  const submit = requireRecord(record.submit, "manifest.submit");
  assertKeys(submit, ["generate", "edit"], "manifest.submit");
  const generate = parseRequest(submit.generate, "manifest.submit.generate");
  const edit =
    submit.edit === undefined
      ? undefined
      : parseRequest(submit.edit, "manifest.submit.edit");
  if (capabilities.edit && !edit)
    fail("manifest.submit.edit", "声明支持编辑时必须配置 edit");
  if (!capabilities.edit && edit)
    fail("manifest.submit.edit", "未声明编辑能力时不得配置 edit");
  const poll =
    record.poll === undefined
      ? undefined
      : parsePoll(record.poll, "manifest.poll");
  if (record.executionMode === "polling") {
    if (!poll) fail("manifest.poll", "异步协议必须配置轮询规则");
    if (!generate.taskIdPath || (edit && !edit.taskIdPath)) {
      fail("manifest.submit", "异步提交必须为每个操作配置 taskIdPath");
    }
  } else {
    if (poll) fail("manifest.poll", "同步协议不得配置轮询规则");
    if (!generate.result || (edit && !edit.result)) {
      fail("manifest.submit", "同步提交必须为每个操作配置结果提取规则");
    }
  }
  return {
    schemaVersion: CUSTOM_IMAGE_MANIFEST_SCHEMA_VERSION,
    name: requireString(record.name, "manifest.name"),
    executionMode,
    capabilities: { generate: true as const, edit: capabilities.edit },
    submit: { generate, ...(edit ? { edit } : {}) },
    ...(poll ? { poll } : {}),
  };
}

export function parseCustomImageProviderManifest(
  value: unknown,
  identity?: { id?: string; createdAt?: number; updatedAt?: number },
): CustomImageProviderManifestV1 {
  const definition = parseManifestDefinition(value);
  const now = Date.now();
  return {
    id: identity?.id?.trim() || crypto.randomUUID(),
    ...definition,
    createdAt: identity?.createdAt ?? now,
    updatedAt: identity?.updatedAt ?? now,
  };
}

export function normalizeStoredCustomImageProviderManifest(
  value: unknown,
): CustomImageProviderManifestV1 | null {
  if (!isRecord(value)) return null;
  const { id, createdAt, updatedAt, ...definition } = value;
  try {
    return parseCustomImageProviderManifest(definition, {
      id: typeof id === "string" ? id : undefined,
      createdAt: typeof createdAt === "number" ? createdAt : undefined,
      updatedAt: typeof updatedAt === "number" ? updatedAt : undefined,
    });
  } catch {
    return null;
  }
}

function parseAuthMode(
  value: unknown,
  path: string,
): ProviderAuthMode | undefined {
  if (value === undefined) return undefined;
  if (!AUTH_MODES.has(value as ProviderAuthMode))
    fail(path, "不支持此鉴权方式");
  return value as ProviderAuthMode;
}

export function parseCustomImageProviderImportText(
  text: string,
): CustomImageProviderImportV1 {
  if (
    new TextEncoder().encode(text).byteLength > CUSTOM_IMAGE_MANIFEST_MAX_BYTES
  ) {
    fail("导入文件", "不能超过 256 KiB");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail("导入文件", "不是有效 JSON");
  }
  const record = requireRecord(value, "导入文件");
  assertKeys(record, ["schemaVersion", "manifest", "defaults"], "导入文件");
  if (record.schemaVersion !== CUSTOM_IMAGE_MANIFEST_SCHEMA_VERSION) {
    fail("导入文件.schemaVersion", "当前只支持版本 1");
  }
  const manifest = parseManifestDefinition(record.manifest);
  const defaultsRecord =
    record.defaults === undefined
      ? undefined
      : requireRecord(record.defaults, "导入文件.defaults");
  if (defaultsRecord) {
    assertKeys(
      defaultsRecord,
      ["providerName", "baseUrl", "authMode", "suggestedModels"],
      "导入文件.defaults",
    );
    if ("apiKey" in defaultsRecord)
      fail("导入文件.defaults.apiKey", "导入包不得包含 API Key");
  }
  const suggestedModels =
    defaultsRecord?.suggestedModels === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(defaultsRecord.suggestedModels))
            fail("导入文件.defaults.suggestedModels", "必须是数组");
          return defaultsRecord.suggestedModels.map((item, index) => {
            const itemPath = `导入文件.defaults.suggestedModels[${index}]`;
            const model = requireRecord(item, itemPath);
            assertKeys(model, ["modelId", "displayName"], itemPath);
            return {
              modelId: requireString(model.modelId, `${itemPath}.modelId`),
              ...(typeof model.displayName === "string" &&
              model.displayName.trim()
                ? { displayName: model.displayName.trim() }
                : {}),
            };
          });
        })();
  return {
    schemaVersion: CUSTOM_IMAGE_MANIFEST_SCHEMA_VERSION,
    manifest,
    ...(defaultsRecord
      ? {
          defaults: {
            ...(typeof defaultsRecord.providerName === "string" &&
            defaultsRecord.providerName.trim()
              ? { providerName: defaultsRecord.providerName.trim() }
              : {}),
            ...(typeof defaultsRecord.baseUrl === "string" &&
            defaultsRecord.baseUrl.trim()
              ? { baseUrl: defaultsRecord.baseUrl.trim() }
              : {}),
            ...(parseAuthMode(
              defaultsRecord.authMode,
              "导入文件.defaults.authMode",
            )
              ? {
                  authMode: parseAuthMode(
                    defaultsRecord.authMode,
                    "导入文件.defaults.authMode",
                  ),
                }
              : {}),
            ...(suggestedModels?.length ? { suggestedModels } : {}),
          },
        }
      : {}),
  };
}

export function createCustomImageProviderImport(
  manifest: CustomImageProviderManifestV1,
  defaults?: CustomImageProviderImportV1["defaults"],
): CustomImageProviderImportV1 {
  const definition: CustomImageProviderImportV1["manifest"] = {
    schemaVersion: manifest.schemaVersion,
    name: manifest.name,
    executionMode: manifest.executionMode,
    capabilities: manifest.capabilities,
    submit: manifest.submit,
    ...(manifest.poll ? { poll: manifest.poll } : {}),
  };
  return {
    schemaVersion: CUSTOM_IMAGE_MANIFEST_SCHEMA_VERSION,
    manifest: definition,
    ...(defaults ? { defaults } : {}),
  };
}

export function createDefaultCustomImageProviderManifest(
  executionMode: "sync" | "polling" = "sync",
): CustomImageProviderManifestV1 {
  const definition = {
    schemaVersion: CUSTOM_IMAGE_MANIFEST_SCHEMA_VERSION,
    name: "Custom Image HTTP",
    executionMode,
    capabilities: { generate: true as const, edit: false },
    submit: {
      generate: {
        path: "v1/images/generations",
        method: "POST" as const,
        contentType: "json" as const,
        body: { model: "$model", prompt: "$prompt", size: "$params.size" },
        ...(executionMode === "sync"
          ? {
              result: {
                imageUrlPaths: ["data.*.url"],
                base64Paths: ["data.*.b64_json"],
              },
            }
          : { taskIdPath: "id" }),
      },
    },
    ...(executionMode === "polling"
      ? {
          poll: {
            path: "v1/images/tasks/$taskId",
            method: "GET" as const,
            intervalSeconds: 5,
            timeoutSeconds: 1800,
            statusPath: "status",
            successValues: ["SUCCEEDED", "SUCCESS", "DONE"],
            failureValues: ["FAILED", "ERROR", "CANCELED"],
            result: {
              imageUrlPaths: ["data.*.url"],
              base64Paths: ["data.*.b64_json"],
            },
          },
        }
      : {}),
  } satisfies Omit<
    CustomImageProviderManifestV1,
    "id" | "createdAt" | "updatedAt"
  >;
  return parseCustomImageProviderManifest(definition);
}

export const CUSTOM_IMAGE_PROVIDER_LLM_PROMPT = `你是图像生成 API 文档解析助手。请根据用户提供的 API 文档输出 AI Canvas Cloud 可导入的 CustomImageProviderImportV1 JSON。

约束：
1. 顶层只能包含 schemaVersion、manifest、defaults，schemaVersion 固定为 1。
2. 不得索要或输出 API Key、Authorization、Cookie 或任意密钥。
3. submit.generate 必填；图生图接口存在时配置 submit.edit，并把 capabilities.edit 设为 true。
4. 提交 method 固定 POST，contentType 只能是 json 或 multipart。
5. 异步接口使用 executionMode=polling，并配置 taskIdPath、poll.path、statusPath、successValues、failureValues 和结果路径。
6. 路径必须是 Base URL 下的相对路径，不得包含完整 URL。
7. 结果只使用 imageUrlPaths 或 base64Paths，路径支持点号、数字索引与 *。
8. 模板变量仅可使用 $model、$prompt、$negativePrompt、$params.ratio、$params.resolution、$params.quality、$params.size、$params.width、$params.height、$inputImages.urls、$editImage.url、$mask.url、$taskId。
9. defaults 可包含 providerName、baseUrl、authMode 和 suggestedModels；authMode 只能是 none、bearer、x-api-key、api-key。
10. 最终只输出一个 JSON 代码块，不附加解释。`;
