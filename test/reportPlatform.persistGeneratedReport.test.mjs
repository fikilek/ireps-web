import test from "node:test";
import assert from "node:assert/strict";

import {
  createGeneratedReportPersister,
} from "../src/utils/reportPlatform/persistGeneratedReport.js";

const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const artifact = {
  format: "XLSX",
  fileName: "report.xlsx",
  bytes,
};
const metadata = {
  reportType: "USER_ACTIVITY",
  reportName: "User Activity Report",
  format: "XLSX",
  sourceType: "REPORT",
  sourceId: null,
  sourceScope: { lmPcode: "END" },
  itemCount: 5,
  fileName: "report.xlsx",
};
const descriptor = {
  reportId: "RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  storagePath:
    "generated-reports/user-1/USER_ACTIVITY/RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/report.xlsx",
  reportType: "USER_ACTIVITY",
  format: "XLSX",
  fileName: "report.xlsx",
  expectedContentType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

test("client persistence performs prepare -> exact byte upload -> finalize", async () => {
  const events = [];
  let uploadedBytes;
  let uploadedContentType;
  let uploadedPath;

  const persist = createGeneratedReportPersister({
    async prepare(payload) {
      events.push("prepare");
      assert.deepEqual(payload, { metadata });
      return descriptor;
    },
    async upload({ storagePath, bytes: actualBytes, contentType }) {
      events.push("upload");
      uploadedPath = storagePath;
      uploadedBytes = actualBytes;
      uploadedContentType = contentType;
    },
    async finalize(payload) {
      events.push("finalize");
      assert.deepEqual(payload, {
        reportId: descriptor.reportId,
        metadata,
      });
      return { success: true };
    },
  });

  const result = await persist({ artifact, metadata });

  assert.deepEqual(events, ["prepare", "upload", "finalize"]);
  assert.equal(uploadedBytes, bytes);
  assert.equal(uploadedPath, descriptor.storagePath);
  assert.equal(uploadedContentType, descriptor.expectedContentType);
  assert.deepEqual(result, { success: true });
});

test("prepare failure prevents upload and finalize", async () => {
  const events = [];
  const expected = new Error("prepare failed");

  const persist = createGeneratedReportPersister({
    async prepare() {
      events.push("prepare");
      throw expected;
    },
    async upload() {
      events.push("upload");
    },
    async finalize() {
      events.push("finalize");
    },
  });

  await assert.rejects(persist({ artifact, metadata }), expected);
  assert.deepEqual(events, ["prepare"]);
});

test("upload failure prevents finalize", async () => {
  const events = [];
  const expected = new Error("upload failed");

  const persist = createGeneratedReportPersister({
    async prepare() {
      events.push("prepare");
      return descriptor;
    },
    async upload() {
      events.push("upload");
      throw expected;
    },
    async finalize() {
      events.push("finalize");
    },
  });

  await assert.rejects(persist({ artifact, metadata }), expected);
  assert.deepEqual(events, ["prepare", "upload"]);
});

test("finalize failure surfaces after successful upload", async () => {
  const events = [];
  const expected = new Error("finalize failed");

  const persist = createGeneratedReportPersister({
    async prepare() {
      events.push("prepare");
      return descriptor;
    },
    async upload() {
      events.push("upload");
    },
    async finalize() {
      events.push("finalize");
      throw expected;
    },
  });

  await assert.rejects(persist({ artifact, metadata }), expected);
  assert.deepEqual(events, ["prepare", "upload", "finalize"]);
});

test("artifact and prepared descriptor mismatches fail before unsafe continuation", async () => {
  const persist = createGeneratedReportPersister({
    async prepare() {
      return { ...descriptor, fileName: "other.xlsx" };
    },
    async upload() {
      assert.fail("upload must not run");
    },
    async finalize() {
      assert.fail("finalize must not run");
    },
  });

  await assert.rejects(
    persist({ artifact, metadata }),
    /does not match the canonical artifact/,
  );
});
