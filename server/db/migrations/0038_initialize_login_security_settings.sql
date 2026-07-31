INSERT INTO admin.login_security_settings (singleton_id, captcha_enabled)
VALUES (1, false)
ON CONFLICT (singleton_id) DO NOTHING;
