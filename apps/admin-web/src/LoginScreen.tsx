import { useCallback, useEffect, useState } from "react";
import type { AdminLoginResponse } from "@ai-canvas-cloud/contracts";
import { Alert, Button, Form, Input, Tooltip } from "antd";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { Brand } from "./components";

type LoginFields = {
  username: string;
  password: string;
  captchaCode?: string;
};

function errorMessage(error: unknown) {
  return error instanceof AdminApiError
    ? error.message
    : "请求未完成，请稍后重试";
}

export function LoginScreen({
  onComplete,
}: {
  onComplete: (response: AdminLoginResponse) => void;
}) {
  const [form] = Form.useForm<LoginFields>();
  const [captcha, setCaptcha] = useState<Awaited<
    ReturnType<typeof adminApi.captcha>
  > | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(true);
  const [captchaReady, setCaptchaReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaReady(false);
    form.setFieldValue("captchaCode", "");
    try {
      setCaptcha(await adminApi.captcha());
      setCaptchaReady(true);
    } catch (cause) {
      setCaptcha(null);
      setError(errorMessage(cause));
    } finally {
      setCaptchaLoading(false);
    }
  }, [form]);

  useEffect(() => {
    void refreshCaptcha();
  }, [refreshCaptcha]);

  async function submit(values: LoginFields) {
    setBusy(true);
    setError(null);
    try {
      onComplete(
        await adminApi.login(
          values.username,
          values.password,
          captcha?.enabled && captcha.challenge && values.captchaCode
            ? {
                challengeId: captcha.challenge.id,
                code: values.captchaCode,
              }
            : undefined,
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause));
      await refreshCaptcha();
    } finally {
      form.setFieldValue("password", "");
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="admin-login-title">
        <Brand />
        <div className="login-heading">
          <span className="login-heading__icon">
            <LockKeyhole size={20} />
          </span>
          <div>
            <h1 id="admin-login-title">管理员登录</h1>
            <p>使用独立管理员凭据进入控制台</p>
          </div>
        </div>
        {error ? (
          <Alert type="error" showIcon message={error} role="alert" />
        ) : null}
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => void submit(values)}
        >
          <Form.Item
            label="管理员账号"
            name="username"
            rules={[
              { required: true, message: "请输入管理员账号" },
              { min: 3, max: 30, message: "账号长度应为 3-30 位" },
            ]}
          >
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          {captcha?.enabled && captcha.challenge ? (
            <Form.Item
              label="验证码"
              name="captchaCode"
              rules={[
                { required: true, message: "请输入验证码" },
                { len: 5, message: "请输入 5 位验证码" },
              ]}
              normalize={(value: string) =>
                value.replace(/\D/g, "").slice(0, 5)
              }
            >
              <Input
                inputMode="numeric"
                autoComplete="off"
                maxLength={5}
                addonAfter={
                  <div className="captcha-addon">
                    <img
                      src={captcha.challenge.imageDataUrl}
                      alt="登录验证码"
                    />
                    <Tooltip title="刷新验证码">
                      <Button
                        type="text"
                        icon={<RefreshCw size={16} />}
                        loading={captchaLoading}
                        onClick={() => void refreshCaptcha()}
                        aria-label="刷新验证码"
                      />
                    </Tooltip>
                  </div>
                }
              />
            </Form.Item>
          ) : null}
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={busy}
            disabled={captchaLoading || !captchaReady}
          >
            登录
          </Button>
        </Form>
        <p className="login-footnote">Admin 独立身份域</p>
      </section>
    </main>
  );
}
