export const SITE_CONFIG_SCHEMA_VERSION = 2 as const;

export const DEFAULT_SITE_LINK_PATHS = {
  helpUrl: "/help",
  feedbackUrl: "/feedback",
  termsUrl: "/yonghuxieyi",
  privacyUrl: "/yinsizhengce",
} as const;

export type SiteThemePreset = "system" | "light" | "dark";
export type SiteNavigationItem = "home" | "help" | "legal";
export type SiteAssetKind = "logo" | "favicon";
export type SiteAssetStatus = "pending" | "completed" | "failed" | "deleted";

export interface SiteConfigDocument {
  schemaVersion: typeof SITE_CONFIG_SCHEMA_VERSION;
  siteName: string;
  shortName: string;
  home: {
    headline: string;
    lead: string;
    description: string;
    primaryActionLabel: string;
  };
  footer: {
    description: string;
    copyright: string;
  };
  records: {
    companyName: string | null;
    icpNumber: string | null;
    publicSecurityNumber: string | null;
  };
  links: {
    helpUrl: string | null;
    feedbackUrl: string | null;
    termsUrl: string | null;
    privacyUrl: string | null;
    accountDeletionUrl: string | null;
  };
  themePreset: SiteThemePreset;
  navigation: SiteNavigationItem[];
  features: {
    registrationEnabled: boolean;
    registrationEmailVerificationRequired: boolean;
    feedbackEnabled: boolean;
  };
  logoAssetId: string | null;
  faviconAssetId: string | null;
}

