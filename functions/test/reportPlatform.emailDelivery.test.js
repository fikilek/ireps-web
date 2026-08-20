import test from "node:test";
import assert from "node:assert/strict";

import { ReportPlatformError } from "../reportPlatform/contract.js";
import {
  REPORT_EMAIL_FROM_ADDRESS,
  REPORT_EMAIL_NO_REPLY_NOTICE,
  buildReportEmailText,
  sendGeneratedReportEmail,
} from "../reportPlatform/emailDelivery.js";

const REPORT_ID = "RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILE_NAME = "Quick-TRN-TRN_MDIS_123.pdf";
const PATH = `generated-reports/user-1/QUICK_TRN/${REPORT_ID}/${FILE_NAME}`;
const NOW = new Date("2026-08-20T00:00:00.000Z");
const PDF_BYTES = Buffer.from("%PDF-1.7\nireps-test\n");

function validationResult(overrides = {}) {
  return {
    reportId: REPORT_ID,
    ownerUid: "user-1",
    storagePath: PATH,
    actualContentType: "application/pdf",
    actualSize: PDF_BYTES.length,
    createdAt: "2026-08-19T23:00:00.000Z",
    expiresAt: "2026-08-22T23:00:00.000Z",
    environment: "DEV",
    status: "READY",
    reportType: "QUICK_TRN",
    fileName: FILE_NAME,
    format: "PDF",
    report: {
      reportType: "QUICK_TRN",
      reportName: "Quick TRN Report",
      format: "PDF",
      sourceType: "TRN",
      sourceId: "TRN_MDIS_123",
      sourceScope: { trnId: "TRN_MDIS_123" },
      itemCount: 1,
      fileName: FILE_NAME,
    },
    finalization: { isFinalized: true, schemaVersion: 1 },
    storageVersion: { generation: "123", metageneration: "4" },
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    reportId: REPORT_ID,
    reportType: "QUICK_TRN",
    fileName: FILE_NAME,
    to: "recipient@example.com",
    subject: "Quick TRN Report - TRN_MDIS_123",
    message: "Please find the attached iREPS TRN Report.",
    ...overrides,
  };
}

class FakeBucket {
  constructor({ bytes = PDF_BYTES, downloadError = null } = {}) {
    this.bytes = bytes;
    this.downloadError = downloadError;
    this.fileCalls = [];
    this.downloadCalls = [];
  }

