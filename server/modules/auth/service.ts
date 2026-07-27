import type {
  ApiErrorCode,
  AuthDevicesResponse,
  AuthSessionResponse,
  AuthSessionsResponse,
  AuthSuccessResponse,
  LoginRequest,
  PasswordChangeRequest,
  PasswordChangeResponse,
  PasswordForgotRequest,
  PasswordResetRequest,
  PasswordResetResponse,
  RegisterRequest,
  RegistrationEmailCodeRequest,
  RegistrationEmailCodeResponse,
  RemoveDeviceResponse,
  RevokeSessionResponse,
} from "@ai-canvas-cloud/contracts";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 30;
export const BETTER_AUTH_SESSION_COOKIE_NAME = "better-auth.session_token";
export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,29}$/;
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "root",
  "support",
  "system",
]);

export interface AuthRequestContext {
  requestId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  cookieHeader?: string | null;
}

export interface IssuedAuthSession {
  response: AuthSuccessResponse;
  setCookieHeaders: string[];
}

export interface RevokedAuthSession {
  setCookieHeaders: string[];
}

export interface AuthService {
  register: (
    input: RegisterRequest,
    context: AuthRequestContext,
  ) => Promise<IssuedAuthSession>;
  login: (
    input: LoginRequest,
    context: AuthRequestContext,
  ) => Promise<IssuedAuthSession>;
  getSession: (context: AuthRequestContext) => Promise<AuthSessionResponse>;
  listSessions: (context: AuthRequestContext) => Promise<AuthSessionsResponse>;
  listDevices: (context: AuthRequestContext) => Promise<AuthDevicesResponse>;
  sendRegistrationEmailCode: (
    input: RegistrationEmailCodeRequest,
    context: AuthRequestContext,
  ) => Promise<RegistrationEmailCodeResponse>;
  requestPasswordReset: (
    input: PasswordForgotRequest,
    context: AuthRequestContext,
  ) => Promise<PasswordResetResponse>;
  resetPassword: (
    input: PasswordResetRequest,
    context: AuthRequestContext,
  ) => Promise<PasswordResetResponse>;
  changePassword: (
    input: PasswordChangeRequest,
    context: AuthRequestContext,
  ) => Promise<
    RevokedAuthSession & {
      response: PasswordChangeResponse;
    }
  >;
  revokeSession: (
    sessionId: string,
    context: AuthRequestContext,
  ) => Promise<
    RevokedAuthSession & {
      response: RevokeSessionResponse;
    }
  >;
  removeDevice: (
    deviceId: string,
    context: AuthRequestContext,
  ) => Promise<RemoveDeviceResponse>;
  logout: (context: AuthRequestContext) => Promise<RevokedAuthSession>;
}

export class AuthServiceError extends Error {
  readonly statusCode: number;
  readonly apiCode: ApiErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(options: {
    statusCode: number;
    apiCode: ApiErrorCode;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "AuthServiceError";
    this.statusCode = options.statusCode;
    this.apiCode = options.apiCode;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export interface NormalizedRegistrationInput {
  usernameNormalized: string;
  displayUsername: string;
  emailNormalized: string;
  password: string;
}

export interface NormalizedLoginIdentifier {
  type: "email" | "username";
  value: string;
}

export function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid email address");
  }

  return normalized;
}

export function validatePassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
}

export function normalizeUsername(username: string) {
  if (typeof username !== "string") {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Username is required",
      details: { field: "username", reason: "required" },
    });
  }

  const displayUsername = username.trim();
  const usernameNormalized = displayUsername.toLowerCase();

  if (!USERNAME_PATTERN.test(displayUsername)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message:
        "Username must be 3 to 30 characters and start with a letter; only letters, numbers, and underscores are allowed",
      details: { field: "username", reason: "format" },
    });
  }

  if (RESERVED_USERNAMES.has(usernameNormalized)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "This username is reserved",
      details: { field: "username", reason: "reserved" },
    });
  }

  return { usernameNormalized, displayUsername };
}

export function normalizeLoginIdentifier(
  identifier: string,
): NormalizedLoginIdentifier {
  try {
    if (typeof identifier !== "string") {
      throw new Error("Invalid identifier");
    }

    const value = identifier.trim();
    if (value.includes("@")) {
      return { type: "email", value: normalizeEmail(value) };
    }

    if (!USERNAME_PATTERN.test(value)) {
      throw new Error("Invalid username");
    }

    return { type: "username", value: value.toLowerCase() };
  } catch {
    throw new AuthServiceError({
      statusCode: 401,
      apiCode: "AUTH_REQUIRED",
      message: "Invalid account or password",
    });
  }
}

export function normalizeRegistrationInput(input: {
  username: string;
  email: string;
  password: string;
}): NormalizedRegistrationInput {
  const { usernameNormalized, displayUsername } = normalizeUsername(
    input.username,
  );
  let emailNormalized: string;

  try {
    emailNormalized = normalizeEmail(input.email);
    validatePassword(input.password);
  } catch (error) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message:
        error instanceof Error ? error.message : "Invalid registration input",
    });
  }

  return {
    usernameNormalized,
    displayUsername,
    emailNormalized,
    password: input.password,
  };
}

export function createPersonalWorkspaceName(emailNormalized: string) {
  const [localPart] = emailNormalized.split("@");
  const trimmed = localPart?.trim();

  return trimmed ? `${trimmed} 的个人空间` : "个人空间";
}

export function createUnavailableAuthService(): AuthService {
  const error = () =>
    new AuthServiceError({
      statusCode: 503,
      apiCode: "SERVICE_UNAVAILABLE",
      message: "Auth service is not configured",
      retryable: true,
    });

  return {
    async register() {
      throw error();
    },
    async login() {
      throw error();
    },
    async getSession() {
      throw error();
    },
    async listSessions() {
      throw error();
    },
    async listDevices() {
      throw error();
    },
    async sendRegistrationEmailCode() {
      throw error();
    },
    async requestPasswordReset() {
      throw error();
    },
    async resetPassword() {
      throw error();
    },
    async changePassword() {
      throw error();
    },
    async revokeSession() {
      throw error();
    },
    async removeDevice() {
      throw error();
    },
    async logout() {
      throw error();
    },
  };
}
