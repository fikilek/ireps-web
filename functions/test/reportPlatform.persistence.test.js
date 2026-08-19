import test from "node:test";
import assert from "node:assert/strict";

import {
  REPORT_STORAGE_METADATA_KEYS,
} from "../reportPlatform/config.js";
import { ReportPlatformError } from "../reportPlatform/contract.js";
import {
  finalizeGeneratedReport,
  prepareGeneratedReport,
} from "../reportPlatform/persistence.js";

const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REPORT_ID = "RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PATH = `generated-reports/user-1/USER_ACTIVITY/${REPORT_ID}/report.xlsx`;
const NOW = new Date("2026-08-19T10:00:00.000Z");

function producerMetadata(overrides = {}) {
  return {
    reportType: "USER_ACTIVITY",
    reportName: "User Activity Report",
    format: "XLSX",
    sourceType: "REPORT",
    sourceId: null,
    sourceScope: { lmPcode: "END", dateRange: "ALL_TIME" },
    itemCount: 5,
    fileName: "report.xlsx",
    ...overrides,
  };
}

function storageNotFound() {
  const error = new Error("not found");
  error.code = 404;
  return error;
}

function storagePreconditionFailed() {
  const error = new Error("precondition failed");
  error.code = 412;
  return error;
}

class FakeBucket {
  constructor(objects = {}) {
    this.objects = structuredClone(objects);
    this.fileCalls = [];
    this.metadataReads = 0;
    this.metadataWriteAttempts = 0;
    this.metadataWrites = 0;
    this.lastMetadataWriteOptions = null;
    this.listCalls = 0;
  }

  file(path) {
    this.fileCalls.push(path);
    const bucket = this;

    return {
      async getMetadata() {
        bucket.metadataReads += 1;
        const metadata = bucket.objects[path];
        if (!metadata) throw storageNotFound();
        return [structuredClone(metadata)];
      },
      async setMetadata(update, options = {}) {
        bucket.metadataWriteAttempts += 1;
        const metadata = bucket.objects[path];
        if (!metadata) throw storageNotFound();

        if (
          options.ifGenerationMatch !== undefined &&
          String(options.ifGenerationMatch) !== String(metadata.generation)
        ) {
          throw storagePreconditionFailed();
        }

        if (
          options.ifMetagenerationMatch !== undefined &&
          String(options.ifMetagenerationMatch) !== String(metadata.metageneration)
        ) {
          throw storagePreconditionFailed();
        }

        bucket.metadataWrites += 1;
        bucket.lastMetadataWriteOptions = structuredClone(options);
        const current = metadata.metadata || {};
        for (const [key, value] of Object.entries(update.metadata || {})) {
          if (value === null) delete current[key];
          else current[key] = value;
        }
        metadata.metadata = current;
        metadata.metageneration = String(Number(metadata.metageneration) + 1);
        return [structuredClone(metadata)];
      },
    };
  }

  async getFiles() {
    this.listCalls += 1;
    return [[]];
  }
}

function uploadedObject(overrides = {}) {
  return {
    contentType: CONTENT_TYPE,
    size: "4096",
    timeCreated: "2026-08-18T10:00:00.000Z",
    generation: "100",
    metageneration: "1",
    metadata: {
      firebaseStorageDownloadTokens: "long-lived-client-token",
      clientNote: "untrusted",
    },
    ...overrides,
  };
}

async function assertBusinessRejection(promise, code, businessCode) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ReportPlatformError);
    assert.equal(error.code, code);
    assert.equal(error.details.businessCode, businessCode);
    return true;
  });
}

test("prepare requires authentication and validates the producer contract", () => {
  assert.throws(
    () => prepareGeneratedReport({
      callerUid: "",
      data: { metadata: producerMetadata() },
      projectId: "ireps2",
      generateReportId: () => REPORT_ID,
    }),
    ReportPlatformError,
  );

  assert.throws(
    () => prepareGeneratedReport({
      callerUid: "user-1",
      data: { metadata: producerMetadata({ format: "PDF" }) },
      projectId: "ireps2",
      generateReportId: () => REPORT_ID,
    }),
    ReportPlatformError,
  );
});

