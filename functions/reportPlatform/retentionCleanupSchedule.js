import { getApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { cleanupGeneratedReports } from "./retentionCleanup.js";

function resolveProjectId() {
  return String(
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    getApp().options.projectId ||
    "",
  ).trim();
}

export const onGeneratedReportsRetentionCleanup = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "Africa/Johannesburg",
  },
  async () => {
    const result = await cleanupGeneratedReports({
      bucket: getStorage().bucket(),
      projectId: resolveProjectId(),
      now: new Date(),
    });

    logger.info("Generated report retention cleanup completed.", result);
  },
);
