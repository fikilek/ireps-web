import {
  GENERATED_REPORTS_ROOT,
  deriveServerEnvironment,
} from "./config.js";
import {
  ReportPlatformError,
  parseGeneratedReportStoragePath,
} from "./contract.js";
import { validateGeneratedReport } from "./validateGeneratedReport.js";

const REPORT_ID_PATTERN = /^RPT_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE_TOKEN_LENGTH = 4096;
const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;

const SKIPPABLE_LIST_BUSINESS_CODES = new Set([
  "GENERATED_REPORT_PATH_INVALID",
  "REPORT_TYPE_INVALID",
  "REPORT_FORMAT_INVALID",
  "REPORT_FORMAT_MISMATCH",
  "REPORT_FILE_FORMAT_INVALID",
  "REPORT_NOT_FINALIZED",
  "REPORT_FINALIZATION_INVALID",
  "GENERATED_REPORT_EXPIRED",
  "GENERATED_REPORT_NOT_FOUND",
  "REPORT_CONTENT_TYPE_INVALID",
  "REPORT_CONTENT_TYPE_MISMATCH",
  "REPORT_SIZE_INVALID",
  "REPORT_CREATED_AT_INVALID",
]);

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

function assertServerEnvironment(projectId) {
  const environment = deriveServerEnvironment(projectId);

  if (!environment) {
    fail("failed-precondition", "Unknown iREPS Firebase environment.", {
      businessCode: "REPORT_ENVIRONMENT_UNKNOWN",
      projectId: String(projectId || "").trim() || null,
    });
  }

  return environment;
}

function normalizeRequest(data, allowedFields) {
  const request = data === undefined || data === null ? {} : data;

  if (!isPlainObject(request)) {
    fail("invalid-argument", "Generated Reports request must be a plain object.", {
      businessCode: "GENERATED_REPORTS_REQUEST_INVALID",
    });
  }

  for (const field of Object.keys(request)) {
    if (!allowedFields.has(field)) {
      fail("invalid-argument", `${field} is not accepted by this Generated Reports operation.`, {
        businessCode: "GENERATED_REPORTS_FIELD_NOT_ALLOWED",
        field,
      });
    }
  }

  return request;
}

function normalizePageSize(value) {
  if (value === undefined || value === null) return DEFAULT_PAGE_SIZE;

  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    fail("invalid-argument", `pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}.`, {
      businessCode: "REPORT_PAGE_SIZE_INVALID",
      pageSize: value,
    });
  }

  return value;
}

function containsControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }

  return false;
}

function normalizePageToken(value) {
  if (value === undefined || value === null || value === "") return null;

  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    value.length > MAX_PAGE_TOKEN_LENGTH ||
    containsControlCharacters(value)
  ) {
    fail("invalid-argument", "pageToken is invalid.", {
      businessCode: "REPORT_PAGE_TOKEN_INVALID",
    });
  }

  return value;
}

function requireTrimmedText(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    containsControlCharacters(value)
  ) {
    fail("invalid-argument", `${fieldName} must be a non-empty trimmed string.`, {
      businessCode: "GENERATED_REPORT_DELETE_IDENTITY_INVALID",
      field: fieldName,
    });
  }

  return value;
}

function normalizeReportId(value) {
  const reportId = requireTrimmedText(value, "reportId");

  if (!REPORT_ID_PATTERN.test(reportId)) {
    fail("invalid-argument", "reportId is invalid.", {
      businessCode: "REPORT_ID_INVALID",
    });
  }

  return reportId;
}

function buildOwnerPrefix(ownerUid) {
  return `${GENERATED_REPORTS_ROOT}/${ownerUid}/`;
}

function buildCanonicalReportPath(ownerUid, request) {
  const reportId = normalizeReportId(request.reportId);
  const reportType = requireTrimmedText(request.reportType, "reportType").toUpperCase();
  const fileName = requireTrimmedText(request.fileName, "fileName");
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
      businessCode: "GENERATED_REPORT_DELETE_IDENTITY_INVALID",
    });
  }

  return parsed.storagePath;
}

