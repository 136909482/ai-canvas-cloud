import type {
  CommunityPostResponse,
  CreateCommunityPostRequest,
  MyCommunityPostsResponse,
  WithdrawCommunityPostResponse,
} from "@ai-canvas-cloud/contracts";
import { requestCloudJson } from "@/api/cloudApiClient";

export function createCommunityPost(input: CreateCommunityPostRequest) {
  return requestCloudJson<CommunityPostResponse>("/community/posts", {
    method: "POST",
    body: JSON.stringify(input),
  });
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
