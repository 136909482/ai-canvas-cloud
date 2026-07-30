import { hasDuplicateJsonObjectKeys } from "@ai-canvas-cloud/shared";

export class AdminStrictJsonError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AdminStrictJsonError";
  }
}

function isWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff)
        return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assertJsonShape(root: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 0 },
  ];
  let entries = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    entries += 1;
    if (entries > 100_000 || current.depth > 64) {
      throw new AdminStrictJsonError("JSON body is invalid");
    }
    if (typeof current.value === "string") {
      if (!isWellFormedUnicode(current.value))
        throw new AdminStrictJsonError("JSON body is invalid");
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, value] of Object.entries(current.value)) {
      if (!isWellFormedUnicode(key))
        throw new AdminStrictJsonError("JSON body is invalid");
      stack.push({ value, depth: current.depth + 1 });
    }
  }
}

export function parseAdminStrictJson(body: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new AdminStrictJsonError("JSON body is invalid");
  }
  if (!text.trim() || hasDuplicateJsonObjectKeys(text)) {
    throw new AdminStrictJsonError("JSON body is invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AdminStrictJsonError("JSON body is invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminStrictJsonError("JSON body is invalid");
  }
  assertJsonShape(value);
  return value;
}
