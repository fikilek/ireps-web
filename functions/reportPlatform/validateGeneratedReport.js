import {
  REPORT_MIME_TYPES,
  deriveServerEnvironment,
  getReportRetentionDays,
} from "./config.js";
import {
  ReportPlatformError,
  parseGeneratedReportStoragePath,
} from "./contract.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function fail(code, message, details = {}) {
  throw new ReportPlatformError(code, message, details);
}

function normalizeCallerUid(callerUid) {
  if (typeof callerUid !== "string" || !callerUid.trim()) {
    fail("unauthenticated", "Authentication is required.", {
      businessCode: "REPORT_AUTH_REQUIRED",
    });
  }

  return callerUid.trim();
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

async function readExactObjectMetadata(bucket, storagePath) {
  if (!bucket || typeof bucket.file !== "function") {
    fail("failed-precondition", "A valid Admin Storage bucket is required.", {
      businessCode: "REPORT_STORAGE_BUCKET_INVALID",
    });
  }

  const file = bucket.file(storagePath);

  if (!file || typeof file.getMetadata !== "function") {
    fail("failed-precondition", "Admin Storage file metadata access is unavailable.", {
      businessCode: "REPORT_STORAGE_FILE_INVALID",
    });
  }

  try {
    const [metadata] = await file.getMetadata();
    return metadata || {};
  } catch (error) {
    if (isStorageNotFound(error)) {
      fail("not-found", "Generated report object was not found.", {
        businessCode: "GENERATED_REPORT_NOT_FOUND",
        storagePath,
      });
    }

    fail("unavailable", "Generated report metadata could not be read.", {
      businessCode: "GENERATED_REPORT_METADATA_UNAVAILABLE",
      storagePath,
    });
  }
}

function normalizeActualContentType(metadata) {
  const contentType = String(metadata?.contentType || "").trim().toLowerCase();

  if (!contentType) {
    fail("failed-precondition", "Generated report content type is missing.", {
      businessCode: "REPORT_CONTENT_TYPE_INVALID",
    });
  }

  return contentType;
}

function normalizeActualSize(metadata) {
  const size = Number(metadata?.size);

  if (!Number.isSafeInteger(size) || size <= 0) {
    fail("failed-precondition", "Generated report size is invalid.", {
      businessCode: "REPORT_SIZE_INVALID",
      actualSize: metadata?.size ?? null,
    });
  }

  return size;
}

function normalizeCreatedAt(metadata) {
  const createdAt = new Date(metadata?.timeCreated);

  if (Number.isNaN(createdAt.getTime())) {
    fail("failed-precondition", "Generated report creation time is invalid.", {
      businessCode: "REPORT_CREATED_AT_INVALID",
      timeCreated: metadata?.timeCreated ?? null,
    });
  }

  return createdAt;
}

export async function validateGeneratedReport({
  bucket,
  callerUid,
  storagePath,
  projectId,
  now = new Date(),
}) {
  const authenticatedUid = normalizeCallerUid(callerUid);
  const parsedPath = parseGeneratedReportStoragePath(storagePath);

  if (parsedPath.ownerUid !== authenticatedUid) {
    fail("permission-denied", "Generated report access denied.", {
      businessCode: "GENERATED_REPORT_OWNER_MISMATCH",
    });
  }

  const environment = deriveServerEnvironment(projectId);
  if (!environment) {
    fail("failed-precondition", "Unknown iREPS Firebase environment.", {
      businessCode: "REPORT_ENVIRONMENT_UNKNOWN",
      projectId: String(projectId || "").trim() || null,
    });
  }

  const serverNow = normalizeNow(now);
  const metadata = await readExactObjectMetadata(bucket, parsedPath.storagePath);
  const actualContentType = normalizeActualContentType(metadata);
  const actualSize = normalizeActualSize(metadata);
  const createdAt = normalizeCreatedAt(metadata);
  const expectedContentType = REPORT_MIME_TYPES[parsedPath.format].toLowerCase();

  if (actualContentType !== expectedContentType) {
    fail("failed-precondition", "Generated report content type does not match its format.", {
      businessCode: "REPORT_CONTENT_TYPE_MISMATCH",
      format: parsedPath.format,
      actualContentType,
      expectedContentType,
    });
  }

  const retentionDays = getReportRetentionDays(parsedPath.reportType);
  const expiresAt = new Date(
    createdAt.getTime() + retentionDays * MILLISECONDS_PER_DAY,
  );

  if (serverNow.getTime() >= expiresAt.getTime()) {
    fail("failed-precondition", "Generated report has expired.", {
      businessCode: "GENERATED_REPORT_EXPIRED",
      status: "EXPIRED",
      expiresAt: expiresAt.toISOString(),
    });
  }

  return {
    reportId: parsedPath.reportId,
    ownerUid: parsedPath.ownerUid,
    reportType: parsedPath.reportType,
    storagePath: parsedPath.storagePath,
    fileName: parsedPath.fileName,
    format: parsedPath.format,
    actualContentType,
    actualSize,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    environment,
    status: "READY",
  };
}
