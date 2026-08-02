export const ANNOUNCEMENT_CATEGORIES = [
  "notice",
  "product_update",
  "maintenance",
] as const;

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];
export type AnnouncementStatus = "draft" | "published" | "archived";

export interface AnnouncementTimelineItem {
  id: string;
  category: AnnouncementCategory;
  title: string;
  content: string;
  publishedAt: string;
  readAt: string | null;
}

export interface AnnouncementTimelineResponse {
  items: AnnouncementTimelineItem[];
  unreadCount: number;
}

export interface MarkAnnouncementsReadRequest {
  announcementIds: string[];
}

export interface MarkAnnouncementsReadResponse {
  readAt: string;
  updatedCount: number;
}

export interface AdminAnnouncement {
  id: string;
  category: AnnouncementCategory;
  status: AnnouncementStatus;
  title: string;
  content: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAnnouncementsResponse {
  items: AdminAnnouncement[];
}

export interface SaveAnnouncementDraftRequest {
  category: AnnouncementCategory;
  title: string;
  content: string;
}

export interface AnnouncementActionResponse {
  announcement: AdminAnnouncement;
}
