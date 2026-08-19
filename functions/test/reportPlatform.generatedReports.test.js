import test from "node:test";
import assert from "node:assert/strict";

import { ReportPlatformError } from "../reportPlatform/contract.js";
import {
  createGeneratedReportDownload,
  deleteGeneratedReport,
  listGeneratedReports,
} from "../reportPlatform/generatedReports.js";

const REPORT_ID = "RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PATH = `generated-reports/user-1/USER_ACTIVITY/${REPORT_ID}/report.xlsx`;
const NOW = new Date("2026-08-19T10:00:00.000Z");

function validationResult(overrides = {}) {
  return {
    reportId: REPORT_ID,
    ownerUid: "user-1",
    storagePath: PATH,
    actualContentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    actualSize: 4096,
    createdAt: "2026-08-19T09:00:00.000Z",
    expiresAt: "2026-08-22T09:00:00.000Z",
    environment: "DEV",
    status: "READY",
    reportType: "USER_ACTIVITY",
    fileName: "report.xlsx",
    format: "XLSX",
    report: {
      reportType: "USER_ACTIVITY",
      reportName: "User Activity Report",
      format: "XLSX",
      sourceType: "REPORT",
      sourceId: null,
      sourceScope: { lmPcode: "END" },
      itemCount: 5,
      fileName: "report.xlsx",
    },
    finalization: { isFinalized: true, schemaVersion: 1 },
    ...overrides,
  };
}

function reportError(code, businessCode) {
  return new ReportPlatformError(code, businessCode, { businessCode });
}

function storageError(code) {
  const error = new Error(`Storage ${code}`);
  error.code = code;
  return error;
}

class FakeBucket {
  constructor({
    files = [{ name: PATH }],
    nextQuery = undefined,
    apiResponse = undefined,
    getFilesError = null,
    deleteError = null,
    signedUrlError = null,
    signedUrl = "https://storage.example/signed-report",
  } = {}) {
    this.files = files;
    this.nextQuery = nextQuery;
    this.apiResponse = apiResponse;
    this.getFilesError = getFilesError;
    this.deleteError = deleteError;
    this.signedUrlError = signedUrlError;
    this.signedUrl = signedUrl;
    this.getFilesCalls = [];
    this.fileCalls = [];
    this.deleteCalls = [];
    this.signedUrlCalls = [];
  }

  async getFiles(query) {
    this.getFilesCalls.push(structuredClone(query));
    if (this.getFilesError) throw this.getFilesError;
    return [this.files, this.nextQuery, this.apiResponse];
  }

  file(path, options = undefined) {
    this.fileCalls.push({
      path,
      options: options === undefined ? undefined : structuredClone(options),
    });
    const bucket = this;
    return {
      async getSignedUrl(signedUrlOptions) {
        bucket.signedUrlCalls.push({
          path,
          fileOptions: options === undefined ? undefined : structuredClone(options),
          signedUrlOptions: structuredClone(signedUrlOptions),
        });
        if (bucket.signedUrlError) throw bucket.signedUrlError;
        return [bucket.signedUrl];
      },
      async delete(deleteOptions) {
        bucket.deleteCalls.push({
          path,
          options: structuredClone(deleteOptions),
        });
        if (bucket.deleteError) throw bucket.deleteError;
        return [{}];
      },
    };
  }
}

async function assertBusinessRejection(promise, code, businessCode) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ReportPlatformError);
    assert.equal(error.code, code);
    assert.equal(error.details.businessCode, businessCode);
    return true;
  });
}

test("list requires authentication before any Storage access", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;

  await assertBusinessRejection(
    listGeneratedReports({
      bucket,
      callerUid: null,
      data: {},
      projectId: "ireps2",
      now: NOW,
      validateReport: async () => {
        validatorCalls += 1;
        return validationResult();
      },
    }),
    "unauthenticated",
    "REPORT_AUTH_REQUIRED",
  );

  assert.equal(bucket.getFilesCalls.length, 0);
  assert.equal(validatorCalls, 0);
});

