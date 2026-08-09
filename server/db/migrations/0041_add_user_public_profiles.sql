CREATE TABLE IF NOT EXISTS public.user_public_profiles (
  user_id text PRIMARY KEY REFERENCES public."user" (id) ON DELETE CASCADE,
  public_nickname text,
  profile_status text NOT NULL DEFAULT 'active',
  community_consent_version integer,
  community_consent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_public_profiles_nickname_length_check
    CHECK (public_nickname IS NULL OR char_length(public_nickname) BETWEEN 1 AND 32),
  CONSTRAINT user_public_profiles_status_check
    CHECK (profile_status IN ('active', 'hidden')),
  CONSTRAINT user_public_profiles_consent_pair_check
    CHECK ((community_consent_version IS NULL) = (community_consent_at IS NULL)),
  CONSTRAINT user_public_profiles_consent_version_check
    CHECK (community_consent_version IS NULL OR community_consent_version = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_public_profiles_nickname_lower_unique
  ON public.user_public_profiles (lower(public_nickname))
  WHERE public_nickname IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_public_profiles_consent_idx
  ON public.user_public_profiles (community_consent_version, updated_at DESC)
  WHERE community_consent_version IS NOT NULL;

COMMENT ON TABLE public.user_public_profiles IS
  'User-controlled public profile and versioned community contribution consent.';
