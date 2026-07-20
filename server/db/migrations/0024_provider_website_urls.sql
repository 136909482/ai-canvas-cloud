ALTER TABLE provider_credentials
  ADD COLUMN website_url text;

UPDATE provider_credentials
SET website_url = CASE provider_id
  WHEN 'openai' THEN 'https://openai.com'
  WHEN 'aliyun' THEN 'https://www.aliyun.com/product/bailian'
  ELSE regexp_replace(base_url, '^(https://[^/]+).*$', '\1')
END
WHERE website_url IS NULL;

ALTER TABLE provider_credentials
  ADD CONSTRAINT provider_credentials_website_url_check CHECK (
    website_url IS NULL
    OR (
      char_length(website_url) BETWEEN 8 AND 512
      AND website_url ~ '^https://'
      AND website_url !~ '[[:space:]]'
    )
  );

COMMENT ON COLUMN provider_credentials.website_url IS
  'Public informational website for the provider. It is never used as a model request target.';
