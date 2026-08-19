import {
  REPORT_FINALIZATION_STATE,
  REPORT_MANIFEST_MAX_ENCODED_BYTES,
  REPORT_MANIFEST_SCHEMA_VERSION,
  REPORT_MIME_TYPES,
  REPORT_READY_STATUS,
  REPORT_STORAGE_METADATA_KEYS,
  deriveServerEnvironment,
  getReportRetentionDays,
} from "./config.js";
import {
  ReportPlatformError,
  parseGeneratedReportStoragePath,
  validateReportProducerMetadata,
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

function normalizeStorageVersion(metadata) {
  const generation = String(metadata?.generation || "").trim();
  const metageneration = String(metadata?.metageneration || "").trim();

  if (
    !/^\d+$/.test(generation) ||
    !/^\d+$/.test(metageneration) ||
    BigInt(generation) <= 0n ||
    BigInt(metageneration) <= 0n
  ) {
    fail("failed-precondition", "Generated report Storage version is invalid.", {
      businessCode: "REPORT_STORAGE_VERSION_INVALID",
    });
  }

  return {
    generation,
    metageneration,
  };
}

function failInvalidFinalization(message, details = {}) {
  fail("failed-precondition", message, {
    businessCode: "REPORT_FINALIZATION_INVALID",
    ...details,
  });
}

function decodeManifest(encoded) {
  if (typeof encoded !== "string" || !encoded) {
    failInvalidFinalization("Generated report manifest is missing.");
  }

  if (Buffer.byteLength(encoded, "utf8") > REPORT_MANIFEST_MAX_ENCODED_BYTES) {
    failInvalidFinalization("Generated report manifest exceeds the allowed size.");
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    failInvalidFinalization("Generated report manifest encoding is invalid.");
  }

  try {
    const json = Buffer.from(encoded, "base64").toString("utf8");
    const manifest = JSON.parse(json);

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      failInvalidFinalization("Generated report manifest must be an object.");
    }

    return manifest;
  } catch (error) {
    if (error instanceof ReportPlatformError) throw error;
    failInvalidFinalization("Generated report manifest could not be decoded.");
  }
}

function assertLifecycleMatches(manifestLifecycle, lifecycle) {
  if (!manifestLifecycle || typeof manifestLifecycle !== "object" || Array.isArray(manifestLifecycle)) {
    failInvalidFinalization("Generated report lifecycle manifest is invalid.");
  }

  const fields = [
    "reportId",
    "ownerUid",
    "storagePath",
    "actualContentType",
    "actualSize",
    "createdAt",
    "expiresAt",
    "environment",
    "status",
  ];

  for (const field of fields) {
    if (manifestLifecycle[field] !== lifecycle[field]) {
      failInvalidFinalization("Generated report lifecycle manifest does not match Storage truth.", {
        field,
      });
    }
  }
}

function readFinalization(metadata, lifecycle, parsedPath, requireFinalized) {
  const customMetadata = metadata?.metadata && typeof metadata.metadata === "object"
    ? metadata.metadata
    : {};

  const state = customMetadata[REPORT_STORAGE_METADATA_KEYS.STATE];
  const schemaVersion = customMetadata[REPORT_STORAGE_METADATA_KEYS.SCHEMA_VERSION];
  const encodedManifest = customMetadata[REPORT_STORAGE_METADATA_KEYS.MANIFEST_B64];
  const hasAnyMarker = Boolean(state || schemaVersion || encodedManifest);

  if (!hasAnyMarker) {
    if (requireFinalized) {
      fail("failed-precondition", "Generated report has not been finalized.", {
        businessCode: "REPORT_NOT_FINALIZED",
      });
    }

    return {
      isFinalized: false,
      manifest: null,
      report: null,
    };
  }

  if (state !== REPORT_FINALIZATION_STATE) {
    failInvalidFinalization("Generated report finalization state is invalid.");
  }

  if (String(schemaVersion) !== String(REPORT_MANIFEST_SCHEMA_VERSION)) {
    failInvalidFinalization("Generated report manifest schema version is invalid.");
  }

  const manifest = decodeManifest(encodedManifest);

  if (manifest.schemaVersion !== REPORT_MANIFEST_SCHEMA_VERSION) {
    failInvalidFinalization("Generated report manifest schema version does not match.");
  }

  let report;
  try {
    report = validateReportProducerMetadata(manifest.report);
  } catch (error) {
    if (error instanceof ReportPlatformError) {
      failInvalidFinalization("Generated report manifest report metadata is invalid.", {
        causeBusinessCode: error.details?.businessCode || null,
      });
    }
    throw error;
  }

  if (
    report.reportType !== parsedPath.reportType ||
    report.format !== parsedPath.format ||
    report.fileName !== parsedPath.fileName
  ) {
    failInvalidFinalization("Generated report manifest identity does not match its Storage path.");
  }

  assertLifecycleMatches(manifest.lifecycle, lifecycle);

  return {
    isFinalized: true,
    manifest,
    report,
  };
}

export async function validateGeneratedReport({
  bucket,
  callerUid,
  storagePath,
  projectId,
  now = new Date(),
  requireFinalized = true,
  includeStorageVersion = false,
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
  const storageVersion = includeStorageVersion
    ? normalizeStorageVersion(metadata)
    : null;
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

  const lifecycle = {
    reportId: parsedPath.reportId,
    ownerUid: parsedPath.ownerUid,
    storagePath: parsedPath.storagePath,
    actualContentType,
    actualSize,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    environment,
    status: REPORT_READY_STATUS,
  };

  const finalization = readFinalization(
    metadata,
    lifecycle,
    parsedPath,
    requireFinalized,
  );

  return {
    ...lifecycle,
    ...(includeStorageVersion ? { storageVersion } : {}),
    reportType: parsedPath.reportType,
    fileName: parsedPath.fileName,
    format: parsedPath.format,
    report: finalization.report,
    finalization: {
      isFinalized: finalization.isFinalized,
      schemaVersion: finalization.isFinalized
        ? REPORT_MANIFEST_SCHEMA_VERSION
        : null,
    },
  };
}
