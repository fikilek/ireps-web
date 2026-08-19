import test from "node:test";
import assert from "node:assert/strict";

import {
  REPORT_FINALIZATION_STATE,
  REPORT_MANIFEST_SCHEMA_VERSION,
  REPORT_STORAGE_METADATA_KEYS,
} from "../reportPlatform/config.js";
import { ReportPlatformError } from "../reportPlatform/contract.js";
import { validateGeneratedReport } from "../reportPlatform/validateGeneratedReport.js";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_CONTENT_TYPE = "application/pdf";
const CREATED_AT = "2026-08-18T10:00:00.000Z";
const VALID_NOW = new Date("2026-08-19T10:00:00.000Z");

function storageNotFound() {
  const error = new Error("not found");
  error.code = 404;
  return error;
}

class FakeBucket {
  constructor(objects = {}) {
    this.objects = structuredClone(objects);
    this.fileCalls = [];
    this.metadataReads = 0;
    this.listCalls = 0;
    this.writeCalls = 0;
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
      async setMetadata(update) {
        bucket.writeCalls += 1;
        const metadata = bucket.objects[path];
        if (!metadata) throw storageNotFound();
        metadata.metadata = structuredClone(update.metadata || {});
        return [structuredClone(metadata)];
      },
      async save() {
        bucket.writeCalls += 1;
      },
      async delete() {
        bucket.writeCalls += 1;
      },
    };
  }

  async getFiles() {
    this.listCalls += 1;
    return [[]];
  }
}

function xlsxPath(ownerUid = "user-1") {
  return `generated-reports/${ownerUid}/USER_ACTIVITY/RPT_11111111-1111-4111-8111-111111111111/report.xlsx`;
}

function pdfPath(ownerUid = "user-1") {
  return `generated-reports/${ownerUid}/QUICK_TRN/RPT_22222222-2222-4222-8222-222222222222/report.pdf`;
}

function reportMetadata({ format = "XLSX", fileName = "report.xlsx" } = {}) {
  return {
    reportType: format === "PDF" ? "QUICK_TRN" : "USER_ACTIVITY",
    reportName: format === "PDF" ? "Quick TRN Report" : "User Activity Report",
    format,
    sourceType: "REPORT",
    sourceId: null,
    sourceScope: { lmPcode: "END" },
    itemCount: 3,
    fileName,
  };
}

function lifecycleFor({
  path,
  contentType,
  size,
  reportId,
  ownerUid = "user-1",
  environment = "DEV",
}) {
  return {
    reportId,
    ownerUid,
    storagePath: path,
    actualContentType: contentType,
    actualSize: size,
    createdAt: CREATED_AT,
    expiresAt: "2026-08-21T10:00:00.000Z",
    environment,
    status: "READY",
  };
}

function finalizedMetadata({
  path,
  report,
  contentType,
  size,
  reportId,
  ownerUid = "user-1",
  environment = "DEV",
}) {
  const lifecycle = lifecycleFor({
    path,
    contentType,
    size,
    reportId,
    ownerUid,
    environment,
  });
  const manifest = {
    schemaVersion: REPORT_MANIFEST_SCHEMA_VERSION,
    report,
    lifecycle,
  };

  return {
    contentType,
    size: String(size),
    timeCreated: CREATED_AT,
    metadata: {
      [REPORT_STORAGE_METADATA_KEYS.STATE]: REPORT_FINALIZATION_STATE,
      [REPORT_STORAGE_METADATA_KEYS.SCHEMA_VERSION]: String(REPORT_MANIFEST_SCHEMA_VERSION),
      [REPORT_STORAGE_METADATA_KEYS.MANIFEST_B64]: Buffer.from(
        JSON.stringify(manifest),
        "utf8",
      ).toString("base64"),
    },
  };
}

function validFinalizedXlsxMetadata(path = xlsxPath()) {
  return finalizedMetadata({
    path,
    report: reportMetadata(),
    contentType: XLSX_CONTENT_TYPE,
    size: 9842,
    reportId: "RPT_11111111-1111-4111-8111-111111111111",
  });
}