export interface SiteAssetSummary {
  id: string;
  kind: SiteAssetKind;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  status: SiteAssetStatus;
  url: string | null;
  urlExpiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PublicSiteAsset {
  assetId: string;
  mimeType: string;
  url: string;
  expiresAt: string;
}

export interface PublicSiteConfigResponse {
  etag: string;
  config: SiteConfigDocument;
  assets: {
    logo: PublicSiteAsset | null;
    favicon: PublicSiteAsset | null;
  };
}

export interface AdminSiteConfigResponse extends PublicSiteConfigResponse {
  revision: {
    id: string;
    note: string | null;
    createdByAdminId: string;
    createdAt: string;
  } | null;
}

export interface PublishSiteConfigRequest {
  config: SiteConfigDocument;
  note?: string | null;
}

export interface CreateSiteAssetRequest {
  kind: SiteAssetKind;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  idempotencyKey: string;
}

export interface SiteAssetUploadResponse {
  asset: SiteAssetSummary;
  directUpload: {
    method: "PUT" | "POST";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
}

export interface SiteAssetResponse {
  asset: SiteAssetSummary;
}

export interface SiteAssetsResponse {
  items: SiteAssetSummary[];
}

export const DEFAULT_SITE_CONFIG: SiteConfigDocument = {
  schemaVersion: SITE_CONFIG_SCHEMA_VERSION,
  siteName: "AI Canvas",
  shortName: "AI Canvas",
  home: {
    headline: "AI Canvas",
    lead: "让创意，在画布上自然生长",
    description:
      "把灵感、素材与 AI 生成工作流放进同一张画布，随时回来，继续创作。",
    primaryActionLabel: "开始创作",
  },
  footer: {
    description: "面向创作者的云端 AI 画布。",
    copyright: "© 2026 AI Canvas Cloud",
  },
  records: {
    companyName: null,
    icpNumber: null,
    publicSecurityNumber: null,
  },
  links: {
    helpUrl: null,
    feedbackUrl: null,
    termsUrl: null,
    privacyUrl: null,
    accountDeletionUrl: null,
  },
  themePreset: "system",
  navigation: ["home", "help", "legal"],
  features: {
    registrationEnabled: true,
    registrationEmailVerificationRequired: false,
    feedbackEnabled: false,
  },
  logoAssetId: null,
  faviconAssetId: null,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HTML_PATTERN =
  /<\/?[a-z][^>]*>|javascript:|data:text\/html|\{\s*[^}]*:[^}]*\}/i;
const THEMES = new Set<SiteThemePreset>(["system", "light", "dark"]);
const NAVIGATION = new Set<SiteNavigationItem>(["home", "help", "legal"]);

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${field} contains unsupported fields`);
  }
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    HTML_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function nullableText(value: unknown, field: string, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, field, 1, maximum);
}

function nullableUrl(value: unknown, field: string) {
  const normalized = nullableText(value, field, 2048);
  if (!normalized) return null;
  const match = /^(https?):\/\/([^/?#]+)([^#]*)$/i.exec(normalized);
  const hasControlOrSpace = [...normalized].some(
    (character) => character.charCodeAt(0) <= 0x20,
  );
  if (!match || match[2]!.includes("@") || hasControlOrSpace) {
    throw new Error(`${field} must be a safe HTTP URL`);
  }
  return normalized;
}

function boolean(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function nullableAssetId(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    throw new Error(`${field} must be a UUID`);
  return value.toLowerCase();
}

export function validateSiteConfigDocument(value: unknown): SiteConfigDocument {
  const root = object(value, "config");
  exactKeys(
    root,
    [
      "schemaVersion",
      "siteName",
      "shortName",
      "home",
      "footer",
      "records",
      "links",
      "themePreset",
      "navigation",
      "features",
      "logoAssetId",
      "faviconAssetId",
    ],
    "config",
  );
  if (
    root.schemaVersion !== 1 &&
    root.schemaVersion !== SITE_CONFIG_SCHEMA_VERSION
  )
    throw new Error("config schema version is unsupported");

  const home = object(root.home, "home");
  exactKeys(
    home,
    ["headline", "lead", "description", "primaryActionLabel"],
    "home",
  );
  const footer = object(root.footer, "footer");
  exactKeys(footer, ["description", "copyright"], "footer");
  const records = object(root.records, "records");
  exactKeys(
    records,
    ["companyName", "icpNumber", "publicSecurityNumber"],
    "records",
  );
  const links = object(root.links, "links");
  exactKeys(
    links,
    ["helpUrl", "feedbackUrl", "termsUrl", "privacyUrl", "accountDeletionUrl"],
    "links",
  );
  const features = object(root.features, "features");
  exactKeys(
    features,
    root.schemaVersion === 1
      ? ["registrationEnabled", "feedbackEnabled"]
      : [
          "registrationEnabled",
          "registrationEmailVerificationRequired",
          "feedbackEnabled",
        ],
    "features",
  );

  if (
    typeof root.themePreset !== "string" ||
    !THEMES.has(root.themePreset as SiteThemePreset)
  ) {
    throw new Error("themePreset is invalid");
  }
  if (
    !Array.isArray(root.navigation) ||
    root.navigation.length === 0 ||
    root.navigation.length > NAVIGATION.size
  ) {
    throw new Error("navigation is invalid");
  }
  const navigation = root.navigation.map((item) => {
    if (typeof item !== "string" || !NAVIGATION.has(item as SiteNavigationItem))
      throw new Error("navigation is invalid");
    return item as SiteNavigationItem;
  });
  if (new Set(navigation).size !== navigation.length)
    throw new Error("navigation contains duplicates");

  return {
    schemaVersion: SITE_CONFIG_SCHEMA_VERSION,
    siteName: text(root.siteName, "siteName", 1, 80),
    shortName: text(root.shortName, "shortName", 1, 32),
    home: {
      headline: text(home.headline, "home.headline", 1, 80),
      lead: text(home.lead, "home.lead", 1, 120),
      description: text(home.description, "home.description", 1, 300),
      primaryActionLabel: text(
        home.primaryActionLabel,
        "home.primaryActionLabel",
        1,
        40,
      ),
    },
    footer: {
      description: text(footer.description, "footer.description", 1, 160),
      copyright: text(footer.copyright, "footer.copyright", 1, 120),
    },
    records: {
      companyName: nullableText(
        records.companyName,
        "records.companyName",
        120,
      ),
      icpNumber: nullableText(records.icpNumber, "records.icpNumber", 120),
      publicSecurityNumber: nullableText(
        records.publicSecurityNumber,
        "records.publicSecurityNumber",
        120,
      ),
    },
    links: {
      helpUrl: nullableUrl(links.helpUrl, "links.helpUrl"),
      feedbackUrl: nullableUrl(links.feedbackUrl, "links.feedbackUrl"),
      termsUrl: nullableUrl(links.termsUrl, "links.termsUrl"),
      privacyUrl: nullableUrl(links.privacyUrl, "links.privacyUrl"),
      accountDeletionUrl: nullableUrl(
        links.accountDeletionUrl,
        "links.accountDeletionUrl",
      ),
    },
    themePreset: root.themePreset as SiteThemePreset,
    navigation,
    features: {
      registrationEnabled: boolean(
        features.registrationEnabled,
        "features.registrationEnabled",
      ),
      registrationEmailVerificationRequired:
        root.schemaVersion === 1
          ? false
          : boolean(
              features.registrationEmailVerificationRequired,
              "features.registrationEmailVerificationRequired",
            ),
      feedbackEnabled: boolean(
        features.feedbackEnabled,
        "features.feedbackEnabled",
      ),
    },
    logoAssetId: nullableAssetId(root.logoAssetId, "logoAssetId"),
    faviconAssetId: nullableAssetId(root.faviconAssetId, "faviconAssetId"),
  };
}
