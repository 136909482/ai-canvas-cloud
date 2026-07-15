CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_email_unique UNIQUE (email),
  CONSTRAINT user_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT user_status_check CHECK (status IN ('active', 'disabled', 'deleted'))
);

CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  CONSTRAINT session_token_unique UNIQUE (token),
  CONSTRAINT session_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS session_user_id_idx
  ON "session"(user_id);

CREATE TABLE IF NOT EXISTS "account" (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_user_id_idx
  ON "account"(user_id);

CREATE TABLE IF NOT EXISTS "verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx
  ON "verification"(identifier);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'personal',
  name text NOT NULL,
  owner_user_id text NOT NULL REFERENCES "user"(id),
  status text NOT NULL DEFAULT 'active',
  plan_key text NOT NULL DEFAULT 'free',
  storage_quota_bytes bigint NOT NULL DEFAULT 0,
  task_quota_monthly integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_type_check CHECK (type IN ('personal', 'team')),
  CONSTRAINT workspaces_status_check CHECK (status IN ('active', 'disabled', 'deleted')),
  CONSTRAINT workspaces_storage_quota_nonnegative CHECK (storage_quota_bytes >= 0),
  CONSTRAINT workspaces_task_quota_nonnegative CHECK (task_quota_monthly >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_personal_owner_unique
  ON workspaces(owner_user_id)
  WHERE type = 'personal' AND status <> 'deleted';

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id text NOT NULL REFERENCES "user"(id),
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_members_role_check CHECK (role IN ('owner', 'admin', 'editor', 'viewer'))
);

CREATE INDEX IF NOT EXISTS workspace_members_user_id_idx
  ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_user_state (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id text NOT NULL REFERENCES "user"(id),
  last_opened_project_id uuid,
  active_project_id uuid,
  ui_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_user_state_member_fk FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members(workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text REFERENCES "user"(id),
  workspace_id uuid REFERENCES workspaces(id),
  event_type text NOT NULL,
  request_id text,
  ip_hash text,
  user_agent_hash text,
  result text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_audit_events_result_check CHECK (result IN ('success', 'failure'))
);

CREATE INDEX IF NOT EXISTS auth_audit_events_user_created_idx
  ON auth_audit_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_audit_events_workspace_created_idx
  ON auth_audit_events(workspace_id, created_at DESC);
