const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 10_000;

interface PollingRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

function getRetryAfterDelayMs(
  response: Response,
  now: () => number,
): number | null {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now()) : null;
}

function isRetryableResponse(response: Response) {
  return response.status === 429 || response.status >= 500;
}

function isRetryableNetworkError(error: unknown) {
  return error instanceof TypeError;
}

export async function fetchPollingRequestWithRetry(
  request: () => Promise<Response>,
  options: PollingRetryOptions = {},
) {
  const maxAttempts = Math.max(
    1,
    Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
  );
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(
    baseDelayMs,
    options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
  );
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await request();
      if (!isRetryableResponse(response) || attempt === maxAttempts) {
        return response;
      }

      const retryAfterDelayMs = getRetryAfterDelayMs(response, now);
      const backoffDelayMs = Math.min(
        baseDelayMs * 2 ** (attempt - 1),
        maxDelayMs,
      );
      await sleep(Math.min(retryAfterDelayMs ?? backoffDelayMs, maxDelayMs));
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt === maxAttempts) {
        throw error;
      }

      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
    }
  }

  throw new Error("Polling request retry loop exhausted unexpectedly");
}
