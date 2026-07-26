import {
  API_V1_PREFIX,
  type GenerationFailureCategory,
  type GenerationTelemetryCategory,
  type GenerationTelemetryRequest,
} from "@ai-canvas-cloud/contracts";

export interface GenerationTelemetryAttempt {
  attemptId: string;
  category: GenerationTelemetryCategory;
  startedAt: number;
}

function sendTelemetry(input: GenerationTelemetryRequest) {
  if (typeof fetch !== "function") {
    return;
  }

  void fetch(`${API_V1_PREFIX}/telemetry/generations`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  }).catch(() => undefined);
}

function createAttemptId() {
  return globalThis.crypto.randomUUID();
}

export function beginGenerationTelemetry(
  category: GenerationTelemetryCategory,
  options: { attemptId?: string; startedAt?: number } = {},
) {
  const attempt = {
    attemptId: options.attemptId ?? createAttemptId(),
    category,
    startedAt: options.startedAt ?? Date.now(),
  } satisfies GenerationTelemetryAttempt;

  sendTelemetry({
    attemptId: attempt.attemptId,
    category: attempt.category,
    status: "started",
  });
  return attempt;
}

export function restoreGenerationTelemetryAttempt(input: {
  attemptId?: string | null;
  category: GenerationTelemetryCategory;
  startedAt?: number | null;
}) {
  if (!input.attemptId || !input.startedAt || input.startedAt < 1) {
    return null;
  }
  return {
    attemptId: input.attemptId,
    category: input.category,
    startedAt: input.startedAt,
  } satisfies GenerationTelemetryAttempt;
}

function elapsedMs(attempt: GenerationTelemetryAttempt) {
  return Math.max(
    0,
    Math.min(24 * 60 * 60 * 1_000, Math.round(Date.now() - attempt.startedAt)),
  );
}

export function completeGenerationTelemetry(
  attempt: GenerationTelemetryAttempt | null,
  terminal:
    | { status: "succeeded"; resultCount: number }
    | { status: "failed"; failureCategory: GenerationFailureCategory }
    | { status: "canceled" },
) {
  if (!attempt) {
    return;
  }

  const base = {
    attemptId: attempt.attemptId,
    category: attempt.category,
    durationMs: elapsedMs(attempt),
  };

  if (terminal.status === "succeeded") {
    sendTelemetry({
      ...base,
      status: terminal.status,
      resultCount: terminal.resultCount,
    });
    return;
  }
  if (terminal.status === "failed") {
    sendTelemetry({
      ...base,
      status: terminal.status,
      failureCategory: terminal.failureCategory,
    });
    return;
  }
  sendTelemetry({ ...base, status: terminal.status });
}

export function classifyGenerationFailure(
  error: unknown,
): GenerationFailureCategory {
  const message = error instanceof Error ? error.message : String(error);

  if (
    /\b(?:401|403)\b|api[ _-]?key|unauthori[sz]ed|forbidden|鉴权|认证失败|密钥|无权限/i.test(
      message,
    )
  ) {
    return "authentication";
  }
  if (/\b429\b|rate[ _-]?limit|quota|限流|频率限制|配额/i.test(message)) {
    return "rate_limited";
  }
  if (
    /network|fetch|cors|timeout|timed out|connection|unable to reach|网络|连接|超时/i.test(
      message,
    )
  ) {
    return "network";
  }
  if (
    /invalid|parse|response|empty|未返回|不可读取|解析|响应无效/i.test(message)
  ) {
    return "invalid_response";
  }
  if (/\b5\d\d\b|upstream|provider|服务商|上游/i.test(message)) {
    return "upstream";
  }
  return "unknown";
}