test("prepare generates server identity, path and MIME without touching Storage", () => {
  const result = prepareGeneratedReport({
    callerUid: "user-1",
    data: { metadata: producerMetadata() },
    projectId: "ireps2",
    generateReportId: () => REPORT_ID,
  });

  assert.deepEqual(result, {
    reportId: REPORT_ID,
    storagePath: PATH,
    reportType: "USER_ACTIVITY",
    format: "XLSX",
    fileName: "report.xlsx",
    expectedContentType: CONTENT_TYPE,
  });
});

test("prepare rejects metadata that would produce a non-canonical Storage path", () => {
  assert.throws(
    () => prepareGeneratedReport({
      callerUid: "user-1",
      data: {
        metadata: producerMetadata({ fileName: "nested/report.xlsx" }),
      },
      projectId: "ireps2",
      generateReportId: () => REPORT_ID,
    }),
    (error) =>
      error instanceof ReportPlatformError &&
      error.details.businessCode === "GENERATED_REPORT_PATH_INVALID",
  );
});

test("prepare fails closed for unknown server environment", () => {
  assert.throws(
    () => prepareGeneratedReport({
      callerUid: "user-1",
      data: { metadata: producerMetadata() },
      projectId: "unknown-project",
      generateReportId: () => REPORT_ID,
    }),
    (error) => error.details.businessCode === "REPORT_ENVIRONMENT_UNKNOWN",
  );
});

test("finalize rejects caller-supplied storagePath", async () => {
  const bucket = new FakeBucket({ [PATH]: uploadedObject() });

  await assertBusinessRejection(
    finalizeGeneratedReport({
      bucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        metadata: producerMetadata(),
        storagePath: PATH,
      },
      projectId: "ireps2",
      now: NOW,
    }),
    "invalid-argument",
    "REPORT_PERSISTENCE_FIELD_NOT_ALLOWED",
  );

  assert.equal(bucket.metadataReads, 0);
  assert.equal(bucket.metadataWrites, 0);
});

test("finalize validates uploaded object, stamps only server metadata and revalidates", async () => {
  const bucket = new FakeBucket({ [PATH]: uploadedObject() });

  const result = await finalizeGeneratedReport({
    bucket,
    callerUid: "user-1",
    data: { reportId: REPORT_ID, metadata: producerMetadata() },
    projectId: "ireps2",
    now: NOW,
  });

  assert.deepEqual(result.report, producerMetadata());
  assert.equal(result.lifecycle.reportId, REPORT_ID);
  assert.equal(result.lifecycle.ownerUid, "user-1");
  assert.equal(result.lifecycle.storagePath, PATH);
  assert.equal(result.lifecycle.actualContentType, CONTENT_TYPE);
  assert.equal(result.lifecycle.actualSize, 4096);
  assert.equal(result.lifecycle.environment, "DEV");
  assert.equal(result.lifecycle.status, "READY");

  assert.equal(bucket.metadataReads, 2);
  assert.equal(bucket.metadataWriteAttempts, 1);
  assert.equal(bucket.metadataWrites, 1);
  assert.deepEqual(bucket.lastMetadataWriteOptions, {
    ifGenerationMatch: "100",
    ifMetagenerationMatch: "1",
  });
  assert.equal(bucket.listCalls, 0);

  const customMetadata = bucket.objects[PATH].metadata;
  assert.equal(
    customMetadata[REPORT_STORAGE_METADATA_KEYS.STATE],
    "FINALIZED",
  );
  assert.ok(customMetadata[REPORT_STORAGE_METADATA_KEYS.MANIFEST_B64]);
  assert.equal(
    customMetadata[REPORT_STORAGE_METADATA_KEYS.SCHEMA_VERSION],
    "1",
  );
  assert.equal(customMetadata.firebaseStorageDownloadTokens, undefined);
  assert.equal(customMetadata.clientNote, "untrusted");
});

test("same finalization retry is idempotent and performs no second metadata write", async () => {
  const bucket = new FakeBucket({ [PATH]: uploadedObject() });
  const args = {
    bucket,
    callerUid: "user-1",
    data: { reportId: REPORT_ID, metadata: producerMetadata() },
    projectId: "ireps2",
    now: NOW,
  };

  const first = await finalizeGeneratedReport(args);
  const second = await finalizeGeneratedReport(args);

  assert.deepEqual(second, first);
  assert.equal(bucket.metadataWrites, 1);
  assert.equal(bucket.listCalls, 0);
});

