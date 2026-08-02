import type {
  AnnouncementTimelineResponse,
  MarkAnnouncementsReadResponse,
} from "@ai-canvas-cloud/contracts";
import { requestCloudJson } from "./cloudApiClient";

export function fetchAnnouncements() {
  return requestCloudJson<AnnouncementTimelineResponse>("/announcements");
}

export function markAnnouncementsRead(announcementIds: string[]) {
  return requestCloudJson<MarkAnnouncementsReadResponse>(
    "/announcements/read",
    {
      method: "POST",
      body: JSON.stringify({ announcementIds }),
    },
  );
}