  file(path, options) {
    this.fileCalls.push({ path, options: structuredClone(options) });
    const bucket = this;

    return {
      async download() {
        bucket.downloadCalls.push({ path, options: structuredClone(options) });
        if (bucket.downloadError) throw bucket.downloadError;
        return [bucket.bytes];
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

function storageError(code) {
  const error = new Error(`Storage ${code}`);
  error.code = code;
  return error;
}

test("email requires authentication before report validation or SMTP", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;
  let mailCalls = 0;

  await assertBusinessRejection(
    sendGeneratedReportEmail({
      bucket,
      callerUid: null,
      data: request(),
      projectId: "ireps2",
      validateReport: async () => {
        validatorCalls += 1;
        return validationResult();
      },
      sendMail: async () => {
        mailCalls += 1;
      },
    }),
    "unauthenticated",
    "REPORT_AUTH_REQUIRED",
  );

  assert.equal(validatorCalls, 0);
  assert.equal(mailCalls, 0);
});

test("email rejects invalid recipients and header injection before Storage or SMTP", async () => {
  const bucket = new FakeBucket();
  let validatorCalls = 0;
  let mailCalls = 0;

  for (const overrides of [
    { to: "not-an-email" },
    { to: "victim@example.com\r\nBcc: attacker@example.com" },
    { subject: "Report\r\nBcc: attacker@example.com" },
  ]) {
    await assert.rejects(
      sendGeneratedReportEmail({
        bucket,
        callerUid: "user-1",
        data: request(overrides),
        projectId: "ireps2",
        validateReport: async () => {
          validatorCalls += 1;
          return validationResult();
        },
        sendMail: async () => {
          mailCalls += 1;
        },
      }),
      ReportPlatformError,
    );
  }

  assert.equal(validatorCalls, 0);
  assert.equal(mailCalls, 0);
  assert.equal(bucket.fileCalls.length, 0);
});

test("email rejects caller-controlled Storage and sender fields", async () => {
  const bucket = new FakeBucket();

  for (const injected of [
    { ownerUid: "user-2" },
    { storagePath: PATH },
    { from: "attacker@example.com" },
  ]) {
    await assertBusinessRejection(
      sendGeneratedReportEmail({
        bucket,
        callerUid: "user-1",
        data: request(injected),
        projectId: "ireps2",
        validateReport: async () => validationResult(),
        sendMail: async () => {},
      }),
      "invalid-argument",
      "REPORT_EMAIL_FIELD_NOT_ALLOWED",
    );
  }
});

test("email validates canonical owner-scoped report and reads the exact validated generation", async () => {
  const bucket = new FakeBucket();
  const validatorCalls = [];
  const mailCalls = [];

  const result = await sendGeneratedReportEmail({
    bucket,
    callerUid: "user-1",
    data: request(),
    projectId: "ireps2",
    now: NOW,
    validateReport: async (args) => {
      validatorCalls.push(args);
      return validationResult();
    },
    sendMail: async (mail) => {
      mailCalls.push(mail);
      return { messageId: "mail-1" };
    },
  });

  assert.equal(validatorCalls.length, 1);
  assert.equal(validatorCalls[0].callerUid, "user-1");
  assert.equal(validatorCalls[0].storagePath, PATH);
  assert.equal(validatorCalls[0].projectId, "ireps2");
  assert.equal(validatorCalls[0].includeStorageVersion, true);
  assert.equal(validatorCalls[0].now.getTime(), NOW.getTime());

  assert.deepEqual(bucket.fileCalls, [{
    path: PATH,
    options: { generation: "123" },
  }]);
  assert.equal(mailCalls.length, 1);
  assert.deepEqual(mailCalls[0].from, {
    name: "iREPS Reports",
    address: REPORT_EMAIL_FROM_ADDRESS,
  });
  assert.equal(mailCalls[0].to, "recipient@example.com");
  assert.equal(mailCalls[0].subject, "Quick TRN Report - TRN_MDIS_123");
  assert.ok(mailCalls[0].text.includes(REPORT_EMAIL_NO_REPLY_NOTICE));
  assert.equal(mailCalls[0].attachments.length, 1);
  assert.equal(mailCalls[0].attachments[0].filename, FILE_NAME);
  assert.equal(mailCalls[0].attachments[0].contentType, "application/pdf");
  assert.deepEqual(mailCalls[0].attachments[0].content, PDF_BYTES);
  assert.equal(mailCalls[0].disableFileAccess, true);
  assert.equal(mailCalls[0].disableUrlAccess, true);
  assert.deepEqual(result, {
    sent: true,
    reportId: REPORT_ID,
    sentAt: NOW.toISOString(),
  });
});

test("email always appends the mandatory unsupervised-mailbox notice", () => {
  const text = buildReportEmailText("A custom user message.");

  assert.ok(text.startsWith("A custom user message."));
  assert.ok(text.includes("Please do not reply to this email."));
  assert.ok(text.includes(`${REPORT_EMAIL_FROM_ADDRESS} is an automated, unsupervised reporting mailbox`));
});

test("email fails closed when the validated Storage generation changed", async () => {
  const bucket = new FakeBucket({ downloadError: storageError(404) });
  let mailCalls = 0;

  await assertBusinessRejection(
    sendGeneratedReportEmail({
      bucket,
      callerUid: "user-1",
      data: request(),
      projectId: "ireps2",
      validateReport: async () => validationResult(),
      sendMail: async () => {
        mailCalls += 1;
      },
    }),
    "aborted",
    "REPORT_EMAIL_ATTACHMENT_VERSION_CHANGED",
  );

  assert.equal(mailCalls, 0);
});

test("email rejects attachment bytes that do not match validated size", async () => {
  const bucket = new FakeBucket({ bytes: Buffer.from("short") });
  let mailCalls = 0;

  await assertBusinessRejection(
    sendGeneratedReportEmail({
      bucket,
      callerUid: "user-1",
      data: request(),
      projectId: "ireps2",
      validateReport: async () => validationResult(),
      sendMail: async () => {
        mailCalls += 1;
      },
    }),
    "failed-precondition",
    "REPORT_EMAIL_ATTACHMENT_SIZE_MISMATCH",
  );

  assert.equal(mailCalls, 0);
});

test("email maps SMTP failure without claiming delivery", async () => {
  const bucket = new FakeBucket();

  await assertBusinessRejection(
    sendGeneratedReportEmail({
      bucket,
      callerUid: "user-1",
      data: request(),
      projectId: "ireps2",
      validateReport: async () => validationResult(),
      sendMail: async () => {
        throw new Error("SMTP unavailable");
      },
    }),
    "unavailable",
    "REPORT_EMAIL_SEND_FAILED",
  );
});