function validUnfinalizedXlsxMetadata(overrides = {}) {
  return {
    contentType: XLSX_CONTENT_TYPE,
    size: "9842",
    timeCreated: CREATED_AT,
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

test("validator returns trusted metadata from a finalized XLSX object", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket({ [path]: validFinalizedXlsxMetadata(path) });

  const result = await validateGeneratedReport({
    bucket,
    callerUid: "user-1",
    storagePath: path,
    projectId: "ireps2",
    now: VALID_NOW,
  });

  assert.equal(result.actualContentType, XLSX_CONTENT_TYPE);
  assert.equal(result.actualSize, 9842);
  assert.equal(result.environment, "DEV");
  assert.equal(result.finalization.isFinalized, true);
  assert.deepEqual(result.report, reportMetadata());
  assert.deepEqual(bucket.fileCalls, [path]);
  assert.equal(bucket.metadataReads, 1);
  assert.equal(bucket.listCalls, 0);
  assert.equal(bucket.writeCalls, 0);
});

test("unfinalized objects are rejected by default", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket({ [path]: validUnfinalizedXlsxMetadata() });

  await assertBusinessRejection(
    validateGeneratedReport({
      bucket,
      callerUid: "user-1",
      storagePath: path,
      projectId: "ireps2",
      now: VALID_NOW,
    }),
    "failed-precondition",
    "REPORT_NOT_FINALIZED",
  );
});

test("finalizer pre-check may explicitly validate an unfinalized object", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket({ [path]: validUnfinalizedXlsxMetadata() });

  const result = await validateGeneratedReport({
    bucket,
    callerUid: "user-1",
    storagePath: path,
    projectId: "ireps2",
    now: VALID_NOW,
    requireFinalized: false,
  });

  assert.equal(result.finalization.isFinalized, false);
  assert.equal(result.report, null);
  assert.equal(result.actualSize, 9842);
});

test("validator accepts a finalized PDF and enforces actual MIME", async () => {
  const path = pdfPath();
  const report = reportMetadata({ format: "PDF", fileName: "report.pdf" });
  const bucket = new FakeBucket({
    [path]: finalizedMetadata({
      path,
      report,
      contentType: PDF_CONTENT_TYPE,
      size: 2048,
      reportId: "RPT_22222222-2222-4222-8222-222222222222",
      environment: "TEST",
    }),
  });

  const result = await validateGeneratedReport({
    bucket,
    callerUid: "user-1",
    storagePath: path,
    projectId: "ireps-test",
    now: VALID_NOW,
  });

  assert.equal(result.format, "PDF");
  assert.equal(result.actualContentType, PDF_CONTENT_TYPE);
  assert.equal(result.environment, "TEST");
});

test("cross-owner validation is denied before any Storage lookup", async () => {
  const path = xlsxPath("owner-a");
  const bucket = new FakeBucket();

  await assertBusinessRejection(
    validateGeneratedReport({
      bucket,
      callerUid: "owner-b",
      storagePath: path,
      projectId: "ireps2",
      now: VALID_NOW,
    }),
    "permission-denied",
    "GENERATED_REPORT_OWNER_MISMATCH",
  );

  assert.equal(bucket.fileCalls.length, 0);
  assert.equal(bucket.metadataReads, 0);
  assert.equal(bucket.listCalls, 0);
  assert.equal(bucket.writeCalls, 0);
});

test("missing object is rejected after one exact metadata read", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket();

  await assertBusinessRejection(
    validateGeneratedReport({
      bucket,
      callerUid: "user-1",
      storagePath: path,
      projectId: "ireps2",
      now: VALID_NOW,
      requireFinalized: false,
    }),
    "not-found",
    "GENERATED_REPORT_NOT_FOUND",
  );

  assert.deepEqual(bucket.fileCalls, [path]);
  assert.equal(bucket.metadataReads, 1);
  assert.equal(bucket.listCalls, 0);
  assert.equal(bucket.writeCalls, 0);
});

test("MIME mismatch and invalid size fail closed", async () => {
  const path = xlsxPath();

  const wrongMimeBucket = new FakeBucket({
    [path]: validUnfinalizedXlsxMetadata({ contentType: "image/jpeg" }),
  });
  await assertBusinessRejection(
    validateGeneratedReport({
      bucket: wrongMimeBucket,
      callerUid: "user-1",
      storagePath: path,
      projectId: "ireps2",
      now: VALID_NOW,
      requireFinalized: false,
    }),
    "failed-precondition",
    "REPORT_CONTENT_TYPE_MISMATCH",
  );

  for (const size of ["0", "-1", "not-a-number"]) {
    const bucket = new FakeBucket({
      [path]: validUnfinalizedXlsxMetadata({ size }),
    });
    await assertBusinessRejection(
      validateGeneratedReport({
        bucket,
        callerUid: "user-1",
        storagePath: path,
        projectId: "ireps2",
        now: VALID_NOW,
        requireFinalized: false,
      }),
      "failed-precondition",
      "REPORT_SIZE_INVALID",
    );
  }
});