test("list uses only the authenticated owner prefix and returns validated summaries", async () => {
  const bucket = new FakeBucket({
    files: [{ name: PATH }],
    nextQuery: { pageToken: "NEXT_TOKEN" },
  });
  const calls = [];

  const result = await listGeneratedReports({
    bucket,
    callerUid: "user-1",
    data: {},
    projectId: "ireps2",
    now: NOW,
    validateReport: async (args) => {
      calls.push(args);
      return validationResult();
    },
  });

  assert.deepEqual(bucket.getFilesCalls, [{
    prefix: "generated-reports/user-1/",
    autoPaginate: false,
    maxResults: 50,
  }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].callerUid, "user-1");
  assert.equal(calls[0].storagePath, PATH);
  assert.equal(calls[0].projectId, "ireps2");
  assert.equal(calls[0].now, NOW);
  assert.equal(Object.hasOwn(calls[0], "requireFinalized"), false);
  assert.equal(result.reports.length, 1);
  assert.deepEqual(result.reports[0].report, validationResult().report);
  assert.equal(result.reports[0].lifecycle.reportId, REPORT_ID);
  assert.equal(result.nextPageToken, "NEXT_TOKEN");
});

test("list forwards bounded page size and opaque page token", async () => {
  const bucket = new FakeBucket({ files: [] });

  const result = await listGeneratedReports({
    bucket,
    callerUid: "user-1",
    data: { pageSize: 100, pageToken: "opaque-token" },
    projectId: "ireps2",
    now: NOW,
    validateReport: async () => validationResult(),
  });

  assert.deepEqual(bucket.getFilesCalls[0], {
    prefix: "generated-reports/user-1/",
    autoPaginate: false,
    maxResults: 100,
    pageToken: "opaque-token",
  });
  assert.deepEqual(result, { reports: [], nextPageToken: null });
});

test("list rejects caller-controlled owner/path fields", async () => {
  const bucket = new FakeBucket();

  await assertBusinessRejection(
    listGeneratedReports({
      bucket,
      callerUid: "user-1",
      data: { ownerUid: "user-2" },
      projectId: "ireps2",
      validateReport: async () => validationResult(),
    }),
    "invalid-argument",
    "GENERATED_REPORTS_FIELD_NOT_ALLOWED",
  );

  await assertBusinessRejection(
    listGeneratedReports({
      bucket,
      callerUid: "user-1",
      data: { storagePath: PATH },
      projectId: "ireps2",
      validateReport: async () => validationResult(),
    }),
    "invalid-argument",
    "GENERATED_REPORTS_FIELD_NOT_ALLOWED",
  );

  assert.equal(bucket.getFilesCalls.length, 0);
});

test("list validates page size and token before Storage access", async () => {
  const bucket = new FakeBucket();

  await assertBusinessRejection(
    listGeneratedReports({
      bucket,
      callerUid: "user-1",
      data: { pageSize: 101 },
      projectId: "ireps2",
    }),
    "invalid-argument",
    "REPORT_PAGE_SIZE_INVALID",
  );

  await assertBusinessRejection(
    listGeneratedReports({
      bucket,
      callerUid: "user-1",
      data: { pageToken: " bad " },
      projectId: "ireps2",
    }),
    "invalid-argument",
    "REPORT_PAGE_TOKEN_INVALID",
  );

  assert.equal(bucket.getFilesCalls.length, 0);
});

test("list skips invalid, unfinalized, expired and disappearing candidates", async () => {
  const names = ["valid", "unfinalized", "expired", "tampered", "gone"];
  const files = names.map((name) => ({
    name: `generated-reports/user-1/USER_ACTIVITY/${REPORT_ID}/${name}.xlsx`,
  }));
  const bucket = new FakeBucket({ files });

  const result = await listGeneratedReports({
    bucket,
    callerUid: "user-1",
    data: {},
    projectId: "ireps2",
    now: NOW,
    validateReport: async ({ storagePath }) => {
      if (storagePath.endsWith("unfinalized.xlsx")) {
        throw reportError("failed-precondition", "REPORT_NOT_FINALIZED");
      }
      if (storagePath.endsWith("expired.xlsx")) {
        throw reportError("failed-precondition", "GENERATED_REPORT_EXPIRED");
      }
      if (storagePath.endsWith("tampered.xlsx")) {
        throw reportError("failed-precondition", "REPORT_FINALIZATION_INVALID");
      }
      if (storagePath.endsWith("gone.xlsx")) {
        throw reportError("not-found", "GENERATED_REPORT_NOT_FOUND");
      }
      return validationResult({ storagePath });
    },
  });

  assert.equal(result.reports.length, 1);
  assert.ok(result.reports[0].lifecycle.storagePath.endsWith("valid.xlsx"));
});

