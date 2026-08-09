export const COMMUNITY_CONSENT_VERSION = 1 as const;

export type CommunityProfileStatus = "active" | "hidden";

export interface CommunityProfile {
  publicNickname: string | null;
  profileStatus: CommunityProfileStatus;
  communityConsentVersion: typeof COMMUNITY_CONSENT_VERSION | null;
  communityConsentAt: string | null;
  canPost: boolean;
  updatedAt: string | null;
}

export interface CommunityProfileResponse {
  profile: CommunityProfile;
}

export interface UpdateCommunityProfileRequest {
  publicNickname?: string | null;
  communityConsent?: boolean;
}
