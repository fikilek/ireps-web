import test from "node:test";
import assert from "node:assert/strict";

import {
  createGeneratedReportEmailClient,
} from "../src/utils/reportPlatform/generatedReportEmailClient.js";

const REPORT_ID = "RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function report() {
  return {
    report: {
      reportType: "QUICK_TRN",
      fileName: "Quick-TRN-example.pdf",
    },
    lifecycle: {
      reportId: REPORT_ID,
    },
  };
}

test("email client sends canonical report identity plus user-controlled message fields", async () => {
  const calls = [];
  const client = createGeneratedReportEmailClient({
    async send(payload) {
      calls.push(payload);
      return {
        sent: true,
        reportId: REPORT_ID,
        sentAt: "2026-08-20T00:00:00.000Z",
      };
    },
  });

  const result = await client.send({
    report: report(),
    to: "recipient@example.com",
    subject: "Quick TRN Report - example",
    message: "Please find the attached iREPS TRN Report.",
  });

  assert.deepEqual(calls, [{
    reportId: REPORT_ID,
    reportType: "QUICK_TRN",
    fileName: "Quick-TRN-example.pdf",
    to: "recipient@example.com",
    subject: "Quick TRN Report - example",
    message: "Please find the attached iREPS TRN Report.",
  }]);
  assert.equal(result.sent, true);
});

test("email client refuses incomplete generated-report identity before callable invocation", async () => {
  let calls = 0;
  const client = createGeneratedReportEmailClient({
    async send() {
      calls += 1;
      return {};
    },
  });

  await assert.rejects(
    client.send({
      report: { report: { reportType: "QUICK_TRN" }, lifecycle: {} },
      to: "recipient@example.com",
      subject: "subject",
      message: "message",
    }),
    TypeError,
  );

  assert.equal(calls, 0);
});

test("email client rejects a backend response that does not confirm the same report", async () => {
  const client = createGeneratedReportEmailClient({
    async send() {
      return {
        sent: true,
        reportId: "RPT_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        sentAt: "2026-08-20T00:00:00.000Z",
      };
    },
  });

  await assert.rejects(
    client.send({
      report: report(),
      to: "recipient@example.com",
      subject: "subject",
      message: "message",
    }),
    /invalid response/,
  );
});
