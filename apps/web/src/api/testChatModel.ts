import type { RuntimeModelConfig } from "@/types";

const TEST_MESSAGE = "ping";

function normalizeApiUrl(apiUrl: string) {
  return apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
}

function toSafeUrl(apiUrl: string) {
  try {
    return new URL(apiUrl);
  } catch {
    return new URL(`https://${apiUrl}`);
  }
}

function toProviderUrl(targetUrl: string) {
  return toSafeUrl(targetUrl).toString();
}

function buildChatCompletionsUrl(apiUrl: string) {
  const normalized = normalizeApiUrl(apiUrl.trim());
  const parsed = toSafeUrl(normalized);
  const pathname = parsed.pathname;

  if (
    pathname.endsWith("/v1/chat/completions") ||
    pathname.endsWith("/chat/completions")
  ) {
    return toProviderUrl(parsed.toString());
  }

  if (pathname.endsWith("/v1/models")) {
    return toProviderUrl(
      `${parsed.origin}${pathname.slice(0, -"/models".length)}/chat/completions`,
    );
  }

  if (pathname.endsWith("/v1")) {
    return toProviderUrl(`${parsed.origin}${pathname}/chat/completions`);
  }

  return toProviderUrl(
    `${parsed.origin}${pathname === "/" ? "" : pathname}/v1/chat/completions`,
  );
}

async function readError(response: Response) {
  const text = await response.text();
  return text || response.statusText || "Unknown error";
}

export async function testChatModelConnection(
  model: Pick<RuntimeModelConfig, "apiKey" | "apiUrl" | "modelId">,
) {
  const response = await fetch(buildChatCompletionsUrl(model.apiUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.modelId,
      messages: [{ role: "user", content: TEST_MESSAGE }],
      max_tokens: 1,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `测试失败：${response.status} ${await readError(response)}`,
    );
  }

  return response.json();
}