function lifecycleFromValidation(validation) {
  return {
    reportId: validation.reportId,
    ownerUid: validation.ownerUid,
    storagePath: validation.storagePath,
    actualContentType: validation.actualContentType,
    actualSize: validation.actualSize,
    createdAt: validation.createdAt,
    expiresAt: validation.expiresAt,
    environment: validation.environment,
    status: validation.status,
  };
}

function toReportSummary(validation) {
  return {
    report: validation.report,
    lifecycle: lifecycleFromValidation(validation),
  };
}

function shouldSkipListedCandidate(error) {
  return error instanceof ReportPlatformError &&
    SKIPPABLE_LIST_BUSINESS_CODES.has(error.details?.businessCode);
}

function isStorageNotFound(error) {
  return error?.code === 404 ||
    error?.code === "404" ||
    error?.response?.statusCode === 404;
}

function isStoragePreconditionFailed(error) {
  return error?.code === 412 ||
    error?.code === "412" ||
    error?.response?.statusCode === 412;
}

function isStorageBadRequest(error) {
  return error?.code === 400 ||
    error?.code === "400" ||
    error?.response?.statusCode === 400;
}

function readNextPageToken(nextQuery, apiResponse) {
  const token = nextQuery?.pageToken ?? apiResponse?.nextPageToken ?? null;
  return typeof token === "string" && token ? token : null;
}

export async function listGeneratedReports({
  bucket,
  callerUid,
  data,
  projectId,
  now = new Date(),
  validateReport = validateGeneratedReport,
}) {
  const ownerUid = normalizeCallerUid(callerUid);
  const request = normalizeRequest(data, new Set(["pageSize", "pageToken"]));
  assertServerEnvironment(projectId);

  const pageSize = normalizePageSize(request.pageSize);
  const pageToken = normalizePageToken(request.pageToken);
  const prefix = buildOwnerPrefix(ownerUid);

  if (!bucket || typeof bucket.getFiles !== "function") {
    fail("failed-precondition", "A valid Admin Storage bucket is required.", {
      businessCode: "REPORT_STORAGE_BUCKET_INVALID",
    });
  }

  const query = {
    prefix,
    autoPaginate: false,
    maxResults: pageSize,
  };

  if (pageToken) query.pageToken = pageToken;

  let files;
  let nextQuery;
  let apiResponse;

  try {
    [files = [], nextQuery, apiResponse] = await bucket.getFiles(query);
  } catch (error) {
    if (isStorageBadRequest(error) && pageToken) {
      fail("invalid-argument", "pageToken is invalid or expired.", {
        businessCode: "REPORT_PAGE_TOKEN_INVALID",
      });
    }

    fail("unavailable", "Generated Reports could not be listed from Storage.", {
      businessCode: "GENERATED_REPORT_LIST_UNAVAILABLE",
    });
  }

  const reports = [];

  for (const file of files) {
    const storagePath = typeof file?.name === "string" ? file.name : "";

    if (!storagePath) continue;

    if (!storagePath.startsWith(prefix)) {
      fail("failed-precondition", "Storage listing escaped the authenticated owner prefix.", {
        businessCode: "GENERATED_REPORT_LIST_SCOPE_VIOLATION",
      });
    }

    try {
      const validation = await validateReport({
        bucket,
        callerUid: ownerUid,
        storagePath,
        projectId,
        now,
      });

      reports.push(toReportSummary(validation));
    } catch (error) {
      if (shouldSkipListedCandidate(error)) continue;
      throw error;
    }
  }

  return {
    reports,
    nextPageToken: readNextPageToken(nextQuery, apiResponse),
  };
}


