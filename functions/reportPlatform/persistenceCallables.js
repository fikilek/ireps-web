import { getApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { ReportPlatformError } from "./contract.js";
import {
  finalizeGeneratedReport,
  prepareGeneratedReport,
} from "./persistence.js";

function resolveProjectId() {
  return String(
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    getApp().options.projectId ||
    "",
  ).trim();
}

function toHttpsError(error) {
  if (error instanceof HttpsError) return error;

  if (error instanceof ReportPlatformError) {
    return new HttpsError(error.code, error.message, error.details);
  }

  return new HttpsError("internal", "Report persistence failed.");
}

export const prepareGeneratedReportCallable = onCall(async (request) => {
  try {
    return prepareGeneratedReport({
      callerUid: request.auth?.uid,
      data: request.data,
      projectId: resolveProjectId(),
    });
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const finalizeGeneratedReportCallable = onCall(async (request) => {
  try {
    return await finalizeGeneratedReport({
      bucket: getStorage().bucket(),
      callerUid: request.auth?.uid,
      data: request.data,
      projectId: resolveProjectId(),
      now: new Date(),
    });
  } catch (error) {
    throw toHttpsError(error);
  }
});
