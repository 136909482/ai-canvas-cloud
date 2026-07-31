import assert from "node:assert/strict";
import test from "node:test";
import { APIError } from "better-auth";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import {
  createPostgresAuthService,
  getAuthCookieSecurityOptions,
} from "../../dist/modules/auth/postgresAuthService.js";

test("protected environments use fixed secure session cookie attributes", () => {
  assert.deepEqual(getAuthCookieSecurityOptions("staging"), {
    useSecureCookies: true,
    defaultCookieAttributes: {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  });
  assert.equal(
    getAuthCookieSecurityOptions("development").useSecureCookies,
    false,
  );
});

interface QueryCall {
  text: string;
  values?: unknown[];
}

function createMockPool(
  handler: (
    call: QueryCall,
  ) => Promise<{ rows: unknown[] }> | { rows: unknown[] },
) {
  const calls: QueryCall[] = [];

  return {
    calls,
    pool: {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        return handler({ text, values });
      },
    },
  };
}

function createWorkspaceRows() {
  return {
    user_id: "user-1",
    user_no: "10001",
    display_username: "Artist_01",
    email: "artist@example.com",
    email_verified: false,
    user_status: "active",
    workspace_id: "workspace-1",
    workspace_type: "personal",
    workspace_name: "artist 的个人空间",
    workspace_status: "active",
    workspace_role: "owner",
    plan_key: "free",
  };
}

test("register delegates credentials to Better Auth and creates workspace data", async () => {
  let signUpBody: Record<string, unknown> | null = null;
  const authApi = {
    async signUpEmail(input: { body: Record<string, unknown> }) {
      signUpBody = input.body;
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "better-auth.session_token=signed; HttpOnly; Path=/",
      );
      return {
        headers,
        response: {
          token: "raw-token",
          user: {
            id: "user-1",
            email: "artist@example.com",
            emailVerified: false,
            name: "artist",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      };
    },
  };
  const { pool, calls } = createMockPool(({ text }) => {
    if (text.includes("INSERT INTO workspaces")) {
      return { rows: [{ id: "workspace-1" }] };
    }

    if (text.includes("SELECT") && text.includes("JOIN workspace_members")) {
      return { rows: [createWorkspaceRows()] };
    }

    return { rows: [] };
  });
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });
  const result = await authService.register(
    {
      username: " Artist_01 ",
      email: " Artist@Example.COM ",
      password: "long-enough-password",
      acceptedTermsAndPrivacy: true,
      deviceId: "device-a",
    },
    { requestId: "req_1", userAgent: "agent", ipAddress: "127.0.0.1" },
  );

  assert.equal(result.response.user.email, "artist@example.com");
  assert.equal(result.response.user.username, "Artist_01");
  assert.equal(result.response.user.userNumber, 10001);
  assert.equal(result.response.workspace.role, "owner");
  assert.match(
    result.setCookieHeaders.join("\n"),
    /better-auth\.session_token=signed/,
  );
  assert(calls.some((call) => call.text.includes("INSERT INTO workspaces")));
  assert(
    calls.some((call) => call.text.includes("INSERT INTO workspace_members")),
  );
  assert(
    calls.some((call) =>
      call.text.includes("INSERT INTO workspace_user_state"),
    ),
  );
  assert.equal(
    calls.some((call) => call.text.includes('DELETE FROM "session"')),
    false,
  );
  assert.deepEqual(signUpBody, {
    email: "artist@example.com",
    password: "long-enough-password",
    name: "Artist_01",
    username: "artist_01",
    displayUsername: "Artist_01",
    rememberMe: true,
  });
  assert.equal(
    calls.some((call) => call.text.includes("INSERT INTO sessions")),
    false,
  );
});

