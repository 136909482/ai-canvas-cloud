CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    category text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    created_by_admin_id text NOT NULL,
    updated_by_admin_id text NOT NULL,
    published_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT announcements_category_check CHECK (category = ANY (ARRAY['notice'::text, 'product_update'::text, 'maintenance'::text])),
    CONSTRAINT announcements_status_check CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])),
    CONSTRAINT announcements_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT announcements_content_check CHECK (char_length(content) BETWEEN 1 AND 4000),
    CONSTRAINT announcements_lifecycle_check CHECK (
      (status = 'draft' AND published_at IS NULL AND archived_at IS NULL)
      OR (status = 'published' AND published_at IS NOT NULL AND archived_at IS NULL)
      OR (status = 'archived' AND published_at IS NOT NULL AND archived_at IS NOT NULL)
    )
);

CREATE INDEX announcements_timeline_idx
ON public.announcements (published_at DESC, id DESC)
WHERE status = 'published';

CREATE TABLE public.announcement_receipts (
    announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    read_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX announcement_receipts_user_read_idx
ON public.announcement_receipts (user_id, read_at DESC);
