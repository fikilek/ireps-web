import { GENERATED_REPORTS_ROOT } from "./config.js";
import {
  ReportPlatformError,
  parseGeneratedReportStoragePath,
} from "./contract.js";
import { validateGeneratedReport } from "./validateGeneratedReport.js";

export const REPORT_EMAIL_FROM_ADDRESS = "reports@ireps.co.za";
export const REPORT_EMAIL_FROM_NAME = "iREPS Reports";
export const REPORT_SMTP_HOST = "mail.ireps.co.za";
export const REPORT_SMTP_PORT = 465;

export const REPORT_EMAIL_NO_REPLY_NOTICE = [
  "This report was generated and sent by iREPS.",
  "",
  "Please do not reply to this email.",
  `${REPORT_EMAIL_FROM_ADDRESS} is an automated, unsupervised reporting mailbox and incoming messages are not monitored.`,
].join("\n");

const REPORT_ID_PATTERN = /^RPT_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECIPIENT_LENGTH = 254;
const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000;

function fail(code, message, details = {}) {
  throw new ReportPlatformError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeCallerUid(callerUid) {
  if (typeof callerUid !== "string" || !callerUid.trim()) {
    fail("unauthenticated", "Authentication is required.", {
      businessCode: "REPORT_AUTH_REQUIRED",
    });
  }

  return callerUid.trim();
}

function containsHeaderControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }

  return false;
}

function containsUnsafeBodyControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code <= 31 || code === 127) return true;
  }

  return false;
}

function normalizeRequest(data) {
  if (!isPlainObject(data)) {
    fail("invalid-argument", "Report email request must be a plain object.", {
      businessCode: "REPORT_EMAIL_REQUEST_INVALID",
    });
  }

  const allowedFields = new Set([
    "reportId",
    "reportType",
    "fileName",
    "to",
    "subject",
    "message",
  ]);

  for (const field of Object.keys(data)) {
    if (!allowedFields.has(field)) {
      fail("invalid-argument", `${field} is not accepted by report email delivery.`, {
        businessCode: "REPORT_EMAIL_FIELD_NOT_ALLOWED",
        field,
      });
    }
  }

  return data;
}

function requireTrimmedHeaderText(value, fieldName, maxLength) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    value.length > maxLength ||
    containsHeaderControlCharacters(value)
  ) {
    fail("invalid-argument", `${fieldName} is invalid.`, {
      businessCode: "REPORT_EMAIL_FIELD_INVALID",
      field: fieldName,
    });
  }

  return value;
}

function normalizeRecipient(value) {
  const recipient = requireTrimmedHeaderText(value, "to", MAX_RECIPIENT_LENGTH);
  const parts = recipient.split("@");

  if (parts.length !== 2) {
    fail("invalid-argument", "Recipient email address is invalid.", {
      businessCode: "REPORT_EMAIL_RECIPIENT_INVALID",
    });
  }

  const [localPart, domain] = parts;
  const localPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
  const domainPattern = /^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i;

  if (
    !localPart ||
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !localPattern.test(localPart) ||
    !domainPattern.test(domain)
  ) {
    fail("invalid-argument", "Recipient email address is invalid.", {
      businessCode: "REPORT_EMAIL_RECIPIENT_INVALID",
    });
  }

  return recipient;
}

function normalizeSubject(value) {
  return requireTrimmedHeaderText(value, "subject", MAX_SUBJECT_LENGTH);
}

function normalizeMessage(value) {
  if (value === undefined || value === null) return "";

  if (
    typeof value !== "string" ||
    value.length > MAX_MESSAGE_LENGTH ||
    containsUnsafeBodyControlCharacters(value)
  ) {
    fail("invalid-argument", "message is invalid.", {
      businessCode: "REPORT_EMAIL_FIELD_INVALID",
      field: "message",
    });
  }

  return value.trim();
}

function normalizeReportId(value) {
  const reportId = requireTrimmedHeaderText(value, "reportId", 64);

  if (!REPORT_ID_PATTERN.test(reportId)) {
    fail("invalid-argument", "reportId is invalid.", {
      businessCode: "REPORT_ID_INVALID",
    });
  }

  return reportId;
}

function buildCanonicalReportPath(ownerUid, request) {
  const reportId = normalizeReportId(request.reportId);
  const reportType = requireTrimmedHeaderText(request.reportType, "reportType", 80).toUpperCase();
  const fileName = requireTrimmedHeaderText(request.fileName, "fileName", 240);
  const storagePath = [
    GENERATED_REPORTS_ROOT,
    ownerUid,
    reportType,
    reportId,
    fileName,
  ].join("/");

  const parsed = parseGeneratedReportStoragePath(storagePath);

  if (parsed.reportId !== reportId) {
    fail("invalid-argument", "Generated report identity is invalid.", {
      businessCode: "REPORT_EMAIL_REPORT_IDENTITY_INVALID",
    });
  }

  return parsed.storagePath;
}