test("registration requires a valid email code when the site setting is enabled", async () => {
  let signUpCalled = false;
  const authApi = {
    async signUpEmail() {
      signUpCalled = true;
      throw new Error("sign-up must not run without a valid code");
    },
  };
  const { pool } = createMockPool(({ text }) => {
    if (text.includes("SET consumed_at = now()")) return { rows: [] };
    if (text.includes("SET failed_attempts = failed_attempts + 1")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
    emailService: {
      async sendRegistrationEmailCode() {},
      async sendPasswordResetEmail() {},
    },
    registrationEmailVerificationRequired: async () => true,
  });

  await assert.rejects(
    () =>
      authService.register(
        {
          username: "Artist_01",
          email: "artist@example.com",
          password: "long-enough-password",
          acceptedTermsAndPrivacy: true,
          deviceId: "device-a",
        },
        { requestId: "registration-code-required" },
      ),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.statusCode === 400 &&
      error.apiCode === "EMAIL_NOT_VERIFIED",
  );
  assert.equal(signUpCalled, false);
});

test("login requires confirmation before replacing another active device", async () => {
  const authApi = {
    async signInEmail() {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "better-auth.session_token=new-signed; HttpOnly; Path=/",
      );
      return {
        headers,
        response: {
          redirect: false,
          token: "new-token",
          user: {
            id: "user-1",
            email: "artist@example.com",
            emailVerified: true,
            name: "artist",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      };
    },
  };
  const { pool, calls } = createMockPool(({ text }) => {
    if (text.includes('FROM "session"') && text.includes("token <>")) {
      return { rows: [{ user_agent: "Edge on Windows" }] };
    }

    return { rows: [] };
  });
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  await assert.rejects(
    () =>
      authService.login(
        {
          identifier: " Artist@Example.COM ",
          password: "long-enough-password",
          deviceId: "device-b",
        },
        { requestId: "req_1", userAgent: "agent", ipAddress: "127.0.0.1" },
      ),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.statusCode === 409 &&
      error.apiCode === "ACTIVE_SESSION_EXISTS",
  );

  assert(
    calls.some(
      (call) =>
        call.text.includes('DELETE FROM "session"') &&
        call.text.includes("token = $2") &&
        call.values?.[1] === "new-token",
    ),
  );
  assert.equal(
    calls.some((call) => call.text.includes("INSERT INTO auth_devices")),
    false,
  );
});

test("confirmed login revokes the old session and records the new device", async () => {
  const authApi = {
    async signInEmail() {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "better-auth.session_token=new-signed; HttpOnly; Path=/",
      );
      return {
        headers,
        response: {
          redirect: false,
          token: "new-token",
          user: {
            id: "user-1",
            email: "artist@example.com",
            emailVerified: true,
            name: "artist",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      };
    },
  };
  const { pool, calls } = createMockPool(({ text }) => {
    if (
      text.includes('FROM "session"') &&
      text.includes("token <>") &&
      text.includes("expires_at")
    ) {
      return { rows: [{ user_agent: "Edge on Windows" }] };
    }

    if (text.includes("INSERT INTO workspaces")) {
      return { rows: [{ id: "workspace-1" }] };
    }

    if (text.includes("SELECT") && text.includes("JOIN workspace_members")) {
      return { rows: [createWorkspaceRows()] };
    }

    return { rows: [] };
  });
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });
  const result = await authService.login(
    {
      identifier: " Artist@Example.COM ",
      password: "long-enough-password",
      deviceId: "device-b",
      force: true,
    },
    {
      requestId: "req_1",
      userAgent: "Chrome on Windows",
      ipAddress: "127.0.0.1",
    },
  );

  assert.equal(result.response.user.email, "artist@example.com");
  assert.match(
    result.setCookieHeaders.join("\n"),
    /better-auth\.session_token=new-signed/,
  );
  assert(
    calls.some(
      (call) =>
        call.text.includes('DELETE FROM "session"') &&
        call.text.includes("token <> $2"),
    ),
  );
  assert(
    calls.some(
      (call) =>
        call.text.includes("INSERT INTO auth_devices") &&
        call.values?.[1] === "device-b",
    ),
  );
});

test("disabled user login deletes the temporary session before returning access denied", async () => {
  const authApi = {
    async signInEmail() {
      return {
        headers: new Headers(),
        response: {
          redirect: false,
          token: "disabled-login-token",
          user: {
            id: "disabled-user",
            email: "disabled@example.com",
            emailVerified: true,
            name: "disabled",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      };
    },
  };
  const { pool, calls } = createMockPool(({ text }) => {
    if (
      text.includes('FROM "session"') &&
      text.includes("token <>") &&
      text.includes("expires_at")
    ) {
      return { rows: [] };
    }
    if (text.includes("INSERT INTO workspaces"))
      return { rows: [{ id: "workspace-disabled" }] };
    if (
      text.includes("JOIN workspace_members") &&
      text.includes("u.status, 'active') = 'active'")
    ) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  await assert.rejects(
    () =>
      authService.login(
        {
          identifier: "disabled@example.com",
          password: "long-enough-password",
          deviceId: "disabled-device",
        },
        {
          requestId: "disabled-login",
          userAgent: "Test Browser",
          ipAddress: "127.0.0.1",
        },
      ),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.statusCode === 403 &&
      error.apiCode === "ACCESS_DENIED",
  );

  const temporarySessionDelete = calls.find(
    (call) =>
      call.text.includes('DELETE FROM "session"') &&
      call.text.includes("token = $2"),
  );
  assert.deepEqual(temporarySessionDelete?.values, [
    "disabled-user",
    "disabled-login-token",
  ]);
  assert(
    calls.some(
      (call) =>
        call.text.includes("JOIN workspace_members") &&
        call.text.includes("COALESCE(u.status, 'active') = 'active'"),
    ),
  );
});

test("listSessions exposes device creation time and marks the current session", async () => {
  const currentCreatedAt = new Date("2026-07-16T12:00:00.000Z");
  const otherCreatedAt = new Date("2026-07-15T08:00:00.000Z");
  const authApi = {
    async getSession() {
      return {
        session: {
          id: "session-current",
          token: "current-token",
          userId: "user-1",
          expiresAt: new Date("2026-08-16T12:00:00.000Z"),
          createdAt: currentCreatedAt,
          updatedAt: new Date("2026-07-16T12:30:00.000Z"),
        },
        user: {
          id: "user-1",
          email: "artist@example.com",
          emailVerified: true,
          name: "artist",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
    },
    async listSessions() {
      return [
        {
          id: "session-other",
          token: "other-token",
          userId: "user-1",
          userAgent: "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36",
          expiresAt: new Date("2026-08-15T08:00:00.000Z"),
          createdAt: otherCreatedAt,
          updatedAt: new Date("2026-07-16T11:00:00.000Z"),
        },
        {
          id: "session-current",
          token: "current-token",
          userId: "user-1",
          userAgent: "Mozilla/5.0 Edg/150.0.0.0",
          expiresAt: new Date("2026-08-16T12:00:00.000Z"),
          createdAt: currentCreatedAt,
          updatedAt: new Date("2026-07-16T12:30:00.000Z"),
        },
      ];
    },
  };
  const { pool } = createMockPool(() => ({ rows: [] }));
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  const result = await authService.listSessions({
    requestId: "req_1",
    cookieHeader: "better-auth.session_token=signed",
  });

  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0]?.id, "session-current");
  assert.equal(result.sessions[0]?.current, true);
  assert.equal(result.sessions[0]?.createdAt, currentCreatedAt.toISOString());
  assert.equal(result.sessions[1]?.createdAt, otherCreatedAt.toISOString());
});

test("listDevices returns persistent device history with the current device first", async () => {
  const authApi = {
    async getSession() {
      return {
        session: {
          id: "session-current",
          token: "current-token",
          userId: "user-1",
          expiresAt: new Date("2026-08-16T12:00:00.000Z"),
          createdAt: new Date("2026-07-16T12:00:00.000Z"),
          updatedAt: new Date("2026-07-16T12:30:00.000Z"),
        },
        user: {
          id: "user-1",
          email: "artist@example.com",
          emailVerified: true,
          name: "artist",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
    },
  };
  const { pool } = createMockPool(({ text }) => {
    if (text.includes("FROM auth_devices")) {
      return {
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            user_agent: "Mozilla/5.0 Edg/150.0.0.0",
            first_seen_at: new Date("2026-07-15T08:00:00.000Z"),
            last_seen_at: new Date("2026-07-16T12:30:00.000Z"),
            current: true,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            user_agent: "Mozilla/5.0 Chrome/150.0.0.0",
            first_seen_at: new Date("2026-07-14T08:00:00.000Z"),
            last_seen_at: new Date("2026-07-15T08:00:00.000Z"),
            current: false,
          },
        ],
      };
    }

    return { rows: [] };
  });
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  const result = await authService.listDevices({
    requestId: "req_1",
    cookieHeader: "better-auth.session_token=signed",
  });

  assert.equal(result.devices.length, 2);
  assert.equal(result.devices[0]?.current, true);
  assert.equal(result.devices[1]?.current, false);
  assert.equal(result.devices[1]?.firstSeenAt, "2026-07-14T08:00:00.000Z");
});

test("removeDevice deletes only a historical device owned by the current user", async () => {
  const deviceId = "22222222-2222-4222-8222-222222222222";
  const authApi = {
    async getSession() {
      return {
        session: {
          id: "session-current",
          token: "current-token",
          userId: "user-1",
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        user: {
          id: "user-1",
          email: "artist@example.com",
          emailVerified: true,
          name: "artist",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
    },
  };
  const { pool, calls } = createMockPool(({ text }) => {
    if (text.includes("SELECT id::text, last_session_id")) {
      return {
        rows: [{ id: deviceId, last_session_id: null, current: false }],
      };
    }

    return { rows: [] };
  });
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  const result = await authService.removeDevice(deviceId, {
    requestId: "req_1",
    cookieHeader: "better-auth.session_token=signed",
  });

  assert.deepEqual(result, { ok: true });
  assert(
    calls.some(
      (call) =>
        call.text.includes("DELETE FROM auth_devices") &&
        call.values?.[0] === deviceId &&
        call.values?.[1] === "user-1",
    ),
  );
});

test("register maps Better Auth duplicate email errors to validation conflicts", async () => {
  const authApi = {
    async signUpEmail() {
      throw APIError.from("UNPROCESSABLE_ENTITY", {
        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        message: "User already exists",
      });
    },
  };
  const { pool } = createMockPool(() => ({ rows: [] }));
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  await assert.rejects(
    () =>
      authService.register(
        {
          username: "Artist_01",
          email: "artist@example.com",
          password: "long-enough-password",
          acceptedTermsAndPrivacy: true,
          deviceId: "device-a",
        },
        { requestId: "req_1" },
      ),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.statusCode === 409 &&
      error.apiCode === "VALIDATION_FAILED",
  );
});

test("login routes mixed-case usernames through Better Auth normalization", async () => {
  let receivedUsername: string | null = null;
  const authApi = {
    async signInUsername(input: { body: { username: string } }) {
      receivedUsername = input.body.username;
      return {
        headers: new Headers(),
        response: {
          redirect: false,
          token: "username-token",
          user: {
            id: "user-1",
            email: "artist@example.com",
            emailVerified: true,
            name: "Artist_01",
            username: "artist_01",
            displayUsername: "Artist_01",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      };
    },
  };
  const { pool } = createMockPool(({ text }) => {
    if (text.includes('FROM "session"') && text.includes("token <>")) {
      return { rows: [] };
    }
    if (text.includes("INSERT INTO workspaces")) {
      return { rows: [{ id: "workspace-1" }] };
    }
    if (text.includes("SELECT") && text.includes("JOIN workspace_members")) {
      return { rows: [createWorkspaceRows()] };
    }
    return { rows: [] };
  });
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  const result = await authService.login(
    {
      identifier: " ArTiSt_01 ",
      password: "long-enough-password",
      deviceId: "device-a",
    },
    { requestId: "username-login" },
  );

  assert.equal(receivedUsername, "artist_01");
  assert.equal(result.response.user.username, "Artist_01");
});

test("register maps username conflicts to the stable unavailable error", async () => {
  const authApi = {
    async signUpEmail() {
      throw APIError.from("UNPROCESSABLE_ENTITY", {
        code: "USERNAME_IS_ALREADY_TAKEN",
        message: "Username is already taken",
      });
    },
  };
  const { pool } = createMockPool(() => ({ rows: [] }));
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  await assert.rejects(
    () =>
      authService.register(
        {
          username: "Artist_01",
          email: "artist@example.com",
          password: "long-enough-password",
          acceptedTermsAndPrivacy: true,
          deviceId: "device-a",
        },
        { requestId: "username-conflict" },
      ),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.statusCode === 409 &&
      error.apiCode === "USERNAME_UNAVAILABLE",
  );
});

test("requestPasswordReset delegates normalized email to Better Auth", async () => {
  let requestedEmail: string | null = null;
  const authApi = {
    async requestPasswordReset(input: { body: { email: string } }) {
      requestedEmail = input.body.email;
      return {
        status: true,
        message:
          "If this email exists in our system, check your email for the reset code",
      };
    },
  };
  const { pool } = createMockPool(() => ({ rows: [] }));
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  const response = await authService.requestPasswordReset(
    { email: " Artist@Example.COM " },
    { requestId: "req_1" },
  );

  assert.deepEqual(response, { ok: true });
  assert.equal(requestedEmail, "artist@example.com");
});

test("resetPassword validates the password and consumes an email code through Better Auth", async () => {
  let resetPayload: { token?: string; newPassword: string } | null = null;
  const authApi = {
    async resetPassword(input: {
      body: { token?: string; newPassword: string };
    }) {
      resetPayload = input.body;
      return { status: true };
    },
  };
  const { pool } = createMockPool(() => ({ rows: [] }));
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
    passwordResetEmailCodes: {
      async isCoolingDown() {
        return false;
      },
      async send() {},
      async consume(email, code) {
        assert.equal(email, "artist@example.com");
        assert.equal(code, "123456");
        return "token-1";
      },
    },
  });

  await assert.rejects(
    () =>
      authService.resetPassword(
        {
          email: "artist@example.com",
          code: "123456",
          password: "short",
        },
        { requestId: "req_1" },
      ),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.statusCode === 400 &&
      error.apiCode === "VALIDATION_FAILED",
  );

  const response = await authService.resetPassword(
    {
      email: " Artist@Example.COM ",
      code: "123456",
      password: "new-long-enough-password",
    },
    { requestId: "req_1" },
  );

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(resetPayload, {
    token: "token-1",
    newPassword: "new-long-enough-password",
  });
});

test("changePassword verifies the current password through Better Auth and revokes other sessions", async () => {
  let changePayload:
    | {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions?: boolean;
      }
    | undefined;
  const authApi = {
    async changePassword(input: {
      body: {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions?: boolean;
      };
    }) {
      changePayload = input.body;
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "better-auth.session_token=rotated; HttpOnly; Path=/",
      );
      return {
        headers,
        response: {
          token: "rotated-token",
          user: {
            id: "user-1",
            email: "artist@example.com",
            emailVerified: true,
            name: "Artist_01",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      };
    },
  };
  const { pool } = createMockPool(() => ({ rows: [] }));
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  });

  await assert.rejects(
    () =>
      authService.changePassword(
        {
          currentPassword: "same-long-enough-password",
          newPassword: "same-long-enough-password",
        },
        { requestId: "password-change-same" },
      ),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.statusCode === 400 &&
      error.apiCode === "VALIDATION_FAILED",
  );

  const result = await authService.changePassword(
    {
      currentPassword: "current-long-enough-password",
      newPassword: "new-long-enough-password",
    },
    { requestId: "password-change", cookieHeader: "session=signed" },
  );

  assert.deepEqual(result.response, { ok: true });
  assert.match(result.setCookieHeaders.join("\n"), /session_token=rotated/);
  assert.deepEqual(changePayload, {
    currentPassword: "current-long-enough-password",
    newPassword: "new-long-enough-password",
    revokeOtherSessions: true,
  });
});
