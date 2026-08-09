CREATE TABLE IF NOT EXISTS public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id text NOT NULL REFERENCES public."user" (id),
  source_workspace_id uuid NOT NULL REFERENCES public.workspaces (id),
  asset_id uuid NOT NULL REFERENCES public.assets (id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review',
  moderation_reason text,
  submission_idempotency_key text NOT NULL,
  published_at timestamp with time zone,
  withdrawn_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT community_posts_title_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT community_posts_status_check
    CHECK (status IN ('pending_review', 'published', 'rejected', 'withdrawn', 'removed')),
  CONSTRAINT community_posts_reason_check
    CHECK (moderation_reason IS NULL OR char_length(moderation_reason) BETWEEN 1 AND 500),
  CONSTRAINT community_posts_idempotency_key_check
    CHECK (char_length(submission_idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT community_posts_published_state_check
    CHECK (
      (status <> 'published' OR published_at IS NOT NULL)
      AND (published_at IS NULL OR status IN ('published', 'withdrawn', 'removed'))
    ),
  CONSTRAINT community_posts_withdrawn_state_check
    CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  CONSTRAINT community_posts_author_idempotency_unique
    UNIQUE (author_user_id, submission_idempotency_key)
);

CREATE INDEX IF NOT EXISTS community_posts_author_created_idx
  ON public.community_posts (author_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS community_posts_status_created_idx
  ON public.community_posts (status, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS community_posts_asset_protection_idx
  ON public.community_posts (asset_id)
  WHERE status IN ('pending_review', 'published');

CREATE TABLE IF NOT EXISTS public.community_post_tags (
  post_id uuid NOT NULL REFERENCES public.community_posts (id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, tag),
  CONSTRAINT community_post_tags_normalized_check
    CHECK (tag = lower(btrim(tag)) AND char_length(tag) BETWEEN 1 AND 24)
);

CREATE INDEX IF NOT EXISTS community_post_tags_tag_post_idx
  ON public.community_post_tags (tag, post_id);

CREATE TABLE IF NOT EXISTS public.community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts (id) ON DELETE CASCADE,
  reporter_user_id text NOT NULL REFERENCES public."user" (id),
  reason text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  CONSTRAINT community_reports_reason_check
    CHECK (reason IN ('inappropriate', 'copyright', 'privacy', 'spam', 'other')),
  CONSTRAINT community_reports_detail_check
    CHECK (detail IS NULL OR char_length(detail) BETWEEN 1 AND 500),
  CONSTRAINT community_reports_status_check
    CHECK (status IN ('pending', 'resolved', 'dismissed')),
  CONSTRAINT community_reports_resolution_check
    CHECK ((status = 'pending') = (resolved_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS community_reports_pending_unique
  ON public.community_reports (post_id, reporter_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS community_reports_status_created_idx
  ON public.community_reports (status, created_at ASC, id ASC);

COMMENT ON TABLE public.community_posts IS
  'User-submitted image posts with manual moderation state.';
COMMENT ON TABLE public.community_post_tags IS
  'Normalized tags attached to community posts.';
COMMENT ON TABLE public.community_reports IS
  'User reports for published community posts.';
