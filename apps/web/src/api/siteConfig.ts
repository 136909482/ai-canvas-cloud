import {
  DEFAULT_SITE_CONFIG,
  type PublicSiteConfigResponse,
} from "@ai-canvas-cloud/contracts";
import { requestCloudJson } from "./cloudApiClient";

export const FALLBACK_SITE_CONFIG: PublicSiteConfigResponse = {
  etag: "builtin",
  config: DEFAULT_SITE_CONFIG,
  assets: { logo: null, favicon: null },
};

export async function fetchPublicSiteConfig() {
  try {
    return await requestCloudJson<PublicSiteConfigResponse>("/site-config");
  } catch {
    return FALLBACK_SITE_CONFIG;
  }
}