test("createdAt and 3-day expiry remain derived from Storage metadata", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket({
    [path]: validUnfinalizedXlsxMetadata({
      size: "12345",
      timeCreated: "2026-08-10T12:30:00.000Z",
    }),
  });

  const result = await validateGeneratedReport({
    bucket,
    callerUid: "user-1",
    storagePath: path,
    projectId: "ireps-5c3e9",
    now: new Date("2026-08-11T12:30:00.000Z"),
    requireFinalized: false,
  });

  assert.equal(result.actualSize, 12345);
  assert.equal(result.createdAt, "2026-08-10T12:30:00.000Z");
  assert.equal(result.expiresAt, "2026-08-13T12:30:00.000Z");
  assert.equal(result.environment, "LIVE");
});

test("expired reports are rejected at the exact expiry boundary", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket({ [path]: validUnfinalizedXlsxMetadata() });

  await assertBusinessRejection(
    validateGeneratedReport({
      bucket,
      callerUid: "user-1",
      storagePath: path,
      projectId: "ireps2",
      now: new Date("2026-08-21T10:00:00.000Z"),
      requireFinalized: false,
    }),
    "failed-precondition",
    "GENERATED_REPORT_EXPIRED",
  );
});

test("environment derivation remains fail-closed", async () => {
  const environments = [
    ["ireps2", "DEV"],
    ["ireps-test", "TEST"],
    ["ireps-5c3e9", "LIVE"],
    ["demo-ireps-report-platform", "DEMO"],
  ];

  for (const [projectId, expected] of environments) {
    const path = xlsxPath();
    const bucket = new FakeBucket({ [path]: validUnfinalizedXlsxMetadata() });
    const result = await validateGeneratedReport({
      bucket,
      callerUid: "user-1",
      storagePath: path,
      projectId,
      now: VALID_NOW,
      requireFinalized: false,
    });
    assert.equal(result.environment, expected);
  }

  const unknownBucket = new FakeBucket({
    [xlsxPath()]: validUnfinalizedXlsxMetadata(),
  });
  await assertBusinessRejection(
    validateGeneratedReport({
      bucket: unknownBucket,
      callerUid: "user-1",
      storagePath: xlsxPath(),
      projectId: "unknown-project",
      now: VALID_NOW,
      requireFinalized: false,
    }),
    "failed-precondition",
    "REPORT_ENVIRONMENT_UNKNOWN",
  );
  assert.equal(unknownBucket.metadataReads, 0);
});

test("tampered finalized manifests fail closed", async () => {
  const path = xlsxPath();
  const metadata = validFinalizedXlsxMetadata(path);
  const manifest = JSON.parse(
    Buffer.from(
      metadata.metadata[REPORT_STORAGE_METADATA_KEYS.MANIFEST_B64],
      "base64",
    ).toString("utf8"),
  );
  manifest.lifecycle.actualSize = 1;
  metadata.metadata[REPORT_STORAGE_METADATA_KEYS.MANIFEST_B64] = Buffer.from(
    JSON.stringify(manifest),
    "utf8",
  ).toString("base64");
  const bucket = new FakeBucket({ [path]: metadata });

  await assertBusinessRejection(
    validateGeneratedReport({
      bucket,
      callerUid: "user-1",
      storagePath: path,
      projectId: "ireps2",
      now: VALID_NOW,
    }),
    "failed-precondition",
    "REPORT_FINALIZATION_INVALID",
  );
});

test("malformed paths and unknown report types never reach Storage", async () => {
  const bucket = new FakeBucket();
  const badPaths = [
    "generated-reports/user-1/USER_ACTIVITY",
    "generated-reports/user-1/UNKNOWN/RPT_1/report.xlsx",
    "generated-reports/user-1/USER_ACTIVITY/RPT_1/sub/report.xlsx",
  ];

  for (const storagePath of badPaths) {
    await assert.rejects(
      validateGeneratedReport({
        bucket,
        callerUid: "user-1",
        storagePath,
        projectId: "ireps2",
        now: VALID_NOW,
      }),
      ReportPlatformError,
    );
  }

  assert.equal(bucket.fileCalls.length, 0);
  assert.equal(bucket.metadataReads, 0);
  assert.equal(bucket.listCalls, 0);
  assert.equal(bucket.writeCalls, 0);
});
