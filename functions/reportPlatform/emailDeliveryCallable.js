import { getApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import nodemailer from "nodemailer";

import { ReportPlatformError } from "./contract.js";
import {
  REPORT_EMAIL_FROM_ADDRESS,
  REPORT_SMTP_HOST,
  REPORT_SMTP_PORT,
  sendGeneratedReportEmail,
} from "./emailDelivery.js";

const reportSmtpPassword = defineSecret("IREPS_REPORT_SMTP_PASSWORD");

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

  return new HttpsError("internal", "Report email delivery failed.");
}

function createReportEmailTransport() {
  const password = reportSmtpPassword.value();

  if (typeof password !== "string" || !password) {
    throw new ReportPlatformError(
      "failed-precondition",
      "Report email credentials are not configured.",
      { businessCode: "REPORT_EMAIL_SECRET_MISSING" },
    );
  }

  return nodemailer.createTransport({
    host: REPORT_SMTP_HOST,
    port: REPORT_SMTP_PORT,
    secure: true,
    auth: {
      user: REPORT_EMAIL_FROM_ADDRESS,
      pass: password,
    },
    tls: {
      servername: REPORT_SMTP_HOST,
    },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

export const sendGeneratedReportEmailCallable = onCall(
  {
    secrets: [reportSmtpPassword],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    try {
      const transport = createReportEmailTransport();

      return await sendGeneratedReportEmail({
        bucket: getStorage().bucket(),
        callerUid: request.auth?.uid,
        data: request.data,
        projectId: resolveProjectId(),
        now: new Date(),
        sendMail: (mail) => transport.sendMail(mail),
      });
    } catch (error) {
      throw toHttpsError(error);
    }
  },
);
