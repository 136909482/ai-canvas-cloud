--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: admin; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA admin;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: reject_audit_event_mutation(); Type: FUNCTION; Schema: admin; Owner: -
--

CREATE FUNCTION admin.reject_audit_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'admin audit events are append-only' USING ERRCODE = '55000';
END;
$$;


--
-- Name: reject_object_storage_config_revision_mutation(); Type: FUNCTION; Schema: admin; Owner: -
--

CREATE FUNCTION admin.reject_object_storage_config_revision_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Object storage configuration revisions are immutable' USING ERRCODE = '55000';
END;
$$;


--
-- Name: reject_site_config_revision_mutation(); Type: FUNCTION; Schema: admin; Owner: -
--

CREATE FUNCTION admin.reject_site_config_revision_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'site configuration revisions are immutable' USING ERRCODE = '55000';
END;
$$;


--
-- Name: reject_smtp_config_revision_mutation(); Type: FUNCTION; Schema: admin; Owner: -
--

CREATE FUNCTION admin.reject_smtp_config_revision_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'SMTP configuration revisions are immutable' USING ERRCODE = '55000';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id text,
    admin_role text,
    action text NOT NULL,
    target_type text,
    target_id text,
    result text NOT NULL,
    request_id text NOT NULL,
    ip_hash text,
    user_agent_hash text,
    before_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    after_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_audit_after_object_check CHECK ((jsonb_typeof(after_json) = 'object'::text)),
    CONSTRAINT admin_audit_before_object_check CHECK ((jsonb_typeof(before_json) = 'object'::text)),
    CONSTRAINT admin_audit_ip_hash_check CHECK (((ip_hash IS NULL) OR (ip_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT admin_audit_request_id_check CHECK (((char_length(request_id) >= 1) AND (char_length(request_id) <= 128))),
    CONSTRAINT admin_audit_result_check CHECK ((result = ANY (ARRAY['success'::text, 'failure'::text]))),
    CONSTRAINT admin_audit_role_check CHECK (((admin_role IS NULL) OR (admin_role = ANY (ARRAY['super_admin'::text, 'operator'::text, 'support'::text, 'auditor'::text])))),
    CONSTRAINT admin_audit_user_agent_hash_check CHECK (((user_agent_hash IS NULL) OR (user_agent_hash ~ '^[0-9a-f]{64}$'::text)))
);


--
-- Name: login_captcha_challenges; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.login_captcha_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code_hash text NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_login_captcha_expiry_check CHECK ((expires_at > created_at)),
    CONSTRAINT admin_login_captcha_failed_attempts_check CHECK (((failed_attempts >= 0) AND (failed_attempts <= 5))),
    CONSTRAINT admin_login_captcha_hash_check CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: login_security_settings; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.login_security_settings (
    singleton_id smallint DEFAULT 1 NOT NULL,
    captcha_enabled boolean DEFAULT false NOT NULL,
    updated_by_admin_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_login_security_settings_singleton_check CHECK ((singleton_id = 1))
);


--
-- Name: object_storage_config_current; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.object_storage_config_current (
    singleton_id smallint DEFAULT 1 NOT NULL,
    revision_id uuid NOT NULL,
    updated_by_admin_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_object_storage_config_current_singleton_check CHECK ((singleton_id = 1))
);


--
-- Name: object_storage_config_revisions; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.object_storage_config_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    endpoint text NOT NULL,
    public_endpoint text NOT NULL,
    public_origin text NOT NULL,
    region text NOT NULL,
    bucket text NOT NULL,
    force_path_style boolean NOT NULL,
    encrypted_credentials_json jsonb NOT NULL,
    key_version integer NOT NULL,
    created_by_admin_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_object_storage_bucket_check CHECK (((bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'::text) AND (POSITION(('..'::text) IN (bucket)) = 0))),
    CONSTRAINT admin_object_storage_endpoint_check CHECK (((char_length(endpoint) >= 8) AND (char_length(endpoint) <= 2048))),
    CONSTRAINT admin_object_storage_envelope_check CHECK (((jsonb_typeof(encrypted_credentials_json) = 'object'::text) AND (encrypted_credentials_json ?& ARRAY['algorithm'::text, 'keyVersion'::text, 'iv'::text, 'ciphertext'::text, 'authTag'::text]) AND ((encrypted_credentials_json ->> 'algorithm'::text) = 'aes-256-gcm'::text) AND (((encrypted_credentials_json ->> 'keyVersion'::text))::integer = key_version))),
    CONSTRAINT admin_object_storage_key_version_check CHECK ((key_version > 0)),
    CONSTRAINT admin_object_storage_public_endpoint_check CHECK (((char_length(public_endpoint) >= 8) AND (char_length(public_endpoint) <= 2048))),
    CONSTRAINT admin_object_storage_public_origin_check CHECK (((char_length(public_origin) >= 8) AND (char_length(public_origin) <= 2048))),
    CONSTRAINT admin_object_storage_region_check CHECK ((region ~ '^[a-z0-9][a-z0-9-]{0,62}$'::text))
);


--
-- Name: object_storage_test_attempts; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.object_storage_test_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id text NOT NULL,
    result text DEFAULT 'pending'::text NOT NULL,
    failure_category text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT admin_object_storage_test_completion_check CHECK ((((result = 'pending'::text) AND (completed_at IS NULL)) OR ((result = ANY (ARRAY['success'::text, 'failure'::text])) AND (completed_at IS NOT NULL)))),
    CONSTRAINT admin_object_storage_test_result_check CHECK ((result = ANY (ARRAY['pending'::text, 'success'::text, 'failure'::text])))
);


--
-- Name: session; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.session (
    id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL,
    CONSTRAINT admin_session_expiry_check CHECK ((expires_at > created_at))
);


--
-- Name: site_assets; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.site_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_kind text NOT NULL,
    object_key text NOT NULL,
    original_file_name text NOT NULL,
    mime_type text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint text NOT NULL,
    uploaded_by_admin_id text NOT NULL,
    upload_expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT admin_site_assets_byte_size_check CHECK (((byte_size >= 1) AND (byte_size <= 4194304))),
    CONSTRAINT admin_site_assets_completion_check CHECK ((((status = 'completed'::text) AND (completed_at IS NOT NULL) AND (deleted_at IS NULL)) OR ((status = 'deleted'::text) AND (deleted_at IS NOT NULL)) OR ((status = ANY (ARRAY['pending'::text, 'failed'::text])) AND (completed_at IS NULL) AND (deleted_at IS NULL)))),
    CONSTRAINT admin_site_assets_dimensions_check CHECK ((((width >= 1) AND (width <= 4096)) AND ((height >= 1) AND (height <= 4096)))),
    CONSTRAINT admin_site_assets_fingerprint_check CHECK ((request_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT admin_site_assets_idempotency_check CHECK (((char_length(idempotency_key) >= 8) AND (char_length(idempotency_key) <= 200))),
    CONSTRAINT admin_site_assets_kind_check CHECK ((asset_kind = ANY (ARRAY['logo'::text, 'favicon'::text]))),
    CONSTRAINT admin_site_assets_mime_check CHECK ((mime_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text, 'image/x-icon'::text]))),
    CONSTRAINT admin_site_assets_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT admin_site_assets_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'deleted'::text])))
);


--
-- Name: site_config_current; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.site_config_current (
    singleton_id smallint DEFAULT 1 NOT NULL,
    revision_id uuid NOT NULL,
    updated_by_admin_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_site_config_current_singleton_check CHECK ((singleton_id = 1))
);


--
-- Name: site_config_revisions; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.site_config_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schema_version integer NOT NULL,
    config_json jsonb NOT NULL,
    note text,
    created_by_admin_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_site_config_json_object_check CHECK ((jsonb_typeof(config_json) = 'object'::text)),
    CONSTRAINT admin_site_config_note_check CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 500)))),
    CONSTRAINT admin_site_config_schema_version_check CHECK ((schema_version = ANY (ARRAY[1, 2])))
);


--
-- Name: smtp_config_current; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.smtp_config_current (
    singleton_id smallint DEFAULT 1 NOT NULL,
    revision_id uuid NOT NULL,
    updated_by_admin_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_smtp_config_current_singleton_check CHECK ((singleton_id = 1))
);


--
-- Name: smtp_config_revisions; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.smtp_config_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled boolean NOT NULL,
    host text NOT NULL,
    port integer NOT NULL,
    security_mode text NOT NULL,
    username text NOT NULL,
    encrypted_password_json jsonb NOT NULL,
    key_version integer NOT NULL,
    from_email text NOT NULL,
    from_name text NOT NULL,
    created_by_admin_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_smtp_config_envelope_check CHECK (((jsonb_typeof(encrypted_password_json) = 'object'::text) AND (encrypted_password_json ?& ARRAY['algorithm'::text, 'keyVersion'::text, 'iv'::text, 'ciphertext'::text, 'authTag'::text]) AND ((encrypted_password_json ->> 'algorithm'::text) = 'aes-256-gcm'::text) AND (((encrypted_password_json ->> 'keyVersion'::text))::integer = key_version))),
    CONSTRAINT admin_smtp_config_from_email_check CHECK (((char_length(from_email) >= 3) AND (char_length(from_email) <= 320))),
    CONSTRAINT admin_smtp_config_from_name_check CHECK (((char_length(from_name) >= 1) AND (char_length(from_name) <= 100))),
    CONSTRAINT admin_smtp_config_host_check CHECK (((char_length(host) >= 1) AND (char_length(host) <= 253))),
    CONSTRAINT admin_smtp_config_key_version_check CHECK ((key_version > 0)),
    CONSTRAINT admin_smtp_config_port_check CHECK ((port = ANY (ARRAY[25, 465, 587, 2525]))),
    CONSTRAINT admin_smtp_config_security_check CHECK ((security_mode = ANY (ARRAY['implicit_tls'::text, 'starttls'::text]))),
    CONSTRAINT admin_smtp_config_username_check CHECK (((char_length(username) >= 1) AND (char_length(username) <= 320)))
);


