import test from "node:test";
import assert from "node:assert/strict";

import { ReportPlatformError } from "../reportPlatform/contract.js";
import { cleanupGeneratedReports } from "../reportPlatform/retentionCleanup.js";

const REPORT_ID = "RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VALID_PATH =
  `generated-reports/user-1/USER_ACTIVITY/${REPORT_ID}/report.xlsx`;
const NOW = new Date("2026-08-19T10:00:00.000Z");

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

function objectMetadata(overrides = {}) {
  return {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: "4096",
    timeCreated: "2026-08-16T09:59:59.000Z",
    generation: "100",
    metageneration: "1",
    metadata: {},
    ...overrides,
  };
}

class FakeBucket {
  constructor({ objects = {}, pages = null } = {}) {
    this.objects = structuredClone(objects);
    this.pages = pages || [
      {
        token: null,
        files: Object.keys(objects),
        nextPageToken: null,
      },
    ];
    this.listCalls = [];
    this.metadataReads = [];
    this.deleteAttempts = [];
    this.deleted = [];
    this.failList = null;
    this.forceDeleteFailure = new Map();
    this.forceMetadataFailure = new Map();
  }

  async getFiles(query) {
    this.listCalls.push(structuredClone(query));
    if (this.failList) throw this.failList;

    const token = query.pageToken || null;
    const page = this.pages.find((item) => item.token === token);

    if (!page) throw new Error(`Unexpected page token: ${token}`);

    const files = page.files.map((name) => ({ name }));
    const nextQuery = page.nextPageToken
      ? { pageToken: page.nextPageToken }
      : null;

    return [files, nextQuery, {}];
  }

  file(path) {
    const bucket = this;

    return {
      async getMetadata() {
        bucket.metadataReads.push(path);

        const forced = bucket.forceMetadataFailure.get(path);
        if (forced) throw forced;

        const metadata = bucket.objects[path];
        if (!metadata) throw storageNotFound();

        return [structuredClone(metadata)];
      },

      async delete(options = {}) {
        bucket.deleteAttempts.push({
          path,
          options: structuredClone(options),
        });

        const forced = bucket.forceDeleteFailure.get(path);
        if (forced) throw forced;

        const metadata = bucket.objects[path];
        if (!metadata) throw storageNotFound();

        if (
          String(options.ifGenerationMatch) !== String(metadata.generation) ||
          String(options.ifMetagenerationMatch) !==
            String(metadata.metageneration)
        ) {
          throw storagePreconditionFailed();
        }

        delete bucket.objects[path];
        bucket.deleted.push(path);
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

test("cleanup fails closed for unknown environment before Storage access", async () => {
  const bucket = new FakeBucket({
    objects: { [VALID_PATH]: objectMetadata() },
  });

  await assertBusinessRejection(
    cleanupGeneratedReports({
      bucket,
      projectId: "unknown-project",
      now: NOW,
    }),
    "failed-precondition",
    "REPORT_ENVIRONMENT_UNKNOWN",
  );

  assert.equal(bucket.listCalls.length, 0);
  assert.equal(bucket.metadataReads.length, 0);
  assert.equal(bucket.deleteAttempts.length, 0);
});

test("cleanup lists only generated-reports with server-side pagination", async () => {
  const secondPath =
    `generated-reports/user-2/QUICK_TRN/${REPORT_ID}/report.pdf`;

  const bucket = new FakeBucket({
    objects: {
      [VALID_PATH]: objectMetadata({
        timeCreated: "2026-08-19T09:00:00.000Z",
      }),
      [secondPath]: objectMetadata({
        contentType: "application/pdf",
        timeCreated: "2026-08-19T09:00:00.000Z",
      }),
    },
    pages: [
      {
        token: null,
        files: [VALID_PATH],
        nextPageToken: "next-1",
      },
      {
        token: "next-1",
        files: [secondPath],
        nextPageToken: null,
      },
    ],
  });

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.pages, 2);
  assert.equal(result.scanned, 2);
  assert.equal(result.retained, 2);
  assert.equal(result.deleted, 0);
  assert.deepEqual(bucket.listCalls, [
    {
      prefix: "generated-reports/",
      autoPaginate: false,
      maxResults: 1000,
    },
    {
      prefix: "generated-reports/",
      autoPaginate: false,
      maxResults: 1000,
      pageToken: "next-1",
    },
  ]);
});

test("cleanup deletes an expired canonical object with version preconditions", async () => {
  const bucket = new FakeBucket({
    objects: { [VALID_PATH]: objectMetadata() },
  });

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.deleted, 1);
  assert.equal(result.retained, 0);
  assert.deepEqual(bucket.deleteAttempts, [
    {
      path: VALID_PATH,
      options: {
        ifGenerationMatch: "100",
        ifMetagenerationMatch: "1",
      },
    },
  ]);
  assert.equal(bucket.objects[VALID_PATH], undefined);
});

test("cleanup deletes abandoned unfinalized uploads after retention", async () => {
  const bucket = new FakeBucket({
    objects: {
      [VALID_PATH]: objectMetadata({
        metadata: {},
      }),
    },
  });

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.deleted, 1);
  assert.equal(bucket.deleted[0], VALID_PATH);
});

test("cleanup retains an object before the exact expiry boundary", async () => {
  const bucket = new FakeBucket({
    objects: {
      [VALID_PATH]: objectMetadata({
        timeCreated: "2026-08-16T10:00:01.000Z",
      }),
    },
  });

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.retained, 1);
  assert.equal(result.deleted, 0);
  assert.equal(bucket.deleteAttempts.length, 0);
});

