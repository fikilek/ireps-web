import {
  GENERATED_REPORTS_ROOT,
  REPORT_FILE_EXTENSIONS,
  REPORT_FORMATS,
  REPORT_FORMAT_VALUES,
  REPORT_TYPE_VALUES,
  getLockedReportFormat,
} from "./config.js";

const SERVER_OWNED_FIELDS = Object.freeze([
  "reportId",
  "ownerUid",
  "storagePath",
  "actualContentType",
  "actualSize",
  "createdAt",
  "expiresAt",
  "environment",
  "status",
]);

const PRODUCER_FIELDS = new Set([
  "reportType",
  "reportName",
  "format",
  "sourceType",
  "sourceId",
  "sourceScope",
  "itemCount",
  "fileName",
]);

function containsControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }

  return false;
}

export class ReportPlatformError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReportPlatformError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ReportPlatformError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireTrimmedText(value, fieldName) {
  if (typeof value !== "string" || value.trim() !== value || !value) {
    fail("invalid-argument", `${fieldName} must be a non-empty trimmed string.`, {
      businessCode: "REPORT_METADATA_INVALID",
      field: fieldName,
    });
  }

  if (containsControlCharacters(value)) {
    fail("invalid-argument", `${fieldName} contains invalid control characters.`, {
      businessCode: "REPORT_METADATA_INVALID",
      field: fieldName,
    });
  }

  return value;
}

function requireCanonicalSegment(value, fieldName) {
  const segment = requireTrimmedText(value, fieldName);

  if (segment === "." || segment === "..") {
    fail("invalid-argument", `${fieldName} is not a valid path segment.`, {
      businessCode: "GENERATED_REPORT_PATH_INVALID",
      field: fieldName,
    });
  }

  return segment;
}

export function inferReportFormatFromFileName(fileName) {
  const normalizedFileName = String(fileName || "").trim().toLowerCase();

  if (normalizedFileName.endsWith(REPORT_FILE_EXTENSIONS.XLSX)) {
    return REPORT_FORMATS.XLSX;
  }

  if (normalizedFileName.endsWith(REPORT_FILE_EXTENSIONS.PDF)) {
    return REPORT_FORMATS.PDF;
  }

  return null;
}

export function assertReportTypeFormat(reportType, format) {
  if (!REPORT_TYPE_VALUES.includes(reportType)) {
    fail("invalid-argument", "Unknown reportType.", {
      businessCode: "REPORT_TYPE_INVALID",
      reportType,
    });
  }

  if (!REPORT_FORMAT_VALUES.includes(format)) {
    fail("invalid-argument", "Unsupported report format.", {
      businessCode: "REPORT_FORMAT_INVALID",
      format,
    });
  }

  const lockedFormat = getLockedReportFormat(reportType);

  if (lockedFormat && format !== lockedFormat) {
    fail("invalid-argument", `${reportType} must use ${lockedFormat}.`, {
      businessCode: "REPORT_FORMAT_MISMATCH",
      reportType,
      format,
      expectedFormat: lockedFormat,
    });
  }
}

function assertProducerKeys(metadata) {
  for (const field of SERVER_OWNED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(metadata, field)) {
      fail("invalid-argument", `${field} is server-owned and cannot be supplied.`, {
        businessCode: "SERVER_OWNED_REPORT_FIELD",
        field,
      });
    }
  }

  for (const field of Object.keys(metadata)) {
    if (!PRODUCER_FIELDS.has(field)) {
      fail("invalid-argument", `${field} is not an allowed report metadata field.`, {
        businessCode: "REPORT_METADATA_FIELD_NOT_ALLOWED",
        field,
      });
    }
  }
}

export function validateReportProducerMetadata(metadata = {}) {
  if (!isPlainObject(metadata)) {
    fail("invalid-argument", "Report metadata must be a plain object.", {
      businessCode: "REPORT_METADATA_INVALID",
    });
  }

  assertProducerKeys(metadata);

  const reportType = requireTrimmedText(metadata.reportType, "reportType").toUpperCase();
  const format = requireTrimmedText(metadata.format, "format").toUpperCase();
  const reportName = requireTrimmedText(metadata.reportName, "reportName");
  const fileName = requireCanonicalSegment(metadata.fileName, "fileName");

  assertReportTypeFormat(reportType, format);

  const fileFormat = inferReportFormatFromFileName(fileName);
  if (fileFormat !== format) {
    fail("invalid-argument", "fileName extension does not match report format.", {
      businessCode: "REPORT_FILE_FORMAT_MISMATCH",
      fileName,
      format,
      inferredFormat: fileFormat,
    });
  }

  if (!Number.isInteger(metadata.itemCount) || metadata.itemCount < 0) {
    fail("invalid-argument", "itemCount must be a non-negative integer.", {
      businessCode: "REPORT_ITEM_COUNT_INVALID",
      itemCount: metadata.itemCount,
    });
  }

  let sourceType = null;
  let sourceId = null;
  let sourceScope = null;

  if (metadata.sourceType !== undefined && metadata.sourceType !== null) {
    sourceType = requireTrimmedText(metadata.sourceType, "sourceType");
  }

  if (metadata.sourceId !== undefined && metadata.sourceId !== null) {
    sourceId = requireTrimmedText(metadata.sourceId, "sourceId");
  }

  if (metadata.sourceScope !== undefined && metadata.sourceScope !== null) {
    if (!isPlainObject(metadata.sourceScope)) {
      fail("invalid-argument", "sourceScope must be a plain object when supplied.", {
        businessCode: "REPORT_SOURCE_SCOPE_INVALID",
      });
    }
    sourceScope = metadata.sourceScope;
  }

  return {
    reportType,
    reportName,
    format,
    sourceType,
    sourceId,
    sourceScope,
    itemCount: metadata.itemCount,
    fileName,
  };
}

export function parseGeneratedReportStoragePath(storagePath) {
  const path = requireTrimmedText(storagePath, "storagePath");
  const parts = path.split("/");

  if (parts.length !== 5 || parts[0] !== GENERATED_REPORTS_ROOT) {
    fail("invalid-argument", "Generated report storagePath has an invalid structure.", {
      businessCode: "GENERATED_REPORT_PATH_INVALID",
    });
  }

  const ownerUid = requireCanonicalSegment(parts[1], "ownerUid");
  const reportType = requireCanonicalSegment(parts[2], "reportType");
  const reportId = requireCanonicalSegment(parts[3], "reportId");
  const fileName = requireCanonicalSegment(parts[4], "fileName");

  if (!REPORT_TYPE_VALUES.includes(reportType)) {
    fail("invalid-argument", "Generated report path contains an unknown reportType.", {
      businessCode: "REPORT_TYPE_INVALID",
      reportType,
    });
  }

  const format = inferReportFormatFromFileName(fileName);
  if (!format) {
    fail("invalid-argument", "Generated report file extension is unsupported.", {
      businessCode: "REPORT_FILE_FORMAT_INVALID",
      fileName,
    });
  }

  assertReportTypeFormat(reportType, format);

  return {
    storagePath: path,
    ownerUid,
    reportType,
    reportId,
    fileName,
    format,
  };
}