test("list does not swallow infrastructure/authorization validator failures", async () => {
  const bucket = new FakeBucket();
  const failure = reportError("unavailable", "GENERATED_REPORT_METADATA_UNAVAILABLE");

  await assert.rejects(
    listGeneratedReports({
      bucket,
      callerUid: "user-1",
      data: {},
      projectId: "ireps2",
      validateReport: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
});

test("list fails closed if Storage returns a path outside the owner prefix", async () => {
  const bucket = new FakeBucket({
    files: [{ name: PATH.replace("user-1", "user-2") }],
  });

  await assertBusinessRejection(
    listGeneratedReports({
      bucket,
      callerUid: "user-1",
      data: {},
      projectId: "ireps2",
      validateReport: async () => validationResult(),
    }),
    "failed-precondition",
    "GENERATED_REPORT_LIST_SCOPE_VIOLATION",
  );
});

test("list maps a rejected supplied Storage page token to invalid-argument", async () => {
  const bucket = new FakeBucket({
    files: [],
    getFilesError: storageError(400),
  });

  await assertBusinessRejection(
    listGeneratedReports({
      bucket,
      callerUid: "user-1",
      data: { pageToken: "stale-token" },
      projectId: "ireps2",
    }),
    "invalid-argument",
    "REPORT_PAGE_TOKEN_INVALID",
  );
});

test("delete reconstructs the owner path, validates finalized object and uses version preconditions", async () => {
  const bucket = new FakeBucket();
  const validatorCalls = [];

  const result = await deleteGeneratedReport({
    bucket,
    callerUid: "user-1",
    data: {
      reportId: REPORT_ID,
      reportType: "USER_ACTIVITY",
      fileName: "report.xlsx",
    },
    projectId: "ireps2",
    now: NOW,
    validateReport: async (args) => {
      validatorCalls.push(args);
      return validationResult({
        storageVersion: { generation: "100", metageneration: "7" },
      });
    },
  });

  assert.equal(validatorCalls.length, 1);
  assert.equal(validatorCalls[0].callerUid, "user-1");
  assert.equal(validatorCalls[0].storagePath, PATH);
  assert.equal(validatorCalls[0].includeStorageVersion, true);
  assert.equal(Object.hasOwn(validatorCalls[0], "requireFinalized"), false);
  assert.deepEqual(bucket.fileCalls, [{ path: PATH, options: undefined }]);
  assert.deepEqual(bucket.deleteCalls, [{
    path: PATH,
    options: {
      ifGenerationMatch: "100",
      ifMetagenerationMatch: "7",
    },
  }]);
  assert.deepEqual(result, { reportId: REPORT_ID, deleted: true });
});

test("delete rejects caller-supplied ownerUid/storagePath before validation or Storage", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;

  for (const injected of [
    { ownerUid: "user-2" },
    { storagePath: PATH },
  ]) {
    await assertBusinessRejection(
      deleteGeneratedReport({
        bucket,
        callerUid: "user-1",
        data: {
          reportId: REPORT_ID,
          reportType: "USER_ACTIVITY",
          fileName: "report.xlsx",
          ...injected,
        },
        projectId: "ireps2",
        validateReport: async () => {
          validatorCalls += 1;
          return validationResult();
        },
      }),
      "invalid-argument",
      "GENERATED_REPORTS_FIELD_NOT_ALLOWED",
    );
  }

  assert.equal(validatorCalls, 0);
  assert.equal(bucket.fileCalls.length, 0);
});

test("delete requires authentication before validation or Storage", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;

  await assertBusinessRejection(
    deleteGeneratedReport({
      bucket,
      callerUid: null,
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "report.xlsx",
      },
      projectId: "ireps2",
      validateReport: async () => {
        validatorCalls += 1;
        return validationResult();
      },
    }),
    "unauthenticated",
    "REPORT_AUTH_REQUIRED",
  );

  assert.equal(validatorCalls, 0);
  assert.equal(bucket.fileCalls.length, 0);
});

