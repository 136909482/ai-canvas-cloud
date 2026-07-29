import type {
  ApiErrorCode,
  ApiErrorResponse,
} from "@ai-canvas-cloud/contracts";
import { API_V1_PREFIX } from "@ai-canvas-cloud/contracts/http";

export const AUTH_SESSION_EXPIRED_EVENT =
  "ai-canvas-cloud-auth-session-expired";

export class CloudApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | null;
  readonly details?: Record<string, unknown>;

  constructor(options: {
    status: number;
    code: ApiErrorCode | null;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "CloudApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

function shouldNotifySessionExpired(path: string, status: number) {
  return (
    status === 401 &&
    !path.startsWith("/auth/login") &&
    !path.startsWith("/auth/register") &&
    !path.startsWith("/auth/password")
  );
}

function notifySessionExpired(path: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, {
      detail: { path },
    }),
  );
}

export async function requestCloudJson<TResponse>(
  path: string,
  options: RequestInit = {},
) {
  const response = await fetch(`${API_V1_PREFIX}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    ApiErrorResponse | TResponse | null;

  if (!response.ok) {
    if (shouldNotifySessionExpired(path, response.status)) {
      notifySessionExpired(path);
    }

    const apiError =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : null;
    throw new CloudApiError({
      status: response.status,
      code: apiError?.code ?? null,
      message: apiError?.message ?? `HTTP ${response.status}`,
      details: apiError?.details,
    });
  }

  return payload as TResponse;
}
