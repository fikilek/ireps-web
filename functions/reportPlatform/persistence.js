import { randomUUID } from "node:crypto";

import {
  GENERATED_REPORTS_ROOT,
  REPORT_FINALIZATION_STATE,
  REPORT_MANIFEST_MAX_ENCODED_BYTES,
  REPORT_MANIFEST_SCHEMA_VERSION,
  REPORT_MIME_TYPES,
  REPORT_STORAGE_METADATA_KEYS,
  deriveServerEnvironment,
} from "./config.js";
import {
  ReportPlatformError,
  parseGeneratedReportStoragePath,
  validateReportProducerMetadata,
} from "./contract.js";
import { validateGeneratedReport } from "./validateGeneratedReport.js";

const REPORT_ID_PATTERN = /^RPT_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function normalizeReportId(reportId) {
  if (
    typeof reportId !== "string" ||
    reportId.trim() !== reportId ||
    !REPORT_ID_PATTERN.test(reportId)
  ) {
    fail("invalid-argument", "reportId is invalid.", {
      businessCode: "REPORT_ID_INVALID",
    });
  }

  return reportId;
}

function assertPlainRequest(data, allowedFields) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("invalid-argument", "Report persistence request must be an object.", {
      businessCode: "REPORT_PERSISTENCE_REQUEST_INVALID",
    });
  }

  for (const field of Object.keys(data)) {
    if (!allowedFields.has(field)) {
      fail("invalid-argument", `${field} is not accepted by this report persistence operation.`, {
        businessCode: "REPORT_PERSISTENCE_FIELD_NOT_ALLOWED",
        field,
      });
    }
  }
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

function buildStoragePath(ownerUid, metadata, reportId) {
  return [
    GENERATED_REPORTS_ROOT,
    ownerUid,
    metadata.reportType,
    reportId,
    metadata.fileName,
  ].join("/");
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }

  return value;
}

