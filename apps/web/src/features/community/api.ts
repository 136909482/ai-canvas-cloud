import type {
  CommunityPostResponse,
  CreateCommunityPostRequest,
  MyCommunityPostsResponse,
  UpdateCommunityPostRequest,
  WithdrawCommunityPostResponse,
  CommunityPublicPostsResponse,
  CommunityPublicPostResponse,
} from "@ai-canvas-cloud/contracts";
import { requestCloudJson } from "@/api/cloudApiClient";

export function createCommunityPost(input: CreateCommunityPostRequest) {
  return requestCloudJson<CommunityPostResponse>("/community/posts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCommunityPost(
  postId: string,
  input: UpdateCommunityPostRequest,
) {
  return requestCloudJson<CommunityPostResponse>(
    `/community/posts/${encodeURIComponent(postId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function fetchMyCommunityPosts(cursor?: string | null) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return requestCloudJson<MyCommunityPostsResponse>(
    `/community/me/posts${query}`,
    { method: "GET" },
  );
}

export function withdrawCommunityPost(postId: string) {
  return requestCloudJson<WithdrawCommunityPostResponse>(
    `/community/posts/${encodeURIComponent(postId)}/withdraw`,
    { method: "POST" },
  );
}

export function fetchCommunityPosts(
  input: { q?: string; tag?: string; cursor?: string | null } = {},
) {
  const query = new URLSearchParams();
  if (input.q?.trim()) query.set("q", input.q.trim());
  if (input.tag?.trim()) query.set("tag", input.tag.trim());
  if (input.cursor) query.set("cursor", input.cursor);
  return requestCloudJson<CommunityPublicPostsResponse>(
    `/community/posts${query.size ? `?${query}` : ""}`,
    { method: "GET" },
  );
}

export function fetchCommunityPost(postId: string) {
  return requestCloudJson<CommunityPublicPostResponse>(
    `/community/posts/${encodeURIComponent(postId)}`,
    { method: "GET" },
  );
}
