export type CommunityPostStatus =
  "pending_review" | "published" | "rejected" | "withdrawn" | "removed";

export type CommunityReportReason =
  "inappropriate" | "copyright" | "privacy" | "spam" | "other";

export type CommunityReportStatus = "pending" | "resolved" | "dismissed";

export interface CommunityPostSummary {
  id: string;
  assetId: string;
  title: string;
  tags: string[];
  status: CommunityPostStatus;
  moderationReason: string | null;
  publishedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommunityPostRequest {
  assetId: string;
  title: string;
  tags?: string[];
  idempotencyKey: string;
}

export interface UpdateCommunityPostRequest {
  title: string;
  tags?: string[];
}

export interface CommunityPostResponse {
  post: CommunityPostSummary;
}

export interface MyCommunityPostsResponse {
  items: CommunityPostSummary[];
  nextCursor: string | null;
}

export interface CommunityPublicPostSummary {
  id: string;
  assetId: string;
  imageUrl?: string;
  imageExpiresAt?: string;
  title: string;
  tags: string[];
  publishedAt: string;
  publicNickname: string;
}

export interface CommunityPublicPostsResponse {
  items: CommunityPublicPostSummary[];
  nextCursor: string | null;
}

export interface CommunityPublicPostResponse {
  post: CommunityPublicPostSummary;
}

export interface WithdrawCommunityPostResponse {
  post: CommunityPostSummary;
}

export interface CreateCommunityReportRequest {
  reason: CommunityReportReason;
  detail?: string | null;
}

export interface CommunityReportSummary {
  id: string;
  postId: string;
  reason: CommunityReportReason;
  status: CommunityReportStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CommunityReportResponse {
  report: CommunityReportSummary;
}

export interface AdminCommunityPostSummary extends CommunityPostSummary {
  authorUserId: string;
  authorPublicNickname: string | null;
  authorProfileStatus: "active" | "hidden";
  sourceWorkspaceId: string;
}

export interface AdminCommunityPostsResponse {
  items: AdminCommunityPostSummary[];
  nextCursor: string | null;
}

export interface AdminCommunityReportsResponse {
  items: Array<
    CommunityReportSummary & {
      reporterUserId: string;
      detail: string | null;
    }
  >;
  nextCursor: string | null;
}

export interface ModerateCommunityPostRequest {
  reason?: string | null;
}

export interface ResolveCommunityReportRequest {
  resolution: Extract<CommunityReportStatus, "resolved" | "dismissed">;
}

export interface AdminCommunityUserVisibilityResponse {
  userId: string;
  profileStatus: "active" | "hidden";
}
