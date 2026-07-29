import type { AuthStatus } from "./useAuthStore";

export function shouldLoadAuthenticatedApp(
  status: AuthStatus,
  hasSession: boolean,
  isPasswordReset: boolean,
) {
  return status === "authenticated" && hasSession && !isPasswordReset;
}

const CHUNK_LOAD_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading (?:CSS )?chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /CSS_CHUNK_LOAD_FAILED/i,
];

export function isChunkLoadError(error: unknown) {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
