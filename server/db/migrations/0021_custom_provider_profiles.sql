ALTER TABLE provider_credentials
  ADD COLUMN display_name text NOT NULL DEFAULT 'Provider',
  ADD COLUMN provider_type text;

UPDATE provider_credentials
SET display_name = CASE provider_id
  WHEN 'openai' THEN 'OpenAI'
  WHEN 'aliyun' THEN '阿里百炼'
  ELSE provider_id
END,
provider_type = CASE provider_id
  WHEN 'aliyun' THEN 'aliyun_dashscope'
  ELSE 'openai_compatible'
END;

ALTER TABLE provider_credentials
  ALTER COLUMN provider_type SET NOT NULL,
  ADD CONSTRAINT provider_credentials_display_name_check CHECK (
    char_length(btrim(display_name)) BETWEEN 1 AND 80
  ),
  ADD CONSTRAINT provider_credentials_provider_type_check CHECK (
    provider_type IN ('openai_compatible', 'aliyun_dashscope')
  );

CREATE FUNCTION provider_credentials_fill_legacy_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider_type IS NULL THEN
    NEW.provider_type := CASE WHEN NEW.provider_id = 'aliyun' THEN 'aliyun_dashscope' ELSE 'openai_compatible' END;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER provider_credentials_fill_legacy_metadata_trigger
BEFORE INSERT OR UPDATE OF provider_id ON provider_credentials
FOR EACH ROW EXECUTE FUNCTION provider_credentials_fill_legacy_metadata();
