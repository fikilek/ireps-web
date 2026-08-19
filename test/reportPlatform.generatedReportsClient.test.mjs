import test from "node:test";
import assert from "node:assert/strict";

import {
  createGeneratedReportsClient,
} from "../src/utils/reportPlatform/generatedReportsClient.js";

const REPORT_ID = "RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function reportSummary() {
  return {
    report: {
      reportType: "USER_ACTIVITY",
      reportName: "User Activity Report",
      format: "XLSX",
      fileName: "report.xlsx",
      itemCount: 5,
    },
    lifecycle: {
      reportId: REPORT_ID,
      createdAt: "2026-08-19T09:00:00.000Z",
      expiresAt: "2026-08-22T09:00:00.000Z",
      status: "READY",
    },
  };
}

test("client listing sends bounded pagination payload and normalizes next token", async () => {
  const calls = [];
  const client = createGeneratedReportsClient({
    list: async (payload) => {
      calls.push(payload);
      return {
        reports: [reportSummary()],
        nextPageToken: "NEXT_TOKEN",
      };
    },
    authorizeDownload: async () => ({}),
    deleteReport: async () => ({}),
  });

  const result = await client.listPage({
    pageSize: 25,
    pageToken: "CURRENT_TOKEN",
  });

  assert.deepEqual(calls, [{
    pageSize: 25,
    pageToken: "CURRENT_TOKEN",
  }]);
  assert.equal(result.reports.length, 1);
  assert.equal(result.nextPageToken, "NEXT_TOKEN");
});

test("client listing omits an empty page token and rejects malformed responses", async () => {
  const calls = [];
  const client = createGeneratedReportsClient({
    list: async (payload) => {
      calls.push(payload);
      return { reports: [], nextPageToken: null };
    },
    authorizeDownload: async () => ({}),
    deleteReport: async () => ({}),
  });

  await client.listPage({ pageSize: 50, pageToken: null });
  assert.deepEqual(calls, [{ pageSize: 50 }]);

  const invalidClient = createGeneratedReportsClient({
    list: async () => ({ reports: "not-an-array" }),
    authorizeDownload: async () => ({}),
    deleteReport: async () => ({}),
  });

  await assert.rejects(
    invalidClient.listPage(),
    /invalid response/i,
  );
});

test("client download sends only canonical report identity", async () => {
  const calls = [];
  const report = reportSummary();
  report.lifecycle.storagePath =
    `generated-reports/user-1/USER_ACTIVITY/${REPORT_ID}/report.xlsx`;
  report.lifecycle.ownerUid = "user-1";

  const client = createGeneratedReportsClient({
    list: async () => ({ reports: [] }),
    authorizeDownload: async (payload) => {
      calls.push(payload);
      return {
        reportId: REPORT_ID,
        fileName: "report.xlsx",
        format: "XLSX",
        downloadUrl: "https://storage.example/signed",
        expiresAt: "2026-08-19T10:05:00.000Z",
      };
    },
    deleteReport: async () => ({}),
  });

  const result = await client.getDownload(report);

  assert.deepEqual(calls, [{
    reportId: REPORT_ID,
    reportType: "USER_ACTIVITY",
    fileName: "report.xlsx",
  }]);
  assert.equal(result.downloadUrl, "https://storage.example/signed");
});

test("client delete sends only canonical report identity and validates acknowledgement", async () => {
  const calls = [];
  const client = createGeneratedReportsClient({
    list: async () => ({ reports: [] }),
    authorizeDownload: async () => ({}),
    deleteReport: async (payload) => {
      calls.push(payload);
      return { reportId: REPORT_ID, deleted: true };
    },
  });

  const result = await client.delete(reportSummary());

  assert.deepEqual(calls, [{
    reportId: REPORT_ID,
    reportType: "USER_ACTIVITY",
    fileName: "report.xlsx",
  }]);
  assert.deepEqual(result, {
    reportId: REPORT_ID,
    deleted: true,
  });

  const badClient = createGeneratedReportsClient({
    list: async () => ({ reports: [] }),
    authorizeDownload: async () => ({}),
    deleteReport: async () => ({ reportId: REPORT_ID, deleted: false }),
  });

  await assert.rejects(
    badClient.delete(reportSummary()),
    /invalid response/i,
  );
});

test("client rejects incomplete report identity before calling download or delete", async () => {
  let downloadCalls = 0;
  let deleteCalls = 0;

  const client = createGeneratedReportsClient({
    list: async () => ({ reports: [] }),
    authorizeDownload: async () => {
      downloadCalls += 1;
      return {};
    },
    deleteReport: async () => {
      deleteCalls += 1;
      return {};
    },
  });

  const invalid = {
    report: { reportType: "USER_ACTIVITY", fileName: "" },
    lifecycle: { reportId: REPORT_ID },
  };

  await assert.rejects(client.getDownload(invalid), TypeError);
  await assert.rejects(client.delete(invalid), TypeError);

  assert.equal(downloadCalls, 0);
  assert.equal(deleteCalls, 0);
});
