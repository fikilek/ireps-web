import test from "node:test";
import assert from "node:assert/strict";

import {
  ReportPlatformError,
  parseGeneratedReportStoragePath,
  validateReportProducerMetadata,
} from "../reportPlatform/contract.js";

function userActivity(overrides = {}) {
  return {
    reportType: "USER_ACTIVITY",
    reportName: "User Activity Report",
    format: "XLSX",
    sourceType: "FILTERED_REPORT",
    sourceId: "ZA5241",
    sourceScope: { lmPcode: "ZA5241", period: "ALL_TIME" },
    itemCount: 5,
    fileName: "user_activity_report_endumeni_all_time_202608181707.xlsx",
    ...overrides,
  };
}

function quickTrn(overrides = {}) {
  return {
    reportType: "QUICK_TRN",
    reportName: "Quick TRN Report",
    format: "PDF",
    sourceType: "TRN",
    sourceId: "TRN_001",
    sourceScope: { trnId: "TRN_001" },
    itemCount: 1,
    fileName: "quick_trn_TRN_001.pdf",
    ...overrides,
  };
}

function generalMonthlyReport(overrides = {}) {
  return {
    reportType: "GENERAL_MONTHLY_REPORT",
    reportName: "General Monthly Report",
    format: "XLSX",
    sourceType: "REPORT",
    sourceId: "ZA5241",
    sourceScope: { lmPcode: "ZA5241", generationMode: "SAMPLE", sampleSize: 200 },
    itemCount: 200,
    fileName: "general_monthly_report_endumeni_sample_200_202608250851.xlsx",
    ...overrides,
  };
}

function assertBusinessError(callback, code, businessCode) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof ReportPlatformError);
    assert.equal(error.code, code);
    assert.equal(error.details.businessCode, businessCode);
    return true;
  });
}

test("producer contract accepts known report types and locked formats", () => {
  const user = validateReportProducerMetadata(userActivity());
  const trn = validateReportProducerMetadata(quickTrn());
  const gmr = validateReportProducerMetadata(generalMonthlyReport());

  assert.equal(user.reportType, "USER_ACTIVITY");
  assert.equal(user.format, "XLSX");
  assert.equal(user.itemCount, 5);
  assert.deepEqual(user.sourceScope, {
    lmPcode: "ZA5241",
    period: "ALL_TIME",
  });

  assert.equal(trn.reportType, "QUICK_TRN");
  assert.equal(trn.format, "PDF");

  assert.equal(gmr.reportType, "GENERAL_MONTHLY_REPORT");
  assert.equal(gmr.format, "XLSX");
  assert.equal(gmr.itemCount, 200);
});

test("producer contract rejects unknown report types and locked-format mismatches", () => {
  assertBusinessError(
    () => validateReportProducerMetadata(userActivity({ reportType: "UNKNOWN" })),
    "invalid-argument",
    "REPORT_TYPE_INVALID",
  );

  assertBusinessError(
    () => validateReportProducerMetadata(userActivity({
      format: "PDF",
      fileName: "user_activity.pdf",
    })),
    "invalid-argument",
    "REPORT_FORMAT_MISMATCH",
  );

  assertBusinessError(
    () => validateReportProducerMetadata(quickTrn({
      format: "XLSX",
      fileName: "quick_trn.xlsx",
    })),
    "invalid-argument",
    "REPORT_FORMAT_MISMATCH",
  );

  assertBusinessError(
    () => validateReportProducerMetadata(generalMonthlyReport({
      format: "PDF",
      fileName: "general_monthly_report.pdf",
    })),
    "invalid-argument",
    "REPORT_FORMAT_MISMATCH",
  );
});

test("producer contract validates itemCount and file extension consistency", () => {
  for (const itemCount of [-1, 1.5, "5", null]) {
    assertBusinessError(
      () => validateReportProducerMetadata(userActivity({ itemCount })),
      "invalid-argument",
      "REPORT_ITEM_COUNT_INVALID",
    );
  }

  assertBusinessError(
    () => validateReportProducerMetadata(userActivity({ fileName: "report.pdf" })),
    "invalid-argument",
    "REPORT_FILE_FORMAT_MISMATCH",
  );
});

test("producer contract rejects every server-owned lifecycle/security field", async (t) => {
  const serverFields = [
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

  for (const field of serverFields) {
    await t.test(field, () => {
      assertBusinessError(
        () => validateReportProducerMetadata(userActivity({ [field]: "forged" })),
        "invalid-argument",
        "SERVER_OWNED_REPORT_FIELD",
      );
    });
  }
});

test("canonical generated-report path parser enforces exact structure", () => {
  const parsed = parseGeneratedReportStoragePath(
    "generated-reports/user-1/USER_ACTIVITY/RPT_1/report.xlsx",
  );

  assert.deepEqual(parsed, {
    storagePath: "generated-reports/user-1/USER_ACTIVITY/RPT_1/report.xlsx",
    ownerUid: "user-1",
    reportType: "USER_ACTIVITY",
    reportId: "RPT_1",
    fileName: "report.xlsx",
    format: "XLSX",
  });

  const malformedPaths = [
    "generated-reports/user-1/USER_ACTIVITY",
    "generated-reports/user-1/USER_ACTIVITY/RPT_1",
    "generated-reports/user-1/USER_ACTIVITY/RPT_1/sub/report.xlsx",
    "/generated-reports/user-1/USER_ACTIVITY/RPT_1/report.xlsx",
    "generated-reports/user-1/UNKNOWN/RPT_1/report.xlsx",
  ];

  for (const storagePath of malformedPaths) {
    assert.throws(
      () => parseGeneratedReportStoragePath(storagePath),
      ReportPlatformError,
    );
  }
});