test("cleanup deletes at the exact three-day expiry boundary", async () => {
  const bucket = new FakeBucket({
    objects: {
      [VALID_PATH]: objectMetadata({
        timeCreated: "2026-08-16T10:00:00.000Z",
      }),
    },
  });

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.deleted, 1);
});

test("cleanup never deletes malformed generated-report paths", async () => {
  const malformed = [
    "generated-reports/user-1/USER_ACTIVITY/not-rpt/report.xlsx",
    "generated-reports/user-1/UNKNOWN/RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/report.xlsx",
    "generated-reports/user-1/USER_ACTIVITY/RPT_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/nested/report.xlsx",
  ];

  const bucket = new FakeBucket({
    objects: Object.fromEntries(
      malformed.map((path) => [path, objectMetadata()]),
    ),
  });

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.malformed, 3);
  assert.equal(result.deleted, 0);
  assert.equal(bucket.metadataReads.length, 0);
  assert.equal(bucket.deleteAttempts.length, 0);
});

test("cleanup never deletes when Storage creation time or version is invalid", async () => {
  const invalidTimePath =
    `generated-reports/user-1/USER_ACTIVITY/${REPORT_ID}/invalid-time.xlsx`;
  const invalidVersionPath =
    `generated-reports/user-1/USER_ACTIVITY/${REPORT_ID}/invalid-version.xlsx`;

  const bucket = new FakeBucket({
    objects: {
      [invalidTimePath]: objectMetadata({
        timeCreated: "not-a-date",
      }),
      [invalidVersionPath]: objectMetadata({
        generation: "0",
      }),
    },
  });

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.metadataInvalid, 2);
  assert.equal(result.deleted, 0);
  assert.equal(bucket.deleteAttempts.length, 0);
});

test("cleanup treats a disappearing object as harmless and continues", async () => {
  const bucket = new FakeBucket({
    objects: { [VALID_PATH]: objectMetadata() },
  });

  bucket.forceMetadataFailure.set(VALID_PATH, storageNotFound());

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.disappeared, 1);
  assert.equal(result.deleted, 0);
});

test("cleanup does not delete a concurrently changed expired object", async () => {
  const bucket = new FakeBucket({
    objects: { [VALID_PATH]: objectMetadata() },
  });

  bucket.forceDeleteFailure.set(VALID_PATH, storagePreconditionFailed());

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.concurrentChanged, 1);
  assert.equal(result.deleted, 0);
  assert.ok(bucket.objects[VALID_PATH]);
});

test("cleanup treats post-read disappearance during delete as harmless", async () => {
  const bucket = new FakeBucket({
    objects: { [VALID_PATH]: objectMetadata() },
  });

  bucket.forceDeleteFailure.set(VALID_PATH, storageNotFound());

  const result = await cleanupGeneratedReports({
    bucket,
    projectId: "ireps2",
    now: NOW,
  });

  assert.equal(result.disappeared, 1);
  assert.equal(result.deleted, 0);
});

test("cleanup fails closed if listing escapes generated-reports prefix", async () => {
  const bucket = new FakeBucket({
    pages: [
      {
        token: null,
        files: ["meters/not-a-report"],
        nextPageToken: null,
      },
    ],
  });

  await assertBusinessRejection(
    cleanupGeneratedReports({
      bucket,
      projectId: "ireps2",
      now: NOW,
    }),
    "failed-precondition",
    "REPORT_RETENTION_LIST_SCOPE_VIOLATION",
  );

  assert.equal(bucket.deleteAttempts.length, 0);
});

test("cleanup fails visibly on Storage infrastructure errors", async () => {
  const bucket = new FakeBucket();
  bucket.failList = new Error("storage unavailable");

  await assertBusinessRejection(
    cleanupGeneratedReports({
      bucket,
      projectId: "ireps2",
      now: NOW,
    }),
    "unavailable",
    "REPORT_RETENTION_LIST_UNAVAILABLE",
  );
});

test("cleanup fails closed on repeated pagination tokens", async () => {
  const bucket = new FakeBucket({
    pages: [
      {
        token: null,
        files: [],
        nextPageToken: "loop",
      },
      {
        token: "loop",
        files: [],
        nextPageToken: "loop",
      },
    ],
  });

  await assertBusinessRejection(
    cleanupGeneratedReports({
      bucket,
      projectId: "ireps2",
      now: NOW,
    }),
    "failed-precondition",
    "REPORT_RETENTION_PAGE_TOKEN_LOOP",
  );
});