export async function createGeneratedReportDownload({
  bucket,
  callerUid,
  data,
  projectId,
  now = new Date(),
  validateReport = validateGeneratedReport,
}) {
  const ownerUid = normalizeCallerUid(callerUid);
  const request = normalizeRequest(
    data,
    new Set(["reportId", "reportType", "fileName"]),
  );
  assertServerEnvironment(projectId);

  const storagePath = buildCanonicalReportPath(ownerUid, request);

  const validation = await validateReport({
    bucket,
    callerUid: ownerUid,
    storagePath,
    projectId,
    now,
    includeStorageVersion: true,
  });

  if (!validation?.storageVersion?.generation) {
    fail("failed-precondition", "Generated report Storage version is unavailable.", {
      businessCode: "REPORT_STORAGE_VERSION_INVALID",
    });
  }

  if (!bucket || typeof bucket.file !== "function") {
    fail("failed-precondition", "A valid Admin Storage bucket is required.", {
      businessCode: "REPORT_STORAGE_BUCKET_INVALID",
    });
  }

  const nowDate = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    fail("invalid-argument", "A valid server time is required.", {
      businessCode: "REPORT_SERVER_TIME_INVALID",
    });
  }

  const expiresAt = new Date(nowDate.getTime() + DOWNLOAD_URL_TTL_MS);
  const file = bucket.file(storagePath, {
    generation: validation.storageVersion.generation,
  });

  if (!file || typeof file.getSignedUrl !== "function") {
    fail("failed-precondition", "Admin Storage signed URL access is unavailable.", {
      businessCode: "REPORT_STORAGE_FILE_INVALID",
    });
  }

  let downloadUrl;

  try {
    [downloadUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresAt,
      promptSaveAs: validation.fileName,
    });
  } catch {
    fail("unavailable", "Generated report download could not be authorized.", {
      businessCode: "GENERATED_REPORT_DOWNLOAD_URL_FAILED",
      reportId: validation.reportId,
    });
  }

  if (typeof downloadUrl !== "string" || !downloadUrl) {
    fail("unavailable", "Generated report download could not be authorized.", {
      businessCode: "GENERATED_REPORT_DOWNLOAD_URL_FAILED",
      reportId: validation.reportId,
    });
  }

  return {
    reportId: validation.reportId,
    fileName: validation.fileName,
    format: validation.format,
    downloadUrl,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function deleteGeneratedReport({
  bucket,
  callerUid,
  data,
  projectId,
  now = new Date(),
  validateReport = validateGeneratedReport,
}) {
  const ownerUid = normalizeCallerUid(callerUid);
  const request = normalizeRequest(
    data,
    new Set(["reportId", "reportType", "fileName"]),
  );
  assertServerEnvironment(projectId);

  const storagePath = buildCanonicalReportPath(ownerUid, request);

  const validation = await validateReport({
    bucket,
    callerUid: ownerUid,
    storagePath,
    projectId,
    now,
    includeStorageVersion: true,
  });

  if (!validation?.storageVersion) {
    fail("failed-precondition", "Generated report Storage version is unavailable.", {
      businessCode: "REPORT_STORAGE_VERSION_INVALID",
    });
  }

  if (!bucket || typeof bucket.file !== "function") {
    fail("failed-precondition", "A valid Admin Storage bucket is required.", {
      businessCode: "REPORT_STORAGE_BUCKET_INVALID",
    });
  }

  const file = bucket.file(storagePath);

  if (!file || typeof file.delete !== "function") {
    fail("failed-precondition", "Admin Storage delete is unavailable.", {
      businessCode: "REPORT_STORAGE_FILE_INVALID",
    });
  }

  try {
    await file.delete({
      ifGenerationMatch: validation.storageVersion.generation,
      ifMetagenerationMatch: validation.storageVersion.metageneration,
    });
  } catch (error) {
    if (isStorageNotFound(error)) {
      fail("not-found", "Generated report object was not found.", {
        businessCode: "GENERATED_REPORT_NOT_FOUND",
        reportId: validation.reportId,
      });
    }

    if (isStoragePreconditionFailed(error)) {
      fail("aborted", "Generated report changed before deletion.", {
        businessCode: "REPORT_DELETE_CONCURRENT_CHANGE",
        reportId: validation.reportId,
      });
    }

    fail("unavailable", "Generated report could not be deleted from Storage.", {
      businessCode: "REPORT_DELETE_FAILED",
      reportId: validation.reportId,
    });
  }

  return {
    reportId: validation.reportId,
    deleted: true,
  };
}