--
-- Name: smtp_test_attempts; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.smtp_test_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id text NOT NULL,
    test_kind text NOT NULL,
    result text DEFAULT 'pending'::text NOT NULL,
    failure_category text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT admin_smtp_test_completion_check CHECK ((((result = 'pending'::text) AND (completed_at IS NULL)) OR ((result = ANY (ARRAY['success'::text, 'failure'::text])) AND (completed_at IS NOT NULL)))),
    CONSTRAINT admin_smtp_test_kind_check CHECK ((test_kind = ANY (ARRAY['connection'::text, 'email'::text]))),
    CONSTRAINT admin_smtp_test_result_check CHECK ((result = ANY (ARRAY['pending'::text, 'success'::text, 'failure'::text])))
);


--
-- Name: two_factor; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.two_factor (
    id text NOT NULL,
    secret text NOT NULL,
    backup_codes text NOT NULL,
    user_id text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    failed_verification_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    CONSTRAINT admin_two_factor_failed_count_check CHECK ((failed_verification_count >= 0))
);


--
-- Name: user; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT true NOT NULL,
    image text,
    role text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    two_factor_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    username text NOT NULL,
    display_username text NOT NULL,
    CONSTRAINT admin_user_display_username_format_check CHECK ((display_username ~ '^[A-Za-z0-9_.]{3,30}$'::text)),
    CONSTRAINT admin_user_email_lowercase CHECK ((email = lower(email))),
    CONSTRAINT admin_user_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'operator'::text, 'support'::text, 'auditor'::text]))),
    CONSTRAINT admin_user_status_check CHECK ((status = ANY (ARRAY['active'::text, 'banned'::text]))),
    CONSTRAINT admin_user_username_format_check CHECK (((username = lower(username)) AND (username ~ '^[a-z0-9_.]{3,30}$'::text)))
);


--
-- Name: verification; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_verification_expiry_check CHECK ((expires_at > created_at))
);


--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: account_erasure_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_erasure_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    personal_workspace_ids jsonb NOT NULL,
    purge_after timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error_code text,
    locked_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_erasure_jobs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT account_erasure_jobs_completed_state_check CHECK ((((status = 'completed'::text) AND (completed_at IS NOT NULL)) OR ((status <> 'completed'::text) AND (completed_at IS NULL)))),
    CONSTRAINT account_erasure_jobs_purge_after_check CHECK ((purge_after >= created_at)),
    CONSTRAINT account_erasure_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text]))),
    CONSTRAINT account_erasure_jobs_workspace_ids_array CHECK ((jsonb_typeof(personal_workspace_ids) = 'array'::text))
);


--
-- Name: asset_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    project_id uuid NOT NULL,
    node_id text NOT NULL,
    reference_role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_references_node_id_check CHECK (((node_id IS NULL) OR ((char_length(node_id) >= 1) AND (char_length(node_id) <= 128)))),
    CONSTRAINT asset_references_role_check CHECK ((reference_role = ANY (ARRAY['source'::text, 'result'::text, 'thumbnail'::text, 'preview'::text, 'mask'::text, 'attachment'::text])))
);


--
-- Name: asset_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    asset_id uuid NOT NULL,
    created_by_user_id text NOT NULL,
    object_key text NOT NULL,
    original_file_name text NOT NULL,
    expected_mime_type text NOT NULL,
    expected_byte_size bigint NOT NULL,
    expected_sha256 text,
    asset_kind text NOT NULL,
    idempotency_key text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_uploads_asset_kind_check CHECK ((asset_kind = ANY (ARRAY['upload'::text, 'generated'::text, 'edit'::text, 'crop'::text, 'thumbnail'::text, 'preview'::text, 'video'::text]))),
    CONSTRAINT asset_uploads_byte_size_positive CHECK ((expected_byte_size > 0)),
    CONSTRAINT asset_uploads_completed_status_check CHECK ((((completed_at IS NULL) AND (status <> 'completed'::text)) OR ((completed_at IS NOT NULL) AND (status = 'completed'::text)))),
    CONSTRAINT asset_uploads_expiry_after_created CHECK ((expires_at > created_at)),
    CONSTRAINT asset_uploads_file_name_check CHECK (((char_length(btrim(original_file_name)) >= 1) AND (char_length(btrim(original_file_name)) <= 255))),
    CONSTRAINT asset_uploads_idempotency_key_check CHECK (((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200))),
    CONSTRAINT asset_uploads_mime_type_check CHECK (((char_length(btrim(expected_mime_type)) >= 3) AND (char_length(btrim(expected_mime_type)) <= 120))),
    CONSTRAINT asset_uploads_object_key_check CHECK ((((char_length(object_key) >= 16) AND (char_length(object_key) <= 512)) AND (object_key !~ '[[:space:]]'::text) AND (object_key !~* '(^|/)[.]{1,2}(/|$)'::text))),
    CONSTRAINT asset_uploads_sha256_check CHECK (((expected_sha256 IS NULL) OR (expected_sha256 ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT asset_uploads_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'expired'::text, 'failed'::text])))
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    origin_project_id uuid,
    created_by_user_id text NOT NULL,
    object_key text NOT NULL,
    original_file_name text,
    mime_type text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text,
    width integer,
    height integer,
    asset_kind text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assets_asset_kind_check CHECK ((asset_kind = ANY (ARRAY['upload'::text, 'generated'::text, 'edit'::text, 'crop'::text, 'thumbnail'::text, 'preview'::text, 'video'::text]))),
    CONSTRAINT assets_byte_size_positive CHECK ((byte_size > 0)),
    CONSTRAINT assets_deleted_after_created CHECK (((deleted_at IS NULL) OR (deleted_at >= created_at))),
    CONSTRAINT assets_deleted_status_check CHECK (((deleted_at IS NULL) OR (status = 'deleted'::text))),
    CONSTRAINT assets_height_positive CHECK (((height IS NULL) OR (height > 0))),
    CONSTRAINT assets_mime_type_check CHECK (((char_length(btrim(mime_type)) >= 3) AND (char_length(btrim(mime_type)) <= 120))),
    CONSTRAINT assets_object_key_check CHECK ((((char_length(object_key) >= 16) AND (char_length(object_key) <= 512)) AND (object_key !~ '[[:space:]]'::text) AND (object_key !~* '(^|/)[.]{1,2}(/|$)'::text))),
    CONSTRAINT assets_original_file_name_check CHECK (((original_file_name IS NULL) OR ((char_length(btrim(original_file_name)) >= 1) AND (char_length(btrim(original_file_name)) <= 255)))),
    CONSTRAINT assets_sha256_check CHECK (((sha256 IS NULL) OR (sha256 ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT assets_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'quarantined'::text, 'deleted'::text]))),
    CONSTRAINT assets_width_positive CHECK (((width IS NULL) OR (width > 0)))
);


--
-- Name: auth_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text,
    workspace_id uuid,
    event_type text NOT NULL,
    request_id text,
    ip_hash text,
    user_agent_hash text,
    result text NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_audit_events_result_check CHECK ((result = ANY (ARRAY['success'::text, 'failure'::text])))
);


--
-- Name: auth_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    device_key text NOT NULL,
    user_agent text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_session_id text,
    CONSTRAINT auth_devices_device_key_check CHECK (((char_length(device_key) >= 1) AND (char_length(device_key) <= 128))),
    CONSTRAINT auth_devices_seen_order_check CHECK ((last_seen_at >= first_seen_at)),
    CONSTRAINT auth_devices_user_agent_check CHECK (((user_agent IS NULL) OR (char_length(user_agent) <= 2048)))
);


--
-- Name: generation_telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_telemetry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    client_attempt_id uuid NOT NULL,
    category text NOT NULL,
    status text NOT NULL,
    failure_category text,
    result_count integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generation_telemetry_category_check CHECK ((category = ANY (ARRAY['text'::text, 'image'::text, 'video'::text]))),
    CONSTRAINT generation_telemetry_duration_check CHECK (((duration_ms IS NULL) OR ((duration_ms >= 0) AND (duration_ms <= 86400000)))),
    CONSTRAINT generation_telemetry_failure_category_check CHECK (((failure_category IS NULL) OR (failure_category = ANY (ARRAY['network'::text, 'authentication'::text, 'rate_limited'::text, 'upstream'::text, 'invalid_response'::text, 'asset_upload'::text, 'unknown'::text])))),
    CONSTRAINT generation_telemetry_result_count_check CHECK (((result_count >= 0) AND (result_count <= 32))),
    CONSTRAINT generation_telemetry_state_check CHECK ((((status = 'started'::text) AND (failure_category IS NULL) AND (result_count = 0) AND (duration_ms IS NULL) AND (completed_at IS NULL)) OR ((status = 'succeeded'::text) AND (failure_category IS NULL) AND ((result_count >= 1) AND (result_count <= 32)) AND (duration_ms IS NOT NULL) AND (completed_at IS NOT NULL)) OR ((status = 'failed'::text) AND (failure_category IS NOT NULL) AND (result_count = 0) AND (duration_ms IS NOT NULL) AND (completed_at IS NOT NULL)) OR ((status = 'canceled'::text) AND (failure_category IS NULL) AND (result_count = 0) AND (duration_ms IS NOT NULL) AND (completed_at IS NOT NULL)))),
    CONSTRAINT generation_telemetry_status_check CHECK ((status = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text]))),
    CONSTRAINT generation_telemetry_time_order_check CHECK (((updated_at >= created_at) AND ((completed_at IS NULL) OR (completed_at >= started_at))))
);


