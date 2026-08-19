import {
  GENERATED_REPORTS_ROOT,
  deriveServerEnvironment,
  getReportRetentionDays,
} from "./config.js";
import {
  ReportPlatformError,
  parseGeneratedReportStoragePath,
} from "./contract.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const CLEANUP_PAGE_SIZE = 1000;
const REPORT_ID_PATTERN =
  /^RPT_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code, message, details = {}) {
  throw new ReportPlatformError(code, message, details);
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

function isStoragePreconditionFailed(error) {
  return error?.code === 412 ||
    error?.code === "412" ||
    error?.response?.statusCode === 412;
}

function readNextPageToken(nextQuery, apiResponse) {
  const token = nextQuery?.pageToken ?? apiResponse?.nextPageToken ?? null;
  return typeof token === "string" && token ? token : null;
}

function parseCleanupCandidate(storagePath) {
  if (
    typeof storagePath !== "string" ||
    !storagePath.startsWith(`${GENERATED_REPORTS_ROOT}/`)
  ) {
    return null;
  }

  try {
    const parsed = parseGeneratedReportStoragePath(storagePath);

    if (!REPORT_ID_PATTERN.test(parsed.reportId)) return null;

    return parsed;
  } catch (error) {
    if (error instanceof ReportPlatformError) return null;
    throw error;
  }
}

function normalizeCandidateMetadata(metadata) {
  const createdAt = new Date(metadata?.timeCreated);
  const generation = String(metadata?.generation || "").trim();
  const metageneration = String(metadata?.metageneration || "").trim();

  if (
    Number.isNaN(createdAt.getTime()) ||
    !/^\d+$/.test(generation) ||
    !/^\d+$/.test(metageneration) ||
    BigInt(generation) <= 0n ||
    BigInt(metageneration) <= 0n
  ) {
    return null;
  }

  return {
    createdAt,
    generation,
    metageneration,
  };
}

async function readExactMetadata(bucket, storagePath) {
  if (!bucket || typeof bucket.file !== "function") {
    fail("failed-precondition", "A valid Admin Storage bucket is required.", {
      businessCode: "REPORT_STORAGE_BUCKET_INVALID",
    });
  }

  const file = bucket.file(storagePath);

  if (!file || typeof file.getMetadata !== "function") {
    fail("failed-precondition", "Admin Storage metadata access is unavailable.", {
      businessCode: "REPORT_STORAGE_FILE_INVALID",
      storagePath,
    });
  }

  try {
    const [metadata] = await file.getMetadata();
    return {
      file,
      metadata: metadata || {},
    };
  } catch (error) {
    if (isStorageNotFound(error)) {
      return {
        file,
        metadata: null,
      };
    }

    fail("unavailable", "Generated report retention metadata could not be read.", {
      businessCode: "REPORT_RETENTION_METADATA_UNAVAILABLE",
      storagePath,
    });
  }
}

async function deleteExpiredObject(file, storagePath, version) {
  if (!file || typeof file.delete !== "function") {
    fail("failed-precondition", "Admin Storage delete is unavailable.", {
      businessCode: "REPORT_STORAGE_FILE_INVALID",
      storagePath,
    });
  }

  try {
    await file.delete({
      ifGenerationMatch: version.generation,
      ifMetagenerationMatch: version.metageneration,
    });

    return "DELETED";
  } catch (error) {
    if (isStorageNotFound(error)) return "DISAPPEARED";
    if (isStoragePreconditionFailed(error)) return "CONCURRENT_CHANGE";

    fail("unavailable", "Expired generated report could not be deleted.", {
      businessCode: "REPORT_RETENTION_DELETE_FAILED",
      storagePath,
    });
  }
}

export async function cleanupGeneratedReports({
  bucket,
  projectId,
  now = new Date(),
}) {
  const environment = assertServerEnvironment(projectId);
  const serverNow = normalizeNow(now);

  if (!bucket || typeof bucket.getFiles !== "function") {
    fail("failed-precondition", "A valid Admin Storage bucket is required.", {
      businessCode: "REPORT_STORAGE_BUCKET_INVALID",
    });
  }

  const prefix = `${GENERATED_REPORTS_ROOT}/`;
  const result = {
    environment,
    startedAt: serverNow.toISOString(),
    pages: 0,
    scanned: 0,
    deleted: 0,
    retained: 0,
    malformed: 0,
    metadataInvalid: 0,
    disappeared: 0,
    concurrentChanged: 0,
  };

  let pageToken = null;
  const seenPageTokens = new Set();

  do {
    const query = {
      prefix,
      autoPaginate: false,
      maxResults: CLEANUP_PAGE_SIZE,
    };

    if (pageToken) query.pageToken = pageToken;

    let files;
    let nextQuery;
    let apiResponse;

    try {
      [files = [], nextQuery, apiResponse] = await bucket.getFiles(query);
    } catch {
      fail("unavailable", "Generated report retention listing failed.", {
        businessCode: "REPORT_RETENTION_LIST_UNAVAILABLE",
      });
    }

    result.pages += 1;

    for (const listedFile of files) {
      const storagePath =
        typeof listedFile?.name === "string" ? listedFile.name : "";

      result.scanned += 1;

      if (!storagePath.startsWith(prefix)) {
        fail(
          "failed-precondition",
          "Retention listing escaped the generated reports prefix.",
          {
            businessCode: "REPORT_RETENTION_LIST_SCOPE_VIOLATION",
            storagePath: storagePath || null,
          },
        );
      }

      const parsed = parseCleanupCandidate(storagePath);

      if (!parsed) {
        result.malformed += 1;
        continue;
      }

      const exact = await readExactMetadata(bucket, parsed.storagePath);

      if (!exact.metadata) {
        result.disappeared += 1;
        continue;
      }

      const version = normalizeCandidateMetadata(exact.metadata);

      if (!version) {
        result.metadataInvalid += 1;
        continue;
      }

      const retentionDays = getReportRetentionDays(parsed.reportType);
      const expiresAt = new Date(
        version.createdAt.getTime() + retentionDays * MILLISECONDS_PER_DAY,
      );

      if (serverNow.getTime() < expiresAt.getTime()) {
        result.retained += 1;
        continue;
      }

      const outcome = await deleteExpiredObject(
        exact.file,
        parsed.storagePath,
        version,
      );

      if (outcome === "DELETED") result.deleted += 1;
      else if (outcome === "DISAPPEARED") result.disappeared += 1;
      else if (outcome === "CONCURRENT_CHANGE") result.concurrentChanged += 1;
    }

    const nextPageToken = readNextPageToken(nextQuery, apiResponse);

    if (nextPageToken && seenPageTokens.has(nextPageToken)) {
      fail("failed-precondition", "Retention listing returned a repeated page token.", {
        businessCode: "REPORT_RETENTION_PAGE_TOKEN_LOOP",
      });
    }

    if (nextPageToken) seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  } while (pageToken);

  return {
    ...result,
    completedAt: new Date().toISOString(),
  };
}
