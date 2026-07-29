import {
  DEFAULT_SITE_LINK_PATHS,
  type SiteConfigDocument,
} from "@ai-canvas-cloud/contracts/site-config";

export type PublicPageKind = "help" | "terms" | "privacy" | "feedback";

export const PUBLIC_PAGE_ORDER: PublicPageKind[] = [
  "help",
  "terms",
  "privacy",
  "feedback",
];

export const PUBLIC_PAGE_META: Record<
  PublicPageKind,
  { path: string; linkKey: keyof typeof DEFAULT_SITE_LINK_PATHS; label: string }
> = {
  help: {
    path: DEFAULT_SITE_LINK_PATHS.helpUrl,
    linkKey: "helpUrl",
    label: "帮助中心",
  },
  terms: {
    path: DEFAULT_SITE_LINK_PATHS.termsUrl,
    linkKey: "termsUrl",
    label: "用户协议",
  },
  privacy: {
    path: DEFAULT_SITE_LINK_PATHS.privacyUrl,
    linkKey: "privacyUrl",
    label: "隐私政策",
  },
  feedback: {
    path: DEFAULT_SITE_LINK_PATHS.feedbackUrl,
    linkKey: "feedbackUrl",
    label: "问题反馈",
  },
};

function normalizePath(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function getPublicPageKind(pathname: string): PublicPageKind | null {
  const normalized = normalizePath(pathname);
  return (
    PUBLIC_PAGE_ORDER.find(
      (kind) => PUBLIC_PAGE_META[kind].path === normalized,
    ) ?? null
  );
}

export function getPublicPageHref(
  config: SiteConfigDocument,
  kind: PublicPageKind,
) {
  const { linkKey, path } = PUBLIC_PAGE_META[kind];
  return config.links[linkKey] ?? path;
}