function normalizeNow(now) {
  const value = now instanceof Date ? new Date(now.getTime()) : new Date(now);

  if (Number.isNaN(value.getTime())) {
    fail("invalid-argument", "A valid server time is required.", {
      businessCode: "REPORT_SERVER_TIME_INVALID",
    });
  }

  return value;
}

function isStorageNotFound(error) {
  return error?.code === 404 ||
    error?.code === "404" ||
    error?.response?.statusCode === 404;
}

async function readValidatedReportBytes(bucket, validation) {
  if (!bucket || typeof bucket.file !== "function") {
    fail("failed-precondition", "A valid Admin Storage bucket is required.", {
      businessCode: "REPORT_STORAGE_BUCKET_INVALID",
    });
  }

  const generation = validation?.storageVersion?.generation;
  if (typeof generation !== "string" || !/^\d+$/.test(generation)) {
    fail("failed-precondition", "Generated report Storage version is unavailable.", {
      businessCode: "REPORT_STORAGE_VERSION_INVALID",
    });
  }

  const file = bucket.file(validation.storagePath, { generation });
  if (!file || typeof file.download !== "function") {
    fail("failed-precondition", "Admin Storage download access is unavailable.", {
      businessCode: "REPORT_STORAGE_FILE_INVALID",
    });
  }

  try {
    const [bytes] = await file.download();
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);

    if (!buffer.length || buffer.length !== validation.actualSize) {
      fail("failed-precondition", "Generated report bytes do not match validated Storage metadata.", {
        businessCode: "REPORT_EMAIL_ATTACHMENT_SIZE_MISMATCH",
        expectedSize: validation.actualSize,
        actualSize: buffer.length,
      });
    }

    return buffer;
  } catch (error) {
    if (error instanceof ReportPlatformError) throw error;

    if (isStorageNotFound(error)) {
      fail("aborted", "Generated report changed before email delivery.", {
        businessCode: "REPORT_EMAIL_ATTACHMENT_VERSION_CHANGED",
      });
    }

    fail("unavailable", "Generated report attachment could not be read.", {
      businessCode: "REPORT_EMAIL_ATTACHMENT_READ_FAILED",
    });
  }
}

export function buildReportEmailText(message) {
  const body = String(message || "").trim() || "Please find the attached iREPS report.";
  return [body, "", "---", REPORT_EMAIL_NO_REPLY_NOTICE].join("\n");
}

export async function sendGeneratedReportEmail({
  bucket,
  callerUid,
  data,
  projectId,
  now = new Date(),
  validateReport = validateGeneratedReport,
  sendMail,
}) {
  const ownerUid = normalizeCallerUid(callerUid);
  const request = normalizeRequest(data);
  const recipient = normalizeRecipient(request.to);
  const subject = normalizeSubject(request.subject);
  const message = normalizeMessage(request.message);
  const storagePath = buildCanonicalReportPath(ownerUid, request);
  const serverNow = normalizeNow(now);

  if (typeof sendMail !== "function") {
    fail("failed-precondition", "Report email transport is unavailable.", {
      businessCode: "REPORT_EMAIL_TRANSPORT_INVALID",
    });
  }

  const validation = await validateReport({
    bucket,
    callerUid: ownerUid,
    storagePath,
    projectId,
    now: serverNow,
    includeStorageVersion: true,
  });

  const attachmentBytes = await readValidatedReportBytes(bucket, validation);
  const mail = {
    from: {
      name: REPORT_EMAIL_FROM_NAME,
      address: REPORT_EMAIL_FROM_ADDRESS,
    },
    to: recipient,
    subject,
    text: buildReportEmailText(message),
    attachments: [
      {
        filename: validation.fileName,
        content: attachmentBytes,
        contentType: validation.actualContentType,
        contentDisposition: "attachment",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
    },
    disableFileAccess: true,
    disableUrlAccess: true,
  };

  try {
    await sendMail(mail);
  } catch {
    fail("unavailable", "Report email could not be sent.", {
      businessCode: "REPORT_EMAIL_SEND_FAILED",
      reportId: validation.reportId,
    });
  }

  return {
    sent: true,
    reportId: validation.reportId,
    sentAt: serverNow.toISOString(),
  };
}