test("delete rejects malformed canonical identity before validation or Storage", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;

  await assert.rejects(
    deleteGeneratedReport({
      bucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "nested/report.xlsx",
      },
      projectId: "ireps2",
      validateReport: async () => {
        validatorCalls += 1;
        return validationResult();
      },
    }),
    ReportPlatformError,
  );

  assert.equal(validatorCalls, 0);
  assert.equal(bucket.fileCalls.length, 0);
});

test("delete converts a version precondition failure into a concurrent-change rejection", async () => {
  const bucket = new FakeBucket({ deleteError: storageError(412) });

  await assertBusinessRejection(
    deleteGeneratedReport({
      bucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "report.xlsx",
      },
      projectId: "ireps2",
      validateReport: async () => validationResult({
        storageVersion: { generation: "100", metageneration: "7" },
      }),
    }),
    "aborted",
    "REPORT_DELETE_CONCURRENT_CHANGE",
  );
});

test("delete converts a post-validation disappearance into not-found", async () => {
  const bucket = new FakeBucket({ deleteError: storageError(404) });

  await assertBusinessRejection(
    deleteGeneratedReport({
      bucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "report.xlsx",
      },
      projectId: "ireps2",
      validateReport: async () => validationResult({
        storageVersion: { generation: "100", metageneration: "7" },
      }),
    }),
    "not-found",
    "GENERATED_REPORT_NOT_FOUND",
  );
});



test("download requires authentication before validation or Storage access", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;

  await assertBusinessRejection(
    createGeneratedReportDownload({
      bucket,
      callerUid: null,
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "report.xlsx",
      },
      projectId: "ireps2",
      now: NOW,
      validateReport: async () => {
        validatorCalls += 1;
        return validationResult();
      },
    }),
    "unauthenticated",
    "REPORT_AUTH_REQUIRED",
  );

  assert.equal(validatorCalls, 0);
  assert.equal(bucket.fileCalls.length, 0);
});

test("download rejects caller-controlled ownerUid/storagePath before validation or Storage", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;

  for (const injected of [
    { ownerUid: "user-2" },
    { storagePath: PATH },
  ]) {
    await assertBusinessRejection(
      createGeneratedReportDownload({
        bucket,
        callerUid: "user-1",
        data: {
          reportId: REPORT_ID,
          reportType: "USER_ACTIVITY",
          fileName: "report.xlsx",
          ...injected,
        },
        projectId: "ireps2",
        now: NOW,
        validateReport: async () => {
          validatorCalls += 1;
          return validationResult();
        },
      }),
      "invalid-argument",
      "GENERATED_REPORTS_FIELD_NOT_ALLOWED",
    );
  }

  assert.equal(validatorCalls, 0);
  assert.equal(bucket.fileCalls.length, 0);
});

