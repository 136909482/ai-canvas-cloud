import {
  AdminCsrfResponseSchema,
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
  AdminLoginRequestSchema,
  AdminLoginSecurityRequestSchema,
  AdminPasswordRequestSchema,
  AdminUsernameRequestSchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type { AdminService } from "@ai-canvas-cloud/server/modules/admin";
import type { AdminApiConfig } from "../../config.js";
import {
  clearCsrfCookie,
  createCsrfCookie,
  createCsrfToken,
} from "../../security.js";
import {
  adminOperation,
  adminRequestContext,
  bodyRecord,
  booleanField,
  optionalStringField,
  stringField,
} from "../helpers.js";
import type { AdminFastifyInstance } from "../types.js";

const errors = {
  400: AdminErrorResponseSchema,
  401: AdminErrorResponseSchema,
  403: AdminErrorResponseSchema,
  409: AdminErrorResponseSchema,
  500: AdminErrorResponseSchema,
  503: AdminErrorResponseSchema,
};

function setCookies(
  reply: { raw: { setHeader: (name: string, value: string[]) => void } },
  cookies: string[],
) {
  if (cookies.length > 0) reply.raw.setHeader("set-cookie", cookies);
}

export function registerAdminAuthRoutes(
  app: AdminFastifyInstance,
  options: { config: AdminApiConfig; adminService: AdminService },
) {
  const context = (request: Parameters<typeof adminRequestContext>[0]) =>
    adminRequestContext(request, options.config);

  app.get(
    "/admin/v1/auth/csrf",
    {
      schema: {
        operationId: adminOperation("getAdminCsrfToken"),
        tags: ["auth-security"],
        response: { 200: AdminCsrfResponseSchema },
      },
    },
    async (_request, reply) => {
      const token = createCsrfToken(options.config.betterAuthSecret);
      setCookies(reply, [createCsrfCookie(token, options.config)]);
      return { token };
    },
  );

  app.get(
    "/admin/v1/auth/captcha",
    {
      schema: {
        operationId: adminOperation("getAdminLoginCaptcha"),
        tags: ["auth-security"],
        response: { 200: AdminJsonObjectSchema, ...errors },
      },
    },
    async () => options.adminService.createLoginCaptcha(),
  );

  app.post(
    "/admin/v1/auth/login",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("loginAdministrator"),
        tags: ["auth-security"],
        body: AdminLoginRequestSchema,
        response: { 200: AdminJsonObjectSchema, ...errors },
      },
    },
    async (request, reply) => {
      const body = bodyRecord(request.body);
      const result = await options.adminService.login(
        {
          username: stringField(body, "username"),
          password: stringField(body, "password"),
          captchaChallengeId: optionalStringField(body, "captchaChallengeId"),
          captchaCode: optionalStringField(body, "captchaCode"),
        },
        context(request),
      );
      setCookies(reply, result.setCookieHeaders);
      return result.response;
    },
  );

  app.get(
    "/admin/v1/auth/session",
    {
      schema: {
        operationId: adminOperation("getAdministratorSession"),
        tags: ["auth-security"],
        response: { 200: AdminJsonObjectSchema, ...errors },
      },
    },
    async (request) => options.adminService.getSession(context(request)),
  );

  app.post(
    "/admin/v1/auth/username",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("updateAdministratorUsername"),
        tags: ["auth-security"],
        body: AdminUsernameRequestSchema,
        response: { 200: AdminJsonObjectSchema, ...errors },
      },
    },
    async (request) => {
      const body = bodyRecord(request.body);
      return options.adminService.updateUsername(
        { username: stringField(body, "username") },
        context(request),
      );
    },
  );

  app.post(
    "/admin/v1/auth/password",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("changeAdministratorPassword"),
        tags: ["auth-security"],
        body: AdminPasswordRequestSchema,
        response: { 200: AdminJsonObjectSchema, ...errors },
      },
    },
    async (request, reply) => {
      const body = bodyRecord(request.body);
      const result = await options.adminService.changePassword(
        {
          currentPassword: stringField(body, "currentPassword"),
          newPassword: stringField(body, "newPassword"),
        },
        context(request),
      );
      setCookies(reply, result.setCookieHeaders);
      return result.response;
    },
  );

  app.get(
    "/admin/v1/auth/login-security",
    {
      schema: {
        operationId: adminOperation("getAdminLoginSecurity"),
        tags: ["auth-security"],
        response: { 200: AdminJsonObjectSchema, ...errors },
      },
    },
    async (request) =>
      options.adminService.getLoginSecuritySettings(context(request)),
  );

  app.post(
    "/admin/v1/auth/login-security",
    {
      bodyLimit: 16 * 1024,
      schema: {
        operationId: adminOperation("updateAdminLoginSecurity"),
        tags: ["auth-security"],
        body: AdminLoginSecurityRequestSchema,
        response: { 200: AdminJsonObjectSchema, ...errors },
      },
    },
    async (request) => {
      const body = bodyRecord(request.body);
      return options.adminService.updateLoginSecuritySettings(
        { captchaEnabled: booleanField(body, "captchaEnabled") },
        context(request),
      );
    },
  );

  app.post(
    "/admin/v1/auth/logout",
    {
      schema: {
        operationId: adminOperation("logoutAdministrator"),
        tags: ["auth-security"],
        response: { 200: AdminJsonObjectSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await options.adminService.logout(context(request));
      setCookies(reply, [
        ...result.setCookieHeaders,
        clearCsrfCookie(options.config),
      ]);
      return result.response;
    },
  );
}
