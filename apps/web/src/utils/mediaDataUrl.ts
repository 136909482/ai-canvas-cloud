function decodeBase64ToBytes(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!normalized) {
    throw new Error("Invalid Base64 media payload");
  }

  const remainder = normalized.length % 4;
  if (remainder === 1) {
    throw new Error("Invalid Base64 media payload");
  }

  const padded = normalized.padEnd(
    normalized.length + ((4 - remainder) % 4),
    "=",
  );
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeBase64DataUrl(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex < 0) {
    throw new Error("Unsupported Base64 media data URL");
  }

  const metadata = dataUrl.slice(5, separatorIndex).split(";");
  const mimeType = metadata[0]?.trim().toLowerCase() ?? "";
  const isSupportedMedia =
    mimeType.startsWith("image/") || mimeType.startsWith("video/");
  const isBase64 = metadata
    .slice(1)
    .some((value) => value.trim().toLowerCase() === "base64");

  if (!dataUrl.startsWith("data:") || !isSupportedMedia || !isBase64) {
    throw new Error("Unsupported Base64 media data URL");
  }

  try {
    return new Blob([decodeBase64ToBytes(dataUrl.slice(separatorIndex + 1))], {
      type: mimeType,
    });
  } catch (error) {
    throw new Error("Invalid Base64 media payload", { cause: error });
  }
}

export async function readMediaUrlAsBlob(
  mediaUrl: string,
  failureMessage: string,
) {
  if (mediaUrl.startsWith("data:")) {
    return decodeBase64DataUrl(mediaUrl);
  }

  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(failureMessage);
  }

  return response.blob();
}
