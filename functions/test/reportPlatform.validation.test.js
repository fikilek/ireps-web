import test from "node:test";
import assert from "node:assert/strict";

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
  return `generated-reports/${ownerUid}/USER_ACTIVITY/RPT_1/report.xlsx`;
}

function pdfPath(ownerUid = "user-1") {
  return `generated-reports/${ownerUid}/QUICK_TRN/RPT_2/report.pdf`;
}

function validXlsxMetadata(overrides = {}) {
  return {
    contentType: XLSX_CONTENT_TYPE,
    size: "9842",
    timeCreated: CREATED_AT,
    ...overrides,
  };
}

function validPdfMetadata(overrides = {}) {
  return {
    contentType: PDF_CONTENT_TYPE,
    size: "2048",
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

test("validator returns trusted metadata from the exact XLSX Storage object", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket({ [path]: validXlsxMetadata() });

  const result = await validateGeneratedReport({
    bucket,
    callerUid: "user-1",
    storagePath: path,
    projectId: "ireps2",
    now: VALID_NOW,
  });

  assert.deepEqual(result, {
    reportId: "RPT_1",
    ownerUid: "user-1",
    reportType: "USER_ACTIVITY",
    storagePath: path,
    fileName: "report.xlsx",
    format: "XLSX",
    actualContentType: XLSX_CONTENT_TYPE,
    actualSize: 9842,
    createdAt: CREATED_AT,
    expiresAt: "2026-08-21T10:00:00.000Z",
    environment: "DEV",
    status: "READY",
  });

  assert.deepEqual(bucket.fileCalls, [path]);
  assert.equal(bucket.metadataReads, 1);
  assert.equal(bucket.listCalls, 0);
  assert.equal(bucket.writeCalls, 0);
});

test("validator accepts a valid PDF object and enforces its actual MIME type", async () => {
  const path = pdfPath();
  const bucket = new FakeBucket({ [path]: validPdfMetadata() });

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
  const bucket = new FakeBucket({ [path]: validXlsxMetadata() });

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
    [path]: validXlsxMetadata({ contentType: "image/jpeg" }),
  });
  await assertBusinessRejection(
    validateGeneratedReport({
      bucket: wrongMimeBucket,
      callerUid: "user-1",
      storagePath: path,
      projectId: "ireps2",
      now: VALID_NOW,
    }),
    "failed-precondition",
    "REPORT_CONTENT_TYPE_MISMATCH",
  );

  for (const size of ["0", "-1", "not-a-number"]) {
    const invalidSizeBucket = new FakeBucket({
      [path]: validXlsxMetadata({ size }),
    });
    await assertBusinessRejection(
      validateGeneratedReport({
        bucket: invalidSizeBucket,
        callerUid: "user-1",
        storagePath: path,
        projectId: "ireps2",
        now: VALID_NOW,
      }),
      "failed-precondition",
      "REPORT_SIZE_INVALID",
    );
  }
});

test("createdAt and 3-day expiry are derived from Storage metadata", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket({
    [path]: validXlsxMetadata({
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
  });

  assert.equal(result.actualSize, 12345);
  assert.equal(result.createdAt, "2026-08-10T12:30:00.000Z");
  assert.equal(result.expiresAt, "2026-08-13T12:30:00.000Z");
  assert.equal(result.environment, "LIVE");
});

test("expired reports are rejected at the exact expiry boundary", async () => {
  const path = xlsxPath();
  const bucket = new FakeBucket({ [path]: validXlsxMetadata() });

  await assertBusinessRejection(
    validateGeneratedReport({
      bucket,
      callerUid: "user-1",
      storagePath: path,
      projectId: "ireps2",
      now: new Date("2026-08-21T10:00:00.000Z"),
    }),
    "failed-precondition",
    "GENERATED_REPORT_EXPIRED",
  );
});

test("environment derives only from approved server project IDs", async () => {
  const environments = [
    ["ireps2", "DEV"],
    ["ireps-test", "TEST"],
    ["ireps-5c3e9", "LIVE"],
    ["demo-ireps-report-platform", "DEMO"],
  ];

  for (const [projectId, expectedEnvironment] of environments) {
    const path = xlsxPath();
    const bucket = new FakeBucket({ [path]: validXlsxMetadata() });
    const result = await validateGeneratedReport({
      bucket,
      callerUid: "user-1",
      storagePath: path,
      projectId,
      now: VALID_NOW,
    });
    assert.equal(result.environment, expectedEnvironment);
  }

  const unknownBucket = new FakeBucket({
    [xlsxPath()]: validXlsxMetadata(),
  });
  await assertBusinessRejection(
    validateGeneratedReport({
      bucket: unknownBucket,
      callerUid: "user-1",
      storagePath: xlsxPath(),
      projectId: "unknown-project",
      now: VALID_NOW,
    }),
    "failed-precondition",
    "REPORT_ENVIRONMENT_UNKNOWN",
  );
  assert.equal(unknownBucket.metadataReads, 0);
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
