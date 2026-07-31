import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import type { AuthSessionResponse } from "@ai-canvas-cloud/contracts";
import { AccountSettingsContent } from "./AccountMenu.tsx";

Reflect.set(globalThis, "React", React);

function createSession(emailVerified: boolean): AuthSessionResponse {
  return {
    user: {
      id: "user_1",
      userNumber: 10001,
      username: "Artist_01",
      email: "artist@example.com",
      status: "active",
      emailVerified,
    },
    workspace: {
      id: "workspace_1",
      type: "personal",
      name: "不应展示的内部个人空间",
      role: "owner",
      status: "active",
      planKey: "free",
    },
  };
}

function renderPanel(emailVerified: boolean) {
  return renderToStaticMarkup(
    React.createElement(AccountSettingsContent, {
      session: createSession(emailVerified),
    }),
  );
}

test("account settings renders verified identity and security actions", () => {
  const markup = renderPanel(true);

  assert.match(markup, /Artist_01/);
  assert.match(markup, /artist@example\.com/);
  assert.match(markup, /UID 10001/);
  assert.match(markup, /邮箱已验证/);
  assert.match(markup, /修改密码/);
  assert.match(markup, /管理设备/);
  assert.doesNotMatch(markup, /发送验证邮件/);
  assert.doesNotMatch(markup, /验证码/);
  assert.doesNotMatch(markup, /退出登录/);
  assert.doesNotMatch(markup, /上传头像|修改用户名/);
  assert.doesNotMatch(markup, /不应展示的内部个人空间/);
});

test("account settings does not offer a verification-link action", () => {
  const markup = renderPanel(false);

  assert.match(markup, /邮箱待验证/);
  assert.doesNotMatch(markup, /发送验证邮件/);
  assert.doesNotMatch(markup, />已验证</);
});