test("concurrent identical finalizers are idempotent with one successful metadata write", async () => {
  const bucket = new FakeBucket({ [PATH]: uploadedObject() });
  const args = {
    bucket,
    callerUid: "user-1",
    data: { reportId: REPORT_ID, metadata: producerMetadata() },
    projectId: "ireps2",
    now: NOW,
  };

  const [first, second] = await Promise.all([
    finalizeGeneratedReport(args),
    finalizeGeneratedReport(args),
  ]);

  assert.deepEqual(second, first);
  assert.equal(bucket.metadataWriteAttempts, 2);
  assert.equal(bucket.metadataWrites, 1);
  assert.equal(bucket.listCalls, 0);
});

test("concurrent conflicting finalizers cannot overwrite the winning manifest", async () => {
  const bucket = new FakeBucket({ [PATH]: uploadedObject() });

  const first = finalizeGeneratedReport({
    bucket,
    callerUid: "user-1",
    data: { reportId: REPORT_ID, metadata: producerMetadata() },
    projectId: "ireps2",
    now: NOW,
  });

  const second = finalizeGeneratedReport({
    bucket,
    callerUid: "user-1",
    data: {
      reportId: REPORT_ID,
      metadata: producerMetadata({ reportName: "Different Report" }),
    },
    projectId: "ireps2",
    now: NOW,
  });

  const results = await Promise.allSettled([first, second]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "already-exists");
  assert.equal(
    rejected[0].reason.details.businessCode,
    "REPORT_FINALIZATION_CONFLICT",
  );
  assert.equal(bucket.metadataWriteAttempts, 2);
  assert.equal(bucket.metadataWrites, 1);

  const winnerName = fulfilled[0].value.report.reportName;
  const encodedManifest =
    bucket.objects[PATH].metadata[REPORT_STORAGE_METADATA_KEYS.MANIFEST_B64];
  const storedManifest = JSON.parse(
    Buffer.from(encodedManifest, "base64").toString("utf8"),
  );

  assert.equal(storedManifest.report.reportName, winnerName);
});

test("conflicting retry is rejected without rewriting finalized metadata", async () => {
  const bucket = new FakeBucket({ [PATH]: uploadedObject() });

  await finalizeGeneratedReport({
    bucket,
    callerUid: "user-1",
    data: { reportId: REPORT_ID, metadata: producerMetadata() },
    projectId: "ireps2",
    now: NOW,
  });

  await assertBusinessRejection(
    finalizeGeneratedReport({
      bucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        metadata: producerMetadata({ reportName: "Different Report" }),
      },
      projectId: "ireps2",
      now: NOW,
    }),
    "already-exists",
    "REPORT_FINALIZATION_CONFLICT",
  );

  assert.equal(bucket.metadataWrites, 1);
});

test("oversized manifest fails closed before metadata write", async () => {
  const bucket = new FakeBucket({ [PATH]: uploadedObject() });
  const hugeMetadata = producerMetadata({
    sourceScope: { payload: "x".repeat(7000) },
  });

  await assertBusinessRejection(
    finalizeGeneratedReport({
      bucket,
      callerUid: "user-1",
      data: { reportId: REPORT_ID, metadata: hugeMetadata },
      projectId: "ireps2",
      now: NOW,
    }),
    "failed-precondition",
    "REPORT_MANIFEST_TOO_LARGE",
  );

  assert.equal(bucket.metadataWrites, 0);
  assert.equal(bucket.listCalls, 0);
});

test("finalize requires authentication before Storage access", async () => {
  const bucket = new FakeBucket({ [PATH]: uploadedObject() });

  await assertBusinessRejection(
    finalizeGeneratedReport({
      bucket,
      callerUid: null,
      data: { reportId: REPORT_ID, metadata: producerMetadata() },
      projectId: "ireps2",
      now: NOW,
    }),
    "unauthenticated",
    "REPORT_AUTH_REQUIRED",
  );

  assert.equal(bucket.fileCalls.length, 0);
});
