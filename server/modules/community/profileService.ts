import {
  COMMUNITY_CONSENT_VERSION,
  type CommunityProfileResponse,
  type CommunityProfileStatus,
  type UpdateCommunityProfileRequest,
} from "@ai-canvas-cloud/contracts";
import type { DbClient, DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";

interface UserRow {
  status: "active" | "disabled" | "deleted";
}

interface CommunityProfileRow {
  public_nickname: string | null;
  profile_status: CommunityProfileStatus;
  community_consent_version: number | null;
  community_consent_at: Date | string | null;
  updated_at: Date | string;
}

interface ValidatedCommunityProfilePatch {
  hasPublicNickname: boolean;
  publicNickname: string | null;
  hasCommunityConsent: boolean;
  communityConsent: boolean;
}

export interface CommunityProfileService {
  get(userId: string): Promise<CommunityProfileResponse>;
  update(
    input: UpdateCommunityProfileRequest,
    userId: string,
  ): Promise<CommunityProfileResponse>;
}

function validationError(message: string): never {
  throw new AuthServiceError({
    statusCode: 400,
    apiCode: "VALIDATION_FAILED",
    message,
  });
}

function normalizePublicNickname(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") {
    validationError("Public nickname must be a string or null");
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    normalized.length < 1 ||
    normalized.length > 32 ||
    !/^[\p{L}\p{N}_. -]+$/u.test(normalized)
  ) {
    validationError("Public nickname contains unsupported characters");
  }
  return normalized;
}

export function validateCommunityProfilePatch(
  input: unknown,
): ValidatedCommunityProfilePatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    validationError("Community profile patch must be an object");
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length === 0 ||
    keys.some((key) => !["publicNickname", "communityConsent"].includes(key))
  ) {
    validationError("Community profile patch contains unsupported fields");
  }
  const hasPublicNickname = Object.hasOwn(record, "publicNickname");
  const hasCommunityConsent = Object.hasOwn(record, "communityConsent");
  if (hasCommunityConsent && typeof record.communityConsent !== "boolean") {
    validationError("Community consent must be a boolean");
  }
  return {
    hasPublicNickname,
    publicNickname: hasPublicNickname
      ? normalizePublicNickname(record.publicNickname)
      : null,
    hasCommunityConsent,
    communityConsent: record.communityConsent === true,
  };
}

function profileResponse(
  row: CommunityProfileRow | undefined,
): CommunityProfileResponse {
  const communityConsentVersion =
    row?.community_consent_version === COMMUNITY_CONSENT_VERSION
      ? COMMUNITY_CONSENT_VERSION
      : null;
  const communityConsentAt = row?.community_consent_at
    ? new Date(row.community_consent_at).toISOString()
    : null;
  const profileStatus = row?.profile_status ?? "active";
  return {
    profile: {
      publicNickname: row?.public_nickname ?? null,
      profileStatus,
      communityConsentVersion,
      communityConsentAt,
      canPost:
        profileStatus === "active" &&
        communityConsentVersion === COMMUNITY_CONSENT_VERSION,
      updatedAt: row?.updated_at
        ? new Date(row.updated_at).toISOString()
        : null,
    },
  };
}

async function requireActiveUser(
  client: Pick<DbClient, "query">,
  userId: string,
) {
  const result = await client.query<UserRow>(
    `SELECT COALESCE(status, 'active') AS status
     FROM "user"
     WHERE id = $1
     FOR UPDATE`,
    [userId],
  );
  if (result.rows[0]?.status !== "active") {
    throw new AuthServiceError({
      statusCode: 403,
      apiCode: "ACCESS_DENIED",
      message: "Active account required",
    });
  }
}

function isNicknameConflict(error: unknown) {
  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate?.code === "23505" &&
    candidate.constraint === "user_public_profiles_nickname_lower_unique"
  );
}

export function createPostgresCommunityProfileService(
  pool: DbPool,
): CommunityProfileService {
  return {
    async get(userId) {
      const result = await pool.query<CommunityProfileRow & UserRow>(
        `SELECT
           COALESCE(u.status, 'active') AS status,
           p.public_nickname,
           p.profile_status,
           p.community_consent_version,
           p.community_consent_at,
           p.updated_at
         FROM "user" u
         LEFT JOIN user_public_profiles p ON p.user_id = u.id
         WHERE u.id = $1
         LIMIT 1`,
        [userId],
      );
      const row = result.rows[0];
      if (!row || row.status !== "active") {
        throw new AuthServiceError({
          statusCode: 403,
          apiCode: "ACCESS_DENIED",
          message: "Active account required",
        });
      }
      return profileResponse(row);
    },

    async update(input, userId) {
      const patch = validateCommunityProfilePatch(input);
      try {
        return await withTransaction(pool, async (client) => {
          await requireActiveUser(client, userId);
          const current = await client.query<CommunityProfileRow>(
            `SELECT public_nickname, profile_status,
                    community_consent_version, community_consent_at, updated_at
             FROM user_public_profiles
             WHERE user_id = $1
             FOR UPDATE`,
            [userId],
          );
          const row = current.rows[0];
          const publicNickname = patch.hasPublicNickname
            ? patch.publicNickname
            : (row?.public_nickname ?? null);
          const communityConsentVersion = patch.hasCommunityConsent
            ? patch.communityConsent
              ? COMMUNITY_CONSENT_VERSION
              : null
            : (row?.community_consent_version ?? null);
          const communityConsentAt = patch.hasCommunityConsent
            ? patch.communityConsent
              ? new Date().toISOString()
              : null
            : row?.community_consent_at
              ? new Date(row.community_consent_at).toISOString()
              : null;

          const result = await client.query<CommunityProfileRow>(
            `INSERT INTO user_public_profiles (
               user_id, public_nickname, profile_status,
               community_consent_version, community_consent_at,
               created_at, updated_at
             )
             VALUES ($1, $2, 'active', $3, $4, now(), now())
             ON CONFLICT (user_id) DO UPDATE
             SET public_nickname = EXCLUDED.public_nickname,
                 community_consent_version = EXCLUDED.community_consent_version,
                 community_consent_at = EXCLUDED.community_consent_at,
                 updated_at = now()
             RETURNING public_nickname, profile_status,
                       community_consent_version, community_consent_at, updated_at`,
            [
              userId,
              publicNickname,
              communityConsentVersion,
              communityConsentAt,
            ],
          );
          return profileResponse(result.rows[0]);
        });
      } catch (error) {
        if (isNicknameConflict(error)) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "PUBLIC_NICKNAME_UNAVAILABLE",
            message: "Public nickname is unavailable",
          });
        }
        throw error;
      }
    },
  };
}

export function createUnavailableCommunityProfileService(): CommunityProfileService {
  const unavailable = async (): Promise<never> => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: "SERVICE_UNAVAILABLE",
      message: "Community profile service is unavailable",
      retryable: true,
    });
  };
  return { get: unavailable, update: unavailable };
}