--
-- Name: migration_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    created_by_user_id text NOT NULL,
    project_id uuid NOT NULL,
    idempotency_key character varying(200) NOT NULL,
    request_fingerprint character(64) NOT NULL,
    status character varying(16) DEFAULT 'prepared'::character varying NOT NULL,
    project_name text NOT NULL,
    project_version bigint NOT NULL,
    project_sequence bigint NOT NULL,
    file_count integer NOT NULL,
    completed_file_count integer DEFAULT 0 NOT NULL,
    total_bytes bigint NOT NULL,
    completed_bytes bigint DEFAULT 0 NOT NULL,
    manifest_json jsonb NOT NULL,
    project_record_json jsonb NOT NULL,
    graph_json jsonb NOT NULL,
    asset_manifest_json jsonb NOT NULL,
    checkpoint_json jsonb,
    export_assets_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    archive_object_key text,
    archive_byte_size bigint,
    archive_sha256 character(64),
    error_code character varying(80),
    error_message text,
    cancel_requested_at timestamp with time zone,
    canceled_at timestamp with time zone,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT migration_exports_archive_sha256_check CHECK (((archive_sha256 IS NULL) OR (archive_sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT migration_exports_archive_state_check CHECK (((((status)::text = 'completed'::text) AND (archive_object_key IS NOT NULL) AND (archive_byte_size IS NOT NULL) AND (archive_sha256 IS NOT NULL) AND (completed_at IS NOT NULL)) OR (((status)::text <> 'completed'::text) AND (completed_at IS NULL)))),
    CONSTRAINT migration_exports_counts_nonnegative CHECK (((file_count >= 1) AND (completed_file_count >= 0) AND (completed_file_count <= file_count) AND (total_bytes >= 0) AND (completed_bytes >= 0) AND (completed_bytes <= total_bytes))),
    CONSTRAINT migration_exports_error_state_check CHECK (((((status)::text = 'failed'::text) AND (error_code IS NOT NULL) AND (error_message IS NOT NULL)) OR (((status)::text <> 'failed'::text) OR ((error_code IS NOT NULL) AND (error_message IS NOT NULL))))),
    CONSTRAINT migration_exports_fingerprint_check CHECK ((request_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT migration_exports_idempotency_key_check CHECK (((char_length(btrim((idempotency_key)::text)) >= 1) AND (char_length(btrim((idempotency_key)::text)) <= 200))),
    CONSTRAINT migration_exports_payload_object_check CHECK (((jsonb_typeof(manifest_json) = 'object'::text) AND (jsonb_typeof(project_record_json) = 'object'::text) AND (jsonb_typeof(graph_json) = 'object'::text) AND (jsonb_typeof(asset_manifest_json) = 'object'::text) AND (jsonb_typeof(export_assets_json) = 'array'::text) AND ((checkpoint_json IS NULL) OR (jsonb_typeof(checkpoint_json) = 'object'::text)))),
    CONSTRAINT migration_exports_retry_count_check CHECK ((retry_count >= 0)),
    CONSTRAINT migration_exports_status_check CHECK (((status)::text = ANY ((ARRAY['prepared'::character varying, 'generating'::character varying, 'completed'::character varying, 'failed'::character varying, 'canceled'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT migration_exports_terminal_time_check CHECK (((canceled_at IS NULL) OR ((status)::text = 'canceled'::text))),
    CONSTRAINT migration_exports_versions_nonnegative CHECK (((project_version >= 0) AND (project_sequence >= 0)))
);


--
-- Name: migration_import_asset_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_import_asset_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    import_id uuid NOT NULL,
    logical_asset_id character varying(128) NOT NULL,
    object_key text NOT NULL,
    provider_upload_id text,
    upload_mode character varying(16) NOT NULL,
    part_size bigint NOT NULL,
    part_count integer NOT NULL,
    completed_parts_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    expected_file_path character varying(512) NOT NULL,
    expected_original_file_name character varying(255),
    expected_mime_type character varying(120) NOT NULL,
    expected_byte_size bigint NOT NULL,
    expected_sha256 character(64) NOT NULL,
    expected_width integer,
    expected_height integer,
    expected_asset_kind character varying(32) NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    uploaded_byte_size bigint DEFAULT 0 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error_code character varying(80),
    error_message character varying(500),
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    canceled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_asset_id uuid,
    CONSTRAINT migration_import_asset_uploads_asset_kind_check CHECK (((expected_asset_kind)::text = ANY ((ARRAY['upload'::character varying, 'generated'::character varying, 'edit'::character varying, 'crop'::character varying, 'thumbnail'::character varying, 'preview'::character varying, 'video'::character varying])::text[]))),
    CONSTRAINT migration_import_asset_uploads_byte_size_check CHECK (((expected_byte_size > 0) AND (uploaded_byte_size >= 0) AND (uploaded_byte_size <= expected_byte_size))),
    CONSTRAINT migration_import_asset_uploads_canceled_state_check CHECK (((((status)::text = 'canceled'::text) AND (canceled_at IS NOT NULL)) OR (((status)::text <> 'canceled'::text) AND (canceled_at IS NULL)))),
    CONSTRAINT migration_import_asset_uploads_committed_state_check CHECK (((committed_asset_id IS NULL) OR ((status)::text = 'completed'::text))),
    CONSTRAINT migration_import_asset_uploads_completed_parts_json_check CHECK ((jsonb_typeof(completed_parts_json) = 'array'::text)),
    CONSTRAINT migration_import_asset_uploads_completed_state_check CHECK (((((status)::text = 'completed'::text) AND (completed_at IS NOT NULL)) OR (((status)::text <> 'completed'::text) AND (completed_at IS NULL)))),
    CONSTRAINT migration_import_asset_uploads_counts_check CHECK ((retry_count >= 0)),
    CONSTRAINT migration_import_asset_uploads_dimensions_check CHECK ((((expected_width IS NULL) AND (expected_height IS NULL)) OR ((expected_width > 0) AND (expected_height > 0)))),
    CONSTRAINT migration_import_asset_uploads_error_state_check CHECK (((((status)::text = 'failed'::text) AND (error_code IS NOT NULL) AND (error_message IS NOT NULL)) OR (((status)::text <> 'failed'::text) AND (error_code IS NULL) AND (error_message IS NULL)))),
    CONSTRAINT migration_import_asset_uploads_expiry_check CHECK ((expires_at > created_at)),
    CONSTRAINT migration_import_asset_uploads_file_name_check CHECK (((expected_original_file_name IS NULL) OR ((char_length(btrim((expected_original_file_name)::text)) >= 1) AND (char_length(btrim((expected_original_file_name)::text)) <= 255)))),
    CONSTRAINT migration_import_asset_uploads_file_path_check CHECK (((char_length(btrim((expected_file_path)::text)) >= 1) AND (char_length(btrim((expected_file_path)::text)) <= 512))),
    CONSTRAINT migration_import_asset_uploads_logical_id_check CHECK (((logical_asset_id)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text)),
    CONSTRAINT migration_import_asset_uploads_mime_check CHECK (((char_length(btrim((expected_mime_type)::text)) >= 3) AND (char_length(btrim((expected_mime_type)::text)) <= 120))),
    CONSTRAINT migration_import_asset_uploads_mode_check CHECK (((upload_mode)::text = ANY ((ARRAY['single'::character varying, 'multipart'::character varying])::text[]))),
    CONSTRAINT migration_import_asset_uploads_mode_parts_check CHECK (((((upload_mode)::text = 'single'::text) AND (provider_upload_id IS NULL) AND (part_count = 1)) OR (((upload_mode)::text = 'multipart'::text) AND (provider_upload_id IS NOT NULL) AND (part_count > 1)))),
    CONSTRAINT migration_import_asset_uploads_object_key_check CHECK ((((char_length(object_key) >= 16) AND (char_length(object_key) <= 512)) AND (object_key !~ '[[:space:]]'::text) AND (object_key !~* '(^|/)[.]{1,2}(/|$)'::text) AND (object_key ~~ 'workspaces/%/migration-imports/%'::text))),
    CONSTRAINT migration_import_asset_uploads_part_count_check CHECK (((part_count >= 1) AND (part_count <= 10000))),
    CONSTRAINT migration_import_asset_uploads_part_size_check CHECK ((part_size > 0)),
    CONSTRAINT migration_import_asset_uploads_provider_id_check CHECK (((provider_upload_id IS NULL) OR ((char_length(provider_upload_id) >= 1) AND (char_length(provider_upload_id) <= 512)))),
    CONSTRAINT migration_import_asset_uploads_sha256_check CHECK ((expected_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT migration_import_asset_uploads_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'uploading'::character varying, 'validating'::character varying, 'completed'::character varying, 'failed'::character varying, 'canceled'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT migration_import_asset_uploads_updated_check CHECK ((updated_at >= created_at))
);


--
-- Name: migration_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    created_by_user_id text NOT NULL,
    package_schema_version integer NOT NULL,
    package_id character varying(128) NOT NULL,
    source_platform character varying(32) NOT NULL,
    source_project_id character varying(128) NOT NULL,
    source_project_version bigint NOT NULL,
    source_project_sequence bigint NOT NULL,
    project_name character varying(160) NOT NULL,
    request_fingerprint character(64) NOT NULL,
    content_sha256 character(64) NOT NULL,
    idempotency_key character varying(200) NOT NULL,
    status character varying(32) DEFAULT 'prepared'::character varying NOT NULL,
    conflict_type character varying(32) DEFAULT 'none'::character varying NOT NULL,
    target_project_id uuid,
    target_project_name character varying(160),
    target_expected_version bigint,
    target_expected_sequence bigint,
    target_archived_at timestamp with time zone,
    asset_count integer NOT NULL,
    total_file_count integer NOT NULL,
    completed_file_count integer DEFAULT 0 NOT NULL,
    total_bytes bigint NOT NULL,
    completed_bytes bigint DEFAULT 0 NOT NULL,
    estimated_storage_bytes bigint NOT NULL,
    available_bytes_at_prepare bigint NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error_code character varying(80),
    error_message character varying(500),
    manifest_json jsonb NOT NULL,
    project_record_json jsonb NOT NULL,
    graph_json jsonb NOT NULL,
    asset_manifest_json jsonb NOT NULL,
    checkpoint_json jsonb,
    cancel_requested_at timestamp with time zone,
    canceled_at timestamp with time zone,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    commit_idempotency_key character varying(200),
    commit_request_fingerprint character(64),
    commit_strategy character varying(16),
    committed_project_id uuid,
    committed_at timestamp with time zone,
    CONSTRAINT migration_imports_asset_manifest_object_check CHECK ((jsonb_typeof(asset_manifest_json) = 'object'::text)),
    CONSTRAINT migration_imports_bytes_nonnegative CHECK (((total_bytes >= 0) AND (completed_bytes >= 0) AND (completed_bytes <= total_bytes) AND (estimated_storage_bytes >= 0) AND (available_bytes_at_prepare >= 0))),
    CONSTRAINT migration_imports_canceled_state_check CHECK (((((status)::text = 'canceled'::text) AND (canceled_at IS NOT NULL)) OR (((status)::text <> 'canceled'::text) AND (canceled_at IS NULL)))),
    CONSTRAINT migration_imports_checkpoint_object_check CHECK (((checkpoint_json IS NULL) OR (jsonb_typeof(checkpoint_json) = 'object'::text))),
    CONSTRAINT migration_imports_commit_fingerprint_check CHECK (((commit_request_fingerprint IS NULL) OR (commit_request_fingerprint ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT migration_imports_commit_key_check CHECK (((commit_idempotency_key IS NULL) OR ((char_length(btrim((commit_idempotency_key)::text)) >= 1) AND (char_length(btrim((commit_idempotency_key)::text)) <= 200)))),
    CONSTRAINT migration_imports_commit_state_check CHECK (((((status)::text = 'completed'::text) AND (commit_idempotency_key IS NOT NULL) AND (commit_request_fingerprint IS NOT NULL) AND (commit_strategy IS NOT NULL) AND (committed_project_id IS NOT NULL) AND (committed_at IS NOT NULL)) OR (((status)::text <> 'completed'::text) AND (committed_at IS NULL)))),
    CONSTRAINT migration_imports_commit_strategy_check CHECK (((commit_strategy IS NULL) OR ((commit_strategy)::text = ANY ((ARRAY['copy'::character varying, 'replace'::character varying])::text[])))),
    CONSTRAINT migration_imports_completed_state_check CHECK (((((status)::text = 'completed'::text) AND (completed_at IS NOT NULL)) OR (((status)::text <> 'completed'::text) AND (completed_at IS NULL)))),
    CONSTRAINT migration_imports_conflict_target_check CHECK (((((conflict_type)::text = 'project_exists'::text) AND (target_project_id IS NOT NULL) AND (target_project_name IS NOT NULL) AND (target_expected_version IS NOT NULL) AND (target_expected_sequence IS NOT NULL)) OR (((conflict_type)::text <> 'project_exists'::text) AND (target_project_id IS NULL) AND (target_project_name IS NULL) AND (target_expected_version IS NULL) AND (target_expected_sequence IS NULL) AND (target_archived_at IS NULL)))),
    CONSTRAINT migration_imports_conflict_type_check CHECK (((conflict_type)::text = ANY ((ARRAY['none'::character varying, 'project_exists'::character varying, 'project_id_unavailable'::character varying, 'source_id_incompatible'::character varying])::text[]))),
    CONSTRAINT migration_imports_content_sha256_check CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT migration_imports_counts_nonnegative CHECK (((asset_count >= 0) AND (total_file_count >= 0) AND (completed_file_count >= 0) AND (completed_file_count <= total_file_count) AND (retry_count >= 0))),
    CONSTRAINT migration_imports_error_state_check CHECK (((((status)::text = 'failed'::text) AND (error_code IS NOT NULL) AND (error_message IS NOT NULL)) OR (((status)::text <> 'failed'::text) AND (error_code IS NULL) AND (error_message IS NULL)))),
    CONSTRAINT migration_imports_expiry_check CHECK ((expires_at > created_at)),
    CONSTRAINT migration_imports_fingerprint_check CHECK ((request_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT migration_imports_graph_object_check CHECK ((jsonb_typeof(graph_json) = 'object'::text)),
    CONSTRAINT migration_imports_idempotency_key_check CHECK (((char_length(btrim((idempotency_key)::text)) >= 1) AND (char_length(btrim((idempotency_key)::text)) <= 200))),
    CONSTRAINT migration_imports_manifest_object_check CHECK ((jsonb_typeof(manifest_json) = 'object'::text)),
    CONSTRAINT migration_imports_package_id_check CHECK (((char_length(btrim((package_id)::text)) >= 1) AND (char_length(btrim((package_id)::text)) <= 128))),
    CONSTRAINT migration_imports_package_schema_check CHECK ((package_schema_version = 1)),
    CONSTRAINT migration_imports_project_name_check CHECK (((char_length(btrim((project_name)::text)) >= 1) AND (char_length(btrim((project_name)::text)) <= 160))),
    CONSTRAINT migration_imports_project_record_object_check CHECK ((jsonb_typeof(project_record_json) = 'object'::text)),
    CONSTRAINT migration_imports_source_platform_check CHECK (((source_platform)::text = ANY ((ARRAY['web'::character varying, 'electron'::character varying, 'cloud'::character varying])::text[]))),
    CONSTRAINT migration_imports_source_project_id_check CHECK (((char_length(btrim((source_project_id)::text)) >= 1) AND (char_length(btrim((source_project_id)::text)) <= 128))),
    CONSTRAINT migration_imports_status_check CHECK (((status)::text = ANY ((ARRAY['prepared'::character varying, 'uploading'::character varying, 'validating'::character varying, 'ready'::character varying, 'committing'::character varying, 'completed'::character varying, 'failed'::character varying, 'canceled'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT migration_imports_updated_check CHECK ((updated_at >= created_at)),
    CONSTRAINT migration_imports_versions_nonnegative CHECK (((source_project_version >= 0) AND (source_project_sequence >= 0) AND ((target_expected_version IS NULL) OR (target_expected_version >= 0)) AND ((target_expected_sequence IS NULL) OR (target_expected_sequence >= 0))))
);


--
-- Name: object_storage_config_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_storage_config_publications (
    singleton_id smallint DEFAULT 1 NOT NULL,
    revision_id uuid NOT NULL,
    endpoint text NOT NULL,
    public_endpoint text NOT NULL,
    public_origin text NOT NULL,
    region text NOT NULL,
    bucket text NOT NULL,
    force_path_style boolean NOT NULL,
    encrypted_credentials_json jsonb NOT NULL,
    key_version integer NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT object_storage_config_publications_envelope_check CHECK (((jsonb_typeof(encrypted_credentials_json) = 'object'::text) AND (encrypted_credentials_json ?& ARRAY['algorithm'::text, 'keyVersion'::text, 'iv'::text, 'ciphertext'::text, 'authTag'::text]) AND ((encrypted_credentials_json ->> 'algorithm'::text) = 'aes-256-gcm'::text) AND (((encrypted_credentials_json ->> 'keyVersion'::text))::integer = key_version))),
    CONSTRAINT object_storage_config_publications_key_version_check CHECK ((key_version > 0)),
    CONSTRAINT object_storage_config_publications_singleton_check CHECK ((singleton_id = 1))
);


--
-- Name: password_reset_email_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_email_challenges (
    email_hash text NOT NULL,
    code_hash text NOT NULL,
    reset_token_ciphertext text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_sent_at timestamp with time zone DEFAULT now() NOT NULL,
    failed_attempts smallint DEFAULT 0 NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT password_reset_email_challenges_attempts_check CHECK (((failed_attempts >= 0) AND (failed_attempts <= 5))),
    CONSTRAINT password_reset_email_challenges_ciphertext_check CHECK ((reset_token_ciphertext ~ '^[A-Za-z0-9_-]{40,}$'::text)),
    CONSTRAINT password_reset_email_challenges_code_hash_check CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT password_reset_email_challenges_email_hash_check CHECK ((email_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT password_reset_email_challenges_time_order_check CHECK (((expires_at > last_sent_at) AND (updated_at >= created_at)))
);


--
-- Name: project_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_changes (
    project_id uuid NOT NULL,
    sequence bigint NOT NULL,
    base_version bigint NOT NULL,
    result_version bigint NOT NULL,
    actor_user_id text,
    client_id text,
    batch_id text NOT NULL,
    idempotency_key text NOT NULL,
    source text NOT NULL,
    operations_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_changes_base_version_nonnegative CHECK ((base_version >= 0)),
    CONSTRAINT project_changes_batch_id_check CHECK (((char_length(batch_id) >= 1) AND (char_length(batch_id) <= 160))),
    CONSTRAINT project_changes_idempotency_key_check CHECK (((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 200))),
    CONSTRAINT project_changes_operations_array CHECK ((jsonb_typeof(operations_json) = 'array'::text)),
    CONSTRAINT project_changes_result_version_forward CHECK ((result_version > base_version)),
    CONSTRAINT project_changes_sequence_positive CHECK ((sequence > 0)),
    CONSTRAINT project_changes_source_check CHECK ((source = ANY (ARRAY['user'::text, 'import'::text, 'restore'::text, 'system'::text]))),
    CONSTRAINT project_changes_user_actor_check CHECK (((source <> 'user'::text) OR (actor_user_id IS NOT NULL)))
);


--
-- Name: project_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_edges (
    project_id uuid NOT NULL,
    edge_id text NOT NULL,
    source_node_id text NOT NULL,
    target_node_id text NOT NULL,
    source_handle text,
    target_handle text,
    edge_type text,
    row_version bigint DEFAULT 1 NOT NULL,
    data_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_edges_data_json_object CHECK ((jsonb_typeof(data_json) = 'object'::text)),
    CONSTRAINT project_edges_edge_id_check CHECK (((char_length(edge_id) >= 1) AND (char_length(edge_id) <= 128))),
    CONSTRAINT project_edges_row_version_positive CHECK ((row_version > 0)),
    CONSTRAINT project_edges_source_node_id_check CHECK (((char_length(source_node_id) >= 1) AND (char_length(source_node_id) <= 128))),
    CONSTRAINT project_edges_target_node_id_check CHECK (((char_length(target_node_id) >= 1) AND (char_length(target_node_id) <= 128)))
);


--
-- Name: project_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_nodes (
    project_id uuid NOT NULL,
    node_id text NOT NULL,
    node_type text NOT NULL,
    position_x double precision NOT NULL,
    position_y double precision NOT NULL,
    width double precision,
    height double precision,
    z_index integer DEFAULT 0 NOT NULL,
    parent_node_id text,
    row_version bigint DEFAULT 1 NOT NULL,
    data_schema_version integer DEFAULT 1 NOT NULL,
    data_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    presentation_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_nodes_data_json_object CHECK ((jsonb_typeof(data_json) = 'object'::text)),
    CONSTRAINT project_nodes_data_schema_version_positive CHECK ((data_schema_version > 0)),
    CONSTRAINT project_nodes_height_positive CHECK (((height IS NULL) OR (height > (0)::double precision))),
    CONSTRAINT project_nodes_node_id_check CHECK (((char_length(node_id) >= 1) AND (char_length(node_id) <= 128))),
    CONSTRAINT project_nodes_node_type_check CHECK (((char_length(btrim(node_type)) >= 1) AND (char_length(btrim(node_type)) <= 128))),
    CONSTRAINT project_nodes_parent_not_self CHECK (((parent_node_id IS NULL) OR (parent_node_id <> node_id))),
    CONSTRAINT project_nodes_presentation_json_object CHECK ((jsonb_typeof(presentation_json) = 'object'::text)),
    CONSTRAINT project_nodes_row_version_positive CHECK ((row_version > 0)),
    CONSTRAINT project_nodes_width_positive CHECK (((width IS NULL) OR (width > (0)::double precision)))
);


--
-- Name: project_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    project_version bigint NOT NULL,
    last_sequence bigint NOT NULL,
    snapshot_type text NOT NULL,
    schema_version integer NOT NULL,
    record_json jsonb NOT NULL,
    byte_size bigint NOT NULL,
    asset_manifest_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_valid boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_snapshots_asset_manifest_array CHECK ((jsonb_typeof(asset_manifest_json) = 'array'::text)),
    CONSTRAINT project_snapshots_byte_size_nonnegative CHECK ((byte_size >= 0)),
    CONSTRAINT project_snapshots_last_sequence_nonnegative CHECK ((last_sequence >= 0)),
    CONSTRAINT project_snapshots_project_version_nonnegative CHECK ((project_version >= 0)),
    CONSTRAINT project_snapshots_record_object CHECK ((jsonb_typeof(record_json) = 'object'::text)),
    CONSTRAINT project_snapshots_schema_version_positive CHECK ((schema_version > 0)),
    CONSTRAINT project_snapshots_type_check CHECK ((snapshot_type = ANY (ARRAY['manual'::text, 'periodic'::text, 'import'::text, 'pre_restore'::text])))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    last_sequence bigint DEFAULT 0 NOT NULL,
    saved_snapshot_id uuid,
    node_count integer DEFAULT 0 NOT NULL,
    edge_count integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_archived_after_created CHECK (((archived_at IS NULL) OR (archived_at >= created_at))),
    CONSTRAINT projects_deleted_after_created CHECK (((deleted_at IS NULL) OR (deleted_at >= created_at))),
    CONSTRAINT projects_edge_count_nonnegative CHECK ((edge_count >= 0)),
    CONSTRAINT projects_last_sequence_nonnegative CHECK ((last_sequence >= 0)),
    CONSTRAINT projects_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 160))),
    CONSTRAINT projects_node_count_nonnegative CHECK ((node_count >= 0)),
    CONSTRAINT projects_version_nonnegative CHECK ((version >= 0))
);


--
-- Name: registration_email_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registration_email_challenges (
    email_hash text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_sent_at timestamp with time zone DEFAULT now() NOT NULL,
    failed_attempts smallint DEFAULT 0 NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registration_email_challenges_attempts_check CHECK (((failed_attempts >= 0) AND (failed_attempts <= 5))),
    CONSTRAINT registration_email_challenges_code_hash_check CHECK ((code_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT registration_email_challenges_email_hash_check CHECK ((email_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT registration_email_challenges_time_order_check CHECK (((expires_at > last_sent_at) AND (updated_at >= created_at)))
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL,
    CONSTRAINT session_expiry_check CHECK ((expires_at > created_at))
);


--
-- Name: site_config_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_config_publications (
    singleton_id smallint DEFAULT 1 NOT NULL,
    revision_id uuid NOT NULL,
    etag text NOT NULL,
    config_json jsonb NOT NULL,
    logo_asset_id uuid,
    logo_object_key text,
    logo_mime_type text,
    favicon_asset_id uuid,
    favicon_object_key text,
    favicon_mime_type text,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT site_config_publications_etag_check CHECK ((etag ~ '^"[0-9a-f]{64}"$'::text)),
    CONSTRAINT site_config_publications_favicon_check CHECK ((((favicon_asset_id IS NULL) AND (favicon_object_key IS NULL) AND (favicon_mime_type IS NULL)) OR ((favicon_asset_id IS NOT NULL) AND (favicon_object_key IS NOT NULL) AND (favicon_mime_type IS NOT NULL)))),
    CONSTRAINT site_config_publications_json_object_check CHECK ((jsonb_typeof(config_json) = 'object'::text)),
    CONSTRAINT site_config_publications_logo_check CHECK ((((logo_asset_id IS NULL) AND (logo_object_key IS NULL) AND (logo_mime_type IS NULL)) OR ((logo_asset_id IS NOT NULL) AND (logo_object_key IS NOT NULL) AND (logo_mime_type IS NOT NULL)))),
    CONSTRAINT site_config_publications_singleton_check CHECK ((singleton_id = 1))
);


--
-- Name: smtp_config_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.smtp_config_publications (
    singleton_id smallint DEFAULT 1 NOT NULL,
    revision_id uuid NOT NULL,
    enabled boolean NOT NULL,
    host text NOT NULL,
    port integer NOT NULL,
    security_mode text NOT NULL,
    username text NOT NULL,
    encrypted_password_json jsonb NOT NULL,
    key_version integer NOT NULL,
    from_email text NOT NULL,
    from_name text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT smtp_config_publications_envelope_check CHECK (((jsonb_typeof(encrypted_password_json) = 'object'::text) AND (encrypted_password_json ?& ARRAY['algorithm'::text, 'keyVersion'::text, 'iv'::text, 'ciphertext'::text, 'authTag'::text]) AND ((encrypted_password_json ->> 'algorithm'::text) = 'aes-256-gcm'::text) AND (((encrypted_password_json ->> 'keyVersion'::text))::integer = key_version))),
    CONSTRAINT smtp_config_publications_key_version_check CHECK ((key_version > 0)),
    CONSTRAINT smtp_config_publications_port_check CHECK ((port = ANY (ARRAY[25, 465, 587, 2525]))),
    CONSTRAINT smtp_config_publications_security_check CHECK ((security_mode = ANY (ARRAY['implicit_tls'::text, 'starttls'::text]))),
    CONSTRAINT smtp_config_publications_singleton_check CHECK ((singleton_id = 1))
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_no bigint NOT NULL,
    username text NOT NULL,
    display_username text NOT NULL,
    deleted_at timestamp with time zone,
    personal_data_purged_at timestamp with time zone,
    CONSTRAINT user_display_username_format_check CHECK (((display_username ~ '^[A-Za-z][A-Za-z0-9_]{2,29}$'::text) AND (lower(display_username) = username))),
    CONSTRAINT user_email_lowercase CHECK ((email = lower(email))),
    CONSTRAINT user_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'deleted'::text]))),
    CONSTRAINT user_user_no_check CHECK ((user_no >= 10001)),
    CONSTRAINT user_username_format_check CHECK (((username = lower(username)) AND (username ~ '^[a-z][a-z0-9_]{2,29}$'::text) AND (username <> ALL (ARRAY['admin'::text, 'administrator'::text, 'api'::text, 'root'::text, 'support'::text, 'system'::text]))))
);


--
-- Name: user_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_number_seq
    START WITH 10001
    INCREMENT BY 1
    MINVALUE 10001
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_number_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_number_seq OWNED BY public."user".user_no;


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT verification_expiry_check CHECK ((expires_at > created_at))
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'editor'::text, 'viewer'::text])))
);


--
-- Name: workspace_user_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_user_state (
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    last_opened_project_id uuid,
    active_project_id uuid,
    ui_state_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text DEFAULT 'personal'::text NOT NULL,
    name text NOT NULL,
    owner_user_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    plan_key text DEFAULT 'free'::text NOT NULL,
    storage_quota_bytes bigint DEFAULT '10737418240'::bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspaces_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'deleted'::text]))),
    CONSTRAINT workspaces_storage_quota_nonnegative CHECK ((storage_quota_bytes >= 0)),
    CONSTRAINT workspaces_type_check CHECK ((type = ANY (ARRAY['personal'::text, 'team'::text])))
);


--
-- Name: user user_no; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user" ALTER COLUMN user_no SET DEFAULT nextval('public.user_number_seq'::regclass);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: session admin_session_token_unique; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.session
    ADD CONSTRAINT admin_session_token_unique UNIQUE (token);


--
-- Name: site_assets admin_site_assets_idempotency_unique; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_assets
    ADD CONSTRAINT admin_site_assets_idempotency_unique UNIQUE (uploaded_by_admin_id, idempotency_key);


--
-- Name: site_assets admin_site_assets_object_key_unique; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_assets
    ADD CONSTRAINT admin_site_assets_object_key_unique UNIQUE (object_key);


--
-- Name: two_factor admin_two_factor_user_unique; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.two_factor
    ADD CONSTRAINT admin_two_factor_user_unique UNIQUE (user_id);


--
-- Name: user admin_user_email_unique; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin."user"
    ADD CONSTRAINT admin_user_email_unique UNIQUE (email);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: login_captcha_challenges login_captcha_challenges_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.login_captcha_challenges
    ADD CONSTRAINT login_captcha_challenges_pkey PRIMARY KEY (id);


--
-- Name: login_security_settings login_security_settings_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.login_security_settings
    ADD CONSTRAINT login_security_settings_pkey PRIMARY KEY (singleton_id);


--
-- Name: object_storage_config_current object_storage_config_current_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.object_storage_config_current
    ADD CONSTRAINT object_storage_config_current_pkey PRIMARY KEY (singleton_id);


--
-- Name: object_storage_config_current object_storage_config_current_revision_id_key; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.object_storage_config_current
    ADD CONSTRAINT object_storage_config_current_revision_id_key UNIQUE (revision_id);


--
-- Name: object_storage_config_revisions object_storage_config_revisions_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.object_storage_config_revisions
    ADD CONSTRAINT object_storage_config_revisions_pkey PRIMARY KEY (id);


--
-- Name: object_storage_test_attempts object_storage_test_attempts_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.object_storage_test_attempts
    ADD CONSTRAINT object_storage_test_attempts_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: site_assets site_assets_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_assets
    ADD CONSTRAINT site_assets_pkey PRIMARY KEY (id);


--
-- Name: site_config_current site_config_current_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_config_current
    ADD CONSTRAINT site_config_current_pkey PRIMARY KEY (singleton_id);


--
-- Name: site_config_current site_config_current_revision_id_key; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_config_current
    ADD CONSTRAINT site_config_current_revision_id_key UNIQUE (revision_id);


--
-- Name: site_config_revisions site_config_revisions_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_config_revisions
    ADD CONSTRAINT site_config_revisions_pkey PRIMARY KEY (id);


--
-- Name: smtp_config_current smtp_config_current_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.smtp_config_current
    ADD CONSTRAINT smtp_config_current_pkey PRIMARY KEY (singleton_id);


--
-- Name: smtp_config_current smtp_config_current_revision_id_key; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.smtp_config_current
    ADD CONSTRAINT smtp_config_current_revision_id_key UNIQUE (revision_id);


--
-- Name: smtp_config_revisions smtp_config_revisions_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.smtp_config_revisions
    ADD CONSTRAINT smtp_config_revisions_pkey PRIMARY KEY (id);


--
-- Name: smtp_test_attempts smtp_test_attempts_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.smtp_test_attempts
    ADD CONSTRAINT smtp_test_attempts_pkey PRIMARY KEY (id);


--
-- Name: two_factor two_factor_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.two_factor
    ADD CONSTRAINT two_factor_pkey PRIMARY KEY (id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: account_erasure_jobs account_erasure_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_erasure_jobs
    ADD CONSTRAINT account_erasure_jobs_pkey PRIMARY KEY (id);


--
-- Name: account_erasure_jobs account_erasure_jobs_user_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_erasure_jobs
    ADD CONSTRAINT account_erasure_jobs_user_unique UNIQUE (user_id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: asset_references asset_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_references
    ADD CONSTRAINT asset_references_pkey PRIMARY KEY (id);


--
-- Name: asset_uploads asset_uploads_asset_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_uploads
    ADD CONSTRAINT asset_uploads_asset_unique UNIQUE (asset_id);


--
-- Name: asset_uploads asset_uploads_object_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_uploads
    ADD CONSTRAINT asset_uploads_object_key_unique UNIQUE (object_key);


--
-- Name: asset_uploads asset_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_uploads
    ADD CONSTRAINT asset_uploads_pkey PRIMARY KEY (id);


--
-- Name: asset_uploads asset_uploads_workspace_idempotency_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_uploads
    ADD CONSTRAINT asset_uploads_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key);


--
-- Name: assets assets_object_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_object_key_unique UNIQUE (object_key);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: assets assets_workspace_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_workspace_id_id_unique UNIQUE (workspace_id, id);


--
-- Name: auth_audit_events auth_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_events
    ADD CONSTRAINT auth_audit_events_pkey PRIMARY KEY (id);


--
-- Name: auth_devices auth_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_devices
    ADD CONSTRAINT auth_devices_pkey PRIMARY KEY (id);


--
-- Name: auth_devices auth_devices_user_device_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_devices
    ADD CONSTRAINT auth_devices_user_device_unique UNIQUE (user_id, device_key);


--
-- Name: generation_telemetry generation_telemetry_actor_attempt_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_telemetry
    ADD CONSTRAINT generation_telemetry_actor_attempt_unique UNIQUE (workspace_id, user_id, client_attempt_id);


--
-- Name: generation_telemetry generation_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_telemetry
    ADD CONSTRAINT generation_telemetry_pkey PRIMARY KEY (id);


--
-- Name: migration_exports migration_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_exports
    ADD CONSTRAINT migration_exports_pkey PRIMARY KEY (id);


--
-- Name: migration_exports migration_exports_workspace_idempotency_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_exports
    ADD CONSTRAINT migration_exports_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key);


--
-- Name: migration_import_asset_uploads migration_import_asset_uploads_logical_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_import_asset_uploads
    ADD CONSTRAINT migration_import_asset_uploads_logical_unique UNIQUE (workspace_id, import_id, logical_asset_id);


--
-- Name: migration_import_asset_uploads migration_import_asset_uploads_object_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_import_asset_uploads
    ADD CONSTRAINT migration_import_asset_uploads_object_key_unique UNIQUE (object_key);


--
-- Name: migration_import_asset_uploads migration_import_asset_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_import_asset_uploads
    ADD CONSTRAINT migration_import_asset_uploads_pkey PRIMARY KEY (id);


--
-- Name: migration_import_asset_uploads migration_import_asset_uploads_workspace_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_import_asset_uploads
    ADD CONSTRAINT migration_import_asset_uploads_workspace_id_id_unique UNIQUE (workspace_id, id);


--
-- Name: migration_imports migration_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_imports
    ADD CONSTRAINT migration_imports_pkey PRIMARY KEY (id);


--
-- Name: migration_imports migration_imports_workspace_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_imports
    ADD CONSTRAINT migration_imports_workspace_id_id_unique UNIQUE (workspace_id, id);


--
-- Name: migration_imports migration_imports_workspace_idempotency_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_imports
    ADD CONSTRAINT migration_imports_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key);


--
-- Name: object_storage_config_publications object_storage_config_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_storage_config_publications
    ADD CONSTRAINT object_storage_config_publications_pkey PRIMARY KEY (singleton_id);


--
-- Name: password_reset_email_challenges password_reset_email_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_email_challenges
    ADD CONSTRAINT password_reset_email_challenges_pkey PRIMARY KEY (email_hash);


--
-- Name: project_changes project_changes_batch_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_changes
    ADD CONSTRAINT project_changes_batch_unique UNIQUE (project_id, batch_id);


--
-- Name: project_changes project_changes_idempotency_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_changes
    ADD CONSTRAINT project_changes_idempotency_unique UNIQUE (project_id, idempotency_key);


--
-- Name: project_changes project_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_changes
    ADD CONSTRAINT project_changes_pkey PRIMARY KEY (project_id, sequence);


--
-- Name: project_edges project_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_edges
    ADD CONSTRAINT project_edges_pkey PRIMARY KEY (project_id, edge_id);


--
-- Name: project_nodes project_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_nodes
    ADD CONSTRAINT project_nodes_pkey PRIMARY KEY (project_id, node_id);


--
-- Name: project_snapshots project_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_snapshots
    ADD CONSTRAINT project_snapshots_pkey PRIMARY KEY (id);


--
-- Name: project_snapshots project_snapshots_project_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_snapshots
    ADD CONSTRAINT project_snapshots_project_id_id_unique UNIQUE (project_id, id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: projects projects_workspace_id_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_id_unique UNIQUE (workspace_id, id);


--
-- Name: registration_email_challenges registration_email_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_email_challenges
    ADD CONSTRAINT registration_email_challenges_pkey PRIMARY KEY (email_hash);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_unique UNIQUE (token);


--
-- Name: site_config_publications site_config_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_config_publications
    ADD CONSTRAINT site_config_publications_pkey PRIMARY KEY (singleton_id);


--
-- Name: smtp_config_publications smtp_config_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smtp_config_publications
    ADD CONSTRAINT smtp_config_publications_pkey PRIMARY KEY (singleton_id);


--
-- Name: user user_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: user user_user_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_user_no_unique UNIQUE (user_no);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id);


--
-- Name: workspace_user_state workspace_user_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_user_state
    ADD CONSTRAINT workspace_user_state_pkey PRIMARY KEY (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: admin_account_user_id_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_account_user_id_idx ON admin.account USING btree (user_id);


--
-- Name: admin_audit_events_actor_created_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_audit_events_actor_created_idx ON admin.audit_events USING btree (admin_user_id, created_at DESC);


--
-- Name: admin_audit_events_created_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_audit_events_created_idx ON admin.audit_events USING btree (created_at DESC, id DESC);


--
-- Name: admin_login_captcha_expiry_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_login_captcha_expiry_idx ON admin.login_captcha_challenges USING btree (expires_at) WHERE (consumed_at IS NULL);


--
-- Name: admin_object_storage_test_attempts_admin_created_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_object_storage_test_attempts_admin_created_idx ON admin.object_storage_test_attempts USING btree (admin_user_id, created_at DESC);


--
-- Name: admin_session_user_id_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_session_user_id_idx ON admin.session USING btree (user_id);


--
-- Name: admin_site_assets_status_created_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_site_assets_status_created_idx ON admin.site_assets USING btree (status, created_at DESC, id DESC);


--
-- Name: admin_smtp_test_attempts_admin_created_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_smtp_test_attempts_admin_created_idx ON admin.smtp_test_attempts USING btree (admin_user_id, created_at DESC);


--
-- Name: admin_two_factor_secret_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_two_factor_secret_idx ON admin.two_factor USING btree (secret);


--
-- Name: admin_user_username_unique; Type: INDEX; Schema: admin; Owner: -
--

CREATE UNIQUE INDEX admin_user_username_unique ON admin."user" USING btree (username);


--
-- Name: admin_verification_identifier_idx; Type: INDEX; Schema: admin; Owner: -
--

CREATE INDEX admin_verification_identifier_idx ON admin.verification USING btree (identifier);


--
-- Name: account_erasure_jobs_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_erasure_jobs_due_idx ON public.account_erasure_jobs USING btree (purge_after, id) WHERE (status = 'pending'::text);


--
-- Name: account_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_user_id_idx ON public.account USING btree (user_id);


--
-- Name: asset_references_asset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_references_asset_idx ON public.asset_references USING btree (workspace_id, asset_id, created_at DESC);


--
-- Name: asset_references_node_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_references_node_unique_idx ON public.asset_references USING btree (workspace_id, asset_id, project_id, node_id, reference_role) WHERE (node_id IS NOT NULL);


--
-- Name: asset_references_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_references_project_idx ON public.asset_references USING btree (workspace_id, project_id, created_at DESC);


--
-- Name: asset_uploads_workspace_pending_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_uploads_workspace_pending_expiry_idx ON public.asset_uploads USING btree (workspace_id, expires_at, id) WHERE (status = 'pending'::text);


--
-- Name: assets_workspace_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_workspace_project_idx ON public.assets USING btree (workspace_id, origin_project_id, created_at DESC) WHERE ((deleted_at IS NULL) AND (origin_project_id IS NOT NULL));


--
-- Name: assets_workspace_sha256_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_workspace_sha256_idx ON public.assets USING btree (workspace_id, sha256) WHERE ((sha256 IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: assets_workspace_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_workspace_status_updated_idx ON public.assets USING btree (workspace_id, status, updated_at DESC, id DESC) WHERE (deleted_at IS NULL);


--
-- Name: auth_audit_events_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_audit_events_user_created_idx ON public.auth_audit_events USING btree (user_id, created_at DESC);


--
-- Name: auth_audit_events_workspace_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_audit_events_workspace_created_idx ON public.auth_audit_events USING btree (workspace_id, created_at DESC);


--
-- Name: auth_devices_last_session_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_devices_last_session_unique_idx ON public.auth_devices USING btree (last_session_id) WHERE (last_session_id IS NOT NULL);


--
-- Name: auth_devices_user_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_devices_user_last_seen_idx ON public.auth_devices USING btree (user_id, last_seen_at DESC);


--
-- Name: generation_telemetry_daily_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_telemetry_daily_category_idx ON public.generation_telemetry USING btree (started_at DESC, category, status);


--
-- Name: generation_telemetry_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_telemetry_started_at_idx ON public.generation_telemetry USING btree (started_at DESC);


--
-- Name: generation_telemetry_user_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generation_telemetry_user_started_idx ON public.generation_telemetry USING btree (user_id, started_at DESC);


--
-- Name: migration_exports_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX migration_exports_expiry_idx ON public.migration_exports USING btree (expires_at, id) WHERE ((status)::text = ANY ((ARRAY['prepared'::character varying, 'generating'::character varying, 'failed'::character varying])::text[]));


--
-- Name: migration_exports_retryable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX migration_exports_retryable_idx ON public.migration_exports USING btree (status, updated_at, id) WHERE ((status)::text = ANY ((ARRAY['failed'::character varying, 'canceled'::character varying])::text[]));


--
-- Name: migration_exports_workspace_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX migration_exports_workspace_status_updated_idx ON public.migration_exports USING btree (workspace_id, status, updated_at DESC, id DESC);


--
-- Name: migration_import_asset_uploads_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX migration_import_asset_uploads_expiry_idx ON public.migration_import_asset_uploads USING btree (expires_at, id) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'uploading'::character varying, 'validating'::character varying])::text[]));


--
-- Name: migration_import_asset_uploads_import_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX migration_import_asset_uploads_import_status_idx ON public.migration_import_asset_uploads USING btree (workspace_id, import_id, status, updated_at DESC, id DESC);


--
-- Name: migration_imports_committed_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX migration_imports_committed_project_idx ON public.migration_imports USING btree (workspace_id, committed_project_id) WHERE (committed_project_id IS NOT NULL);


--
-- Name: migration_imports_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX migration_imports_expiry_idx ON public.migration_imports USING btree (expires_at, id) WHERE ((status)::text = ANY ((ARRAY['prepared'::character varying, 'uploading'::character varying, 'validating'::character varying, 'ready'::character varying])::text[]));


--
-- Name: migration_imports_workspace_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX migration_imports_workspace_status_updated_idx ON public.migration_imports USING btree (workspace_id, status, updated_at DESC, id DESC);


--
-- Name: password_reset_email_challenges_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_email_challenges_expires_at_idx ON public.password_reset_email_challenges USING btree (expires_at);


--
-- Name: project_changes_project_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_changes_project_created_idx ON public.project_changes USING btree (project_id, created_at DESC);


--
-- Name: project_edges_project_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_edges_project_active_idx ON public.project_edges USING btree (project_id, edge_id) WHERE (deleted_at IS NULL);


--
-- Name: project_edges_project_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_edges_project_source_idx ON public.project_edges USING btree (project_id, source_node_id) WHERE (deleted_at IS NULL);


--
-- Name: project_edges_project_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_edges_project_target_idx ON public.project_edges USING btree (project_id, target_node_id) WHERE (deleted_at IS NULL);


--
-- Name: project_nodes_project_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_nodes_project_active_idx ON public.project_nodes USING btree (project_id, node_id) WHERE (deleted_at IS NULL);


--
-- Name: project_nodes_project_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_nodes_project_parent_idx ON public.project_nodes USING btree (project_id, parent_node_id) WHERE ((deleted_at IS NULL) AND (parent_node_id IS NOT NULL));


--
-- Name: project_snapshots_project_valid_sequence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_snapshots_project_valid_sequence_idx ON public.project_snapshots USING btree (project_id, last_sequence DESC) WHERE is_valid;


--
-- Name: project_snapshots_project_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_snapshots_project_version_idx ON public.project_snapshots USING btree (project_id, project_version DESC, created_at DESC);


--
-- Name: projects_workspace_active_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_workspace_active_updated_idx ON public.projects USING btree (workspace_id, updated_at DESC, id DESC) WHERE ((deleted_at IS NULL) AND (archived_at IS NULL));


--
-- Name: projects_workspace_archived_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_workspace_archived_updated_idx ON public.projects USING btree (workspace_id, updated_at DESC, id DESC) WHERE ((deleted_at IS NULL) AND (archived_at IS NOT NULL));


--
-- Name: registration_email_challenges_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registration_email_challenges_expires_at_idx ON public.registration_email_challenges USING btree (expires_at);


--
-- Name: session_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_user_id_idx ON public.session USING btree (user_id);


--
-- Name: user_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_deleted_at_idx ON public."user" USING btree (deleted_at) WHERE ((status = 'deleted'::text) AND (personal_data_purged_at IS NULL));


--
-- Name: user_username_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_username_unique ON public."user" USING btree (username);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: workspace_members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_members_user_id_idx ON public.workspace_members USING btree (user_id);


--
-- Name: workspaces_personal_owner_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspaces_personal_owner_unique ON public.workspaces USING btree (owner_user_id) WHERE ((type = 'personal'::text) AND (status <> 'deleted'::text));


--
-- Name: audit_events admin_audit_events_append_only; Type: TRIGGER; Schema: admin; Owner: -
--

CREATE TRIGGER admin_audit_events_append_only BEFORE DELETE OR UPDATE ON admin.audit_events FOR EACH ROW EXECUTE FUNCTION admin.reject_audit_event_mutation();


--
-- Name: object_storage_config_revisions admin_object_storage_config_revisions_immutable; Type: TRIGGER; Schema: admin; Owner: -
--

CREATE TRIGGER admin_object_storage_config_revisions_immutable BEFORE DELETE OR UPDATE ON admin.object_storage_config_revisions FOR EACH ROW EXECUTE FUNCTION admin.reject_object_storage_config_revision_mutation();


--
-- Name: site_config_revisions admin_site_config_revisions_immutable; Type: TRIGGER; Schema: admin; Owner: -
--

CREATE TRIGGER admin_site_config_revisions_immutable BEFORE DELETE OR UPDATE ON admin.site_config_revisions FOR EACH ROW EXECUTE FUNCTION admin.reject_site_config_revision_mutation();


--
-- Name: smtp_config_revisions admin_smtp_config_revisions_immutable; Type: TRIGGER; Schema: admin; Owner: -
--

CREATE TRIGGER admin_smtp_config_revisions_immutable BEFORE DELETE OR UPDATE ON admin.smtp_config_revisions FOR EACH ROW EXECUTE FUNCTION admin.reject_smtp_config_revision_mutation();


--
-- Name: account account_user_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.account
    ADD CONSTRAINT account_user_id_fkey FOREIGN KEY (user_id) REFERENCES admin."user"(id) ON DELETE CASCADE;


--
-- Name: audit_events audit_events_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.audit_events
    ADD CONSTRAINT audit_events_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES admin."user"(id);


--
-- Name: login_security_settings login_security_settings_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.login_security_settings
    ADD CONSTRAINT login_security_settings_updated_by_admin_id_fkey FOREIGN KEY (updated_by_admin_id) REFERENCES admin."user"(id);


--
-- Name: object_storage_config_current object_storage_config_current_revision_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.object_storage_config_current
    ADD CONSTRAINT object_storage_config_current_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES admin.object_storage_config_revisions(id);


--
-- Name: object_storage_config_current object_storage_config_current_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.object_storage_config_current
    ADD CONSTRAINT object_storage_config_current_updated_by_admin_id_fkey FOREIGN KEY (updated_by_admin_id) REFERENCES admin."user"(id);


--
-- Name: object_storage_config_revisions object_storage_config_revisions_created_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.object_storage_config_revisions
    ADD CONSTRAINT object_storage_config_revisions_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES admin."user"(id);


--
-- Name: object_storage_test_attempts object_storage_test_attempts_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.object_storage_test_attempts
    ADD CONSTRAINT object_storage_test_attempts_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES admin."user"(id);


--
-- Name: session session_user_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES admin."user"(id) ON DELETE CASCADE;


--
-- Name: site_assets site_assets_uploaded_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_assets
    ADD CONSTRAINT site_assets_uploaded_by_admin_id_fkey FOREIGN KEY (uploaded_by_admin_id) REFERENCES admin."user"(id);


--
-- Name: site_config_current site_config_current_revision_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_config_current
    ADD CONSTRAINT site_config_current_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES admin.site_config_revisions(id);


--
-- Name: site_config_current site_config_current_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_config_current
    ADD CONSTRAINT site_config_current_updated_by_admin_id_fkey FOREIGN KEY (updated_by_admin_id) REFERENCES admin."user"(id);


--
-- Name: site_config_revisions site_config_revisions_created_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.site_config_revisions
    ADD CONSTRAINT site_config_revisions_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES admin."user"(id);


--
-- Name: smtp_config_current smtp_config_current_revision_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.smtp_config_current
    ADD CONSTRAINT smtp_config_current_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES admin.smtp_config_revisions(id);


--
-- Name: smtp_config_current smtp_config_current_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.smtp_config_current
    ADD CONSTRAINT smtp_config_current_updated_by_admin_id_fkey FOREIGN KEY (updated_by_admin_id) REFERENCES admin."user"(id);


--
-- Name: smtp_config_revisions smtp_config_revisions_created_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.smtp_config_revisions
    ADD CONSTRAINT smtp_config_revisions_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES admin."user"(id);


--
-- Name: smtp_test_attempts smtp_test_attempts_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.smtp_test_attempts
    ADD CONSTRAINT smtp_test_attempts_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES admin."user"(id);


--
-- Name: two_factor two_factor_user_id_fkey; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.two_factor
    ADD CONSTRAINT two_factor_user_id_fkey FOREIGN KEY (user_id) REFERENCES admin."user"(id) ON DELETE CASCADE;


--
-- Name: account_erasure_jobs account_erasure_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_erasure_jobs
    ADD CONSTRAINT account_erasure_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: account account_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: asset_references asset_references_project_node_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_references
    ADD CONSTRAINT asset_references_project_node_fk FOREIGN KEY (project_id, node_id) REFERENCES public.project_nodes(project_id, node_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: asset_references asset_references_workspace_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_references
    ADD CONSTRAINT asset_references_workspace_asset_fk FOREIGN KEY (workspace_id, asset_id) REFERENCES public.assets(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: asset_references asset_references_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_references
    ADD CONSTRAINT asset_references_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: asset_references asset_references_workspace_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_references
    ADD CONSTRAINT asset_references_workspace_project_fk FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: asset_uploads asset_uploads_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_uploads
    ADD CONSTRAINT asset_uploads_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public."user"(id);


--
-- Name: asset_uploads asset_uploads_workspace_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_uploads
    ADD CONSTRAINT asset_uploads_workspace_asset_fk FOREIGN KEY (workspace_id, asset_id) REFERENCES public.assets(workspace_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: asset_uploads asset_uploads_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_uploads
    ADD CONSTRAINT asset_uploads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: asset_uploads asset_uploads_workspace_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_uploads
    ADD CONSTRAINT asset_uploads_workspace_project_fk FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: assets assets_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public."user"(id);


--
-- Name: assets assets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: assets assets_workspace_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_workspace_project_fk FOREIGN KEY (workspace_id, origin_project_id) REFERENCES public.projects(workspace_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: auth_audit_events auth_audit_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_events
    ADD CONSTRAINT auth_audit_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: auth_audit_events auth_audit_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_events
    ADD CONSTRAINT auth_audit_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: auth_devices auth_devices_last_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_devices
    ADD CONSTRAINT auth_devices_last_session_id_fkey FOREIGN KEY (last_session_id) REFERENCES public.session(id) ON DELETE SET NULL;


--
-- Name: auth_devices auth_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_devices
    ADD CONSTRAINT auth_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: generation_telemetry generation_telemetry_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_telemetry
    ADD CONSTRAINT generation_telemetry_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: generation_telemetry generation_telemetry_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_telemetry
    ADD CONSTRAINT generation_telemetry_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: migration_exports migration_exports_creator_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_exports
    ADD CONSTRAINT migration_exports_creator_fk FOREIGN KEY (workspace_id, created_by_user_id) REFERENCES public.workspace_members(workspace_id, user_id);


--
-- Name: migration_exports migration_exports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_exports
    ADD CONSTRAINT migration_exports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: migration_exports migration_exports_workspace_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_exports
    ADD CONSTRAINT migration_exports_workspace_project_fk FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;


--
-- Name: migration_import_asset_uploads migration_import_asset_uploads_committed_asset_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_import_asset_uploads
    ADD CONSTRAINT migration_import_asset_uploads_committed_asset_fk FOREIGN KEY (workspace_id, committed_asset_id) REFERENCES public.assets(workspace_id, id);


--
-- Name: migration_import_asset_uploads migration_import_asset_uploads_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_import_asset_uploads
    ADD CONSTRAINT migration_import_asset_uploads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: migration_import_asset_uploads migration_import_asset_uploads_workspace_import_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_import_asset_uploads
    ADD CONSTRAINT migration_import_asset_uploads_workspace_import_fk FOREIGN KEY (workspace_id, import_id) REFERENCES public.migration_imports(workspace_id, id) ON DELETE CASCADE;


--
-- Name: migration_imports migration_imports_target_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_imports
    ADD CONSTRAINT migration_imports_target_project_fk FOREIGN KEY (workspace_id, target_project_id) REFERENCES public.projects(workspace_id, id);


--
-- Name: migration_imports migration_imports_workspace_creator_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_imports
    ADD CONSTRAINT migration_imports_workspace_creator_fk FOREIGN KEY (workspace_id, created_by_user_id) REFERENCES public.workspace_members(workspace_id, user_id);


--
-- Name: migration_imports migration_imports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_imports
    ADD CONSTRAINT migration_imports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_changes project_changes_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_changes
    ADD CONSTRAINT project_changes_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public."user"(id);


--
-- Name: project_changes project_changes_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_changes
    ADD CONSTRAINT project_changes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_edges project_edges_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_edges
    ADD CONSTRAINT project_edges_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_edges project_edges_source_node_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_edges
    ADD CONSTRAINT project_edges_source_node_fk FOREIGN KEY (project_id, source_node_id) REFERENCES public.project_nodes(project_id, node_id) DEFERRABLE;


--
-- Name: project_edges project_edges_target_node_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_edges
    ADD CONSTRAINT project_edges_target_node_fk FOREIGN KEY (project_id, target_node_id) REFERENCES public.project_nodes(project_id, node_id) DEFERRABLE;


--
-- Name: project_nodes project_nodes_parent_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_nodes
    ADD CONSTRAINT project_nodes_parent_fk FOREIGN KEY (project_id, parent_node_id) REFERENCES public.project_nodes(project_id, node_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: project_nodes project_nodes_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_nodes
    ADD CONSTRAINT project_nodes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_snapshots project_snapshots_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_snapshots
    ADD CONSTRAINT project_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects projects_saved_snapshot_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_saved_snapshot_fk FOREIGN KEY (id, saved_snapshot_id) REFERENCES public.project_snapshots(project_id, id) ON DELETE SET NULL (saved_snapshot_id) DEFERRABLE;


--
-- Name: projects projects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: session session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspace_user_state workspace_user_state_active_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_user_state
    ADD CONSTRAINT workspace_user_state_active_project_fk FOREIGN KEY (workspace_id, active_project_id) REFERENCES public.projects(workspace_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: workspace_user_state workspace_user_state_last_opened_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_user_state
    ADD CONSTRAINT workspace_user_state_last_opened_project_fk FOREIGN KEY (workspace_id, last_opened_project_id) REFERENCES public.projects(workspace_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: workspace_user_state workspace_user_state_member_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_user_state
    ADD CONSTRAINT workspace_user_state_member_fk FOREIGN KEY (workspace_id, user_id) REFERENCES public.workspace_members(workspace_id, user_id);


--
-- Name: workspace_user_state workspace_user_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_user_state
    ADD CONSTRAINT workspace_user_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: workspace_user_state workspace_user_state_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_user_state
    ADD CONSTRAINT workspace_user_state_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspaces workspaces_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);


--
-- Administrator login security singleton
--

INSERT INTO admin.login_security_settings (singleton_id, captcha_enabled)
VALUES (1, false);


--
-- PostgreSQL database dump complete
--
