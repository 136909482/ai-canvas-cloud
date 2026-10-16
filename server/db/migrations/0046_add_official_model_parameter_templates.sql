-- Additive: old application versions can keep reading and writing model rows.
ALTER TABLE public.official_models
  ADD COLUMN IF NOT EXISTS parameter_template text NOT NULL DEFAULT 'auto'
  CONSTRAINT official_model_parameter_template_check
  CHECK (parameter_template IN ('auto', 'generic', 'gpt-image', 'nano-banana'));
