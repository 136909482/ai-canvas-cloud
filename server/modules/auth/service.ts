import type {
  ApiErrorCode,
  AuthDevicesResponse,
  AuthSessionResponse,
  AuthSessionsResponse,
  AuthSuccessResponse,
  EmailVerificationResponse,
  EmailVerifyRequest,
  LoginRequest,
  PasswordForgotRequest,
  PasswordResetRequest,
  PasswordResetResponse,
  RegisterRequest,
  RemoveDeviceResponse,
  RevokeSessionResponse,
} from "@ai-canvas-cloud/contracts";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;
export const BETTER_AUTH_SESSION_COOKIE_NAME = "better-auth.session_token";

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
  resendVerificationEmail: (
    context: AuthRequestContext,
  ) => Promise<EmailVerificationResponse>;
  verifyEmail: (
    input: EmailVerifyRequest,
    context: AuthRequestContext,
  ) => Promise<EmailVerificationResponse>;
  requestPasswordReset: (
    input: PasswordForgotRequest,
    context: AuthRequestContext,
  ) => Promise<PasswordResetResponse>;
  resetPassword: (
    input: PasswordResetRequest,
    context: AuthRequestContext,
  ) => Promise<PasswordResetResponse>;
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
  emailNormalized: string;
  password: string;
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

export function normalizeRegistrationInput(input: {
  email: string;
  password: string;
}): NormalizedRegistrationInput {
  const emailNormalized = normalizeEmail(input.email);
  validatePassword(input.password);

  return {
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
    async resendVerificationEmail() {
      throw error();
    },
    async verifyEmail() {
      throw error();
    },
    async requestPasswordReset() {
      throw error();
    },
    async resetPassword() {
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