function sameMetadata(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function buildEncodedManifest(report, lifecycle) {
  const manifest = {
    schemaVersion: REPORT_MANIFEST_SCHEMA_VERSION,
    report,
    lifecycle,
  };

  const encoded = Buffer.from(JSON.stringify(manifest), "utf8").toString("base64");

  if (Buffer.byteLength(encoded, "utf8") > REPORT_MANIFEST_MAX_ENCODED_BYTES) {
    fail("failed-precondition", "Generated report manifest exceeds the allowed size.", {
      businessCode: "REPORT_MANIFEST_TOO_LARGE",
      maxEncodedBytes: REPORT_MANIFEST_MAX_ENCODED_BYTES,
    });
  }

  return encoded;
}

function isStoragePreconditionFailed(error) {
  return error?.code === 412 ||
    error?.code === "412" ||
    error?.response?.statusCode === 412;
}

async function stampFinalizedMetadata(
  bucket,
  storagePath,
  encodedManifest,
  storageVersion,
) {
  if (!bucket || typeof bucket.file !== "function") {
    fail("failed-precondition", "A valid Admin Storage bucket is required.", {
      businessCode: "REPORT_STORAGE_BUCKET_INVALID",
    });
  }

  const file = bucket.file(storagePath);
  if (!file || typeof file.setMetadata !== "function") {
    fail("failed-precondition", "Admin Storage metadata update is unavailable.", {
      businessCode: "REPORT_STORAGE_FILE_INVALID",
    });
  }

  const customMetadata = {
    [REPORT_STORAGE_METADATA_KEYS.STATE]: REPORT_FINALIZATION_STATE,
    [REPORT_STORAGE_METADATA_KEYS.SCHEMA_VERSION]: String(REPORT_MANIFEST_SCHEMA_VERSION),
    [REPORT_STORAGE_METADATA_KEYS.MANIFEST_B64]: encodedManifest,
    firebaseStorageDownloadTokens: null,
  };

  try {
    // Cloud Storage metadata updates are PATCH-like. Setting the Firebase token
    // key to null explicitly removes any long-lived client download token while
    // the three iREPS values are stamped by Admin. Other client metadata is not
    // trusted or consumed by Report Platform.
    await file.setMetadata(
      { metadata: customMetadata },
      {
        ifGenerationMatch: storageVersion.generation,
        ifMetagenerationMatch: storageVersion.metageneration,
      },
    );
    return true;
  } catch (error) {
    if (isStoragePreconditionFailed(error)) {
      return false;
    }

    fail("unavailable", "Generated report could not be finalized in Storage.", {
      businessCode: "REPORT_FINALIZATION_WRITE_FAILED",
      storagePath,
    });
  }
}

export function createGeneratedReportId() {
  return `RPT_${randomUUID()}`;
}

export function prepareGeneratedReport({
  callerUid,
  data,
  projectId,
  generateReportId = createGeneratedReportId,
}) {
  const ownerUid = normalizeCallerUid(callerUid);
  assertPlainRequest(data, new Set(["metadata"]));
  assertServerEnvironment(projectId);

  const metadata = validateReportProducerMetadata(data.metadata);
  const reportId = normalizeReportId(generateReportId());
  const storagePath = buildStoragePath(ownerUid, metadata, reportId);

  // Prepare must never issue a descriptor that violates the same canonical
  // five-segment path contract enforced by validation and Storage Rules.
  parseGeneratedReportStoragePath(storagePath);

  return {
    reportId,
    storagePath,
    reportType: metadata.reportType,
    format: metadata.format,
    fileName: metadata.fileName,
    expectedContentType: REPORT_MIME_TYPES[metadata.format],
  };
}

export async function finalizeGeneratedReport({
  bucket,
  callerUid,
  data,
  projectId,
  now = new Date(),
}) {
  const ownerUid = normalizeCallerUid(callerUid);
  assertPlainRequest(data, new Set(["reportId", "metadata"]));
  assertServerEnvironment(projectId);

  const reportId = normalizeReportId(data.reportId);
  const metadata = validateReportProducerMetadata(data.metadata);
  const storagePath = buildStoragePath(ownerUid, metadata, reportId);

  const preFinalization = await validateGeneratedReport({
    bucket,
    callerUid: ownerUid,
    storagePath,
    projectId,
    now,
    requireFinalized: false,
    includeStorageVersion: true,
  });

  if (preFinalization.finalization.isFinalized) {
    if (!sameMetadata(preFinalization.report, metadata)) {
      fail("already-exists", "Generated report is already finalized with different metadata.", {
        businessCode: "REPORT_FINALIZATION_CONFLICT",
        reportId,
      });
    }

    return {
      report: preFinalization.report,
      lifecycle: lifecycleFromValidation(preFinalization),
    };
  }

  const lifecycle = lifecycleFromValidation(preFinalization);
  const encodedManifest = buildEncodedManifest(metadata, lifecycle);

  const metadataStamped = await stampFinalizedMetadata(
    bucket,
    storagePath,
    encodedManifest,
    preFinalization.storageVersion,
  );

  if (!metadataStamped) {
    const concurrentState = await validateGeneratedReport({
      bucket,
      callerUid: ownerUid,
      storagePath,
      projectId,
      now,
      requireFinalized: false,
    });

    if (concurrentState.finalization.isFinalized) {
      if (!sameMetadata(concurrentState.report, metadata)) {
        fail("already-exists", "Generated report is already finalized with different metadata.", {
          businessCode: "REPORT_FINALIZATION_CONFLICT",
          reportId,
        });
      }

      return {
        report: concurrentState.report,
        lifecycle: lifecycleFromValidation(concurrentState),
      };
    }

    fail("aborted", "Generated report changed concurrently before finalization.", {
      businessCode: "REPORT_FINALIZATION_CONCURRENT_CHANGE",
      reportId,
    });
  }

  const finalized = await validateGeneratedReport({
    bucket,
    callerUid: ownerUid,
    storagePath,
    projectId,
    now,
  });

  if (!sameMetadata(finalized.report, metadata)) {
    fail("failed-precondition", "Finalized report metadata verification failed.", {
      businessCode: "REPORT_FINALIZATION_VERIFICATION_FAILED",
      reportId,
    });
  }

  return {
    report: finalized.report,
    lifecycle: lifecycleFromValidation(finalized),
  };
}