test("download validates exact owner report and signs the validated generation for five minutes", async () => {
  const bucket = new FakeBucket();
  const validatorCalls = [];

  const result = await createGeneratedReportDownload({
    bucket,
    callerUid: "user-1",
    data: {
      reportId: REPORT_ID,
      reportType: "user_activity",
      fileName: "report.xlsx",
    },
    projectId: "ireps2",
    now: NOW,
    validateReport: async (args) => {
      validatorCalls.push(args);
      return validationResult({
        storageVersion: { generation: "100", metageneration: "7" },
      });
    },
  });

  assert.equal(validatorCalls.length, 1);
  assert.equal(validatorCalls[0].callerUid, "user-1");
  assert.equal(validatorCalls[0].storagePath, PATH);
  assert.equal(validatorCalls[0].includeStorageVersion, true);
  assert.deepEqual(bucket.fileCalls, [{
    path: PATH,
    options: { generation: "100" },
  }]);
  assert.equal(bucket.signedUrlCalls.length, 1);
  assert.equal(bucket.signedUrlCalls[0].path, PATH);
  assert.deepEqual(bucket.signedUrlCalls[0].fileOptions, {
    generation: "100",
  });
  assert.equal(bucket.signedUrlCalls[0].signedUrlOptions.version, "v4");
  assert.equal(bucket.signedUrlCalls[0].signedUrlOptions.action, "read");
  assert.equal(bucket.signedUrlCalls[0].signedUrlOptions.promptSaveAs, "report.xlsx");
  assert.equal(
    bucket.signedUrlCalls[0].signedUrlOptions.expires.toISOString(),
    "2026-08-19T10:05:00.000Z",
  );
  assert.deepEqual(result, {
    reportId: REPORT_ID,
    fileName: "report.xlsx",
    format: "XLSX",
    downloadUrl: "https://storage.example/signed-report",
    expiresAt: "2026-08-19T10:05:00.000Z",
  });
});

test("download fails closed if validated Storage generation is unavailable", async () => {
  const bucket = new FakeBucket();

  await assertBusinessRejection(
    createGeneratedReportDownload({
      bucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "report.xlsx",
      },
      projectId: "ireps2",
      now: NOW,
      validateReport: async () => validationResult(),
    }),
    "failed-precondition",
    "REPORT_STORAGE_VERSION_INVALID",
  );

  assert.equal(bucket.fileCalls.length, 0);
});

test("download converts signed URL failures into a safe unavailable error", async () => {
  const bucket = new FakeBucket({
    signedUrlError: new Error("signBlob unavailable"),
  });

  await assertBusinessRejection(
    createGeneratedReportDownload({
      bucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "report.xlsx",
      },
      projectId: "ireps2",
      now: NOW,
      validateReport: async () => validationResult({
        storageVersion: { generation: "100", metageneration: "7" },
      }),
    }),
    "unavailable",
    "GENERATED_REPORT_DOWNLOAD_URL_FAILED",
  );

  assert.equal(bucket.signedUrlCalls.length, 1);
});

test("download rejects malformed canonical identity before validation or Storage", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;

  await assert.rejects(
    createGeneratedReportDownload({
      bucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "nested/report.xlsx",
      },
      projectId: "ireps2",
      now: NOW,
      validateReport: async () => {
        validatorCalls += 1;
        return validationResult();
      },
    }),
    ReportPlatformError,
  );

  assert.equal(validatorCalls, 0);
  assert.equal(bucket.fileCalls.length, 0);
});

test("unknown environment fails closed before list/download/delete Storage access", async () => {
  const listBucket = new FakeBucket();
  const downloadBucket = new FakeBucket();
  const deleteBucket = new FakeBucket();

  await assertBusinessRejection(
    listGeneratedReports({
      bucket: listBucket,
      callerUid: "user-1",
      data: {},
      projectId: "unknown-project",
    }),
    "failed-precondition",
    "REPORT_ENVIRONMENT_UNKNOWN",
  );

  await assertBusinessRejection(
    createGeneratedReportDownload({
      bucket: downloadBucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "report.xlsx",
      },
      projectId: "unknown-project",
      now: NOW,
    }),
    "failed-precondition",
    "REPORT_ENVIRONMENT_UNKNOWN",
  );

  await assertBusinessRejection(
    deleteGeneratedReport({
      bucket: deleteBucket,
      callerUid: "user-1",
      data: {
        reportId: REPORT_ID,
        reportType: "USER_ACTIVITY",
        fileName: "report.xlsx",
      },
      projectId: "unknown-project",
    }),
    "failed-precondition",
    "REPORT_ENVIRONMENT_UNKNOWN",
  );

  assert.equal(listBucket.getFilesCalls.length, 0);
  assert.equal(downloadBucket.fileCalls.length, 0);
  assert.equal(deleteBucket.fileCalls.length, 0);
});
