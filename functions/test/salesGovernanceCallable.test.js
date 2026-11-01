// Callable-level coverage for getSalesGovernedMonths. Exercises the
// dependency-injected core (readSalesGovernedMonths) so authentication,
// authorization, provider scope, error classification, verified-prefix
// behaviour and month diagnostics are proven without an initialised Admin app
// or a live bucket.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readSalesGovernedMonths } from "../salesGovernance/callable.js";
import { MONTH_STATE } from "../salesGovernance/artifacts.js";

const sha = value => createHash("sha256").update(value).digest("hex");
const FILLER = "a".repeat(64);
const LM = "ZA5241";
const PROVIDER = "contour";
const PROJECT = "ireps2";
const AUTHORIZED = { access: { workbases: [{ id: LM }] } };
// Fixed clock: 2026-09-15 in Africa/Johannesburg (UTC+2).
const NOW = new Date("2026-09-15T10:00:00.000Z");

// ---------------------------------------------------------------- evidence --

function buildMonth({ month, members, replacements = [], previousSnapshotSha256 = null, lmPcode = LM, provider = PROVIDER, projectId = PROJECT }) {
  const snapshot = {
    schemaVersion: 1, lmPcode, provider, month,
    sourceSha256: FILLER, previousSnapshotSha256, members, replacements, exceptions: [],
    completeness: { complete: true, evidenceSha256: FILLER },
  };
  const snapshotBytes = Buffer.from(JSON.stringify(snapshot));
  const snapshotSha256 = sha(snapshotBytes);
  const scope = [...members].sort();
  const scopeSha = sha(JSON.stringify(scope));
  const rowsRead = scope.length;
  const report = {
    projectId, collection: "sales-all-meters", preflightOnly: false, status: "PASS", result: "REFRESH_VERIFIED",
    rowsRead, recordsInspected: rowsRead, createdCount: 0, updatedCount: 1, unchangedCount: rowsRead - 1,
    conflictCount: 0, failedCount: 0, writeAttemptCount: 1, writeSuccessCount: 1, firestoreWrites: 1,
    globalPreflight: { complete: true, gatePassed: true },
    sourceEvidence: {
      lmPcode, provider, governedMonth: month, populationSnapshotSha256: snapshotSha256,
      categoryPackageSha256: FILLER, scopeDocumentIds: scope, scopeDocumentIdsSha256: scopeSha,
      scopeRecordCount: rowsRead, categoryExceptionDocumentIds: [],
    },
    batchEvidence: { failedWriteWave: null, writeWavesAttempted: 1, writeWavesCommitted: 1 },
    verification: {
      status: "PASS", documentsVerified: rowsRead,
      preservedProjectionBeforeSha256: FILLER, preservedProjectionAfterSha256: FILLER,
      preservationVerifiedExistingDocuments: rowsRead,
    },
    recoveryEvidence: { complete: true, records: rowsRead, sha256: FILLER },
    planEvidence: { complete: true, records: rowsRead, sha256: FILLER, scopeDocumentIdsSha256: scopeSha, categoryPackageSha256: FILLER },
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  return { month, snapshotBytes, snapshotSha256, reportBytes, reportSha256: sha(reportBytes) };
}

function buildEvidence(specs, { lmPcode = LM, provider = PROVIDER, projectId = PROJECT } = {}) {
  const built = [];
  let previous = null;
  for (const spec of specs) {
    const month = buildMonth({ ...spec, previousSnapshotSha256: previous, lmPcode, provider, projectId });
    built.push(month);
    previous = month.snapshotSha256;
  }
  const months = {};
  for (const month of built) {
    months[month.month] = { snapshotSha256: month.snapshotSha256, verification: { status: "PASS", complete: true, reportSha256: month.reportSha256 } };
  }
  const publication = { schemaVersion: 1, lmPcode, provider, projectId, latestMonth: built.at(-1).month, months };
  const prefix = `governed-sales/${lmPcode}/${provider}`;
  const files = { [`${prefix}/publication.json`]: Buffer.from(JSON.stringify(publication)) };
  for (const month of built) {
    files[`${prefix}/snapshots/${month.snapshotSha256}.json`] = month.snapshotBytes;
    files[`${prefix}/reports/${month.reportSha256}.json`] = month.reportBytes;
  }
  return { publication, files, built, prefix };
}

const BASELINE = () => buildEvidence([{ month: "2026-06", members: ["M1", "M2"] }]);

// June baseline, then July retires M2 and installs M3 under verified replacement evidence.
const TWO_MONTHS = () => buildEvidence([
  { month: "2026-06", members: ["M1", "M2"] },
  { month: "2026-07", members: ["M1", "M3"], replacements: [{ predecessor: "M2", successor: "M3" }] },
]);

const THREE_MONTHS = () => buildEvidence([
  { month: "2026-06", members: ["M1", "M2"] },
  { month: "2026-07", members: ["M1", "M3"], replacements: [{ predecessor: "M2", successor: "M3" }] },
  { month: "2026-08", members: ["M1", "M3", "M4"] },
]);

// ------------------------------------------------------------------- fakes --

function fakeDb(users = {}, { fail = false } = {}) {
  return {
    collection(name) {
      assert.equal(name, "users", "scope authorization must read the server-side users collection");
      return { doc: uid => ({ async get() { if (fail) throw Object.assign(new Error("Firestore unavailable"), { code: 503 }); return { data: () => users[uid] }; } }) };
    },
  };
}

function fakeBucket(files = {}, { failPaths = {} } = {}) {
  return {
    file(path) {
      return {
        async download() {
          if (failPaths[path]) throw failPaths[path];
          if (!(path in files)) throw Object.assign(new Error(`No such object: ${path}`), { code: 404 });
          return [files[path]];
        },
      };
    },
  };
}

function invoke({ request, files = {}, users = {}, projectId = PROJECT, bucket, db, now = NOW } = {}) {
  return readSalesGovernedMonths({
    getDb: () => db || fakeDb(users),
    getBucket: () => bucket || fakeBucket(files),
    getProjectId: () => projectId,
    getNow: () => now,
    request,
  });
}

const authed = (data, uid = "UID_A") => ({ auth: { uid }, data });
const ok = (files, extra = {}) => invoke({ request: authed({ lmPcode: LM }), files, users: { UID_A: AUTHORIZED }, ...extra });

async function rejectsWithCode(promiseFactory, code) {
  await assert.rejects(promiseFactory, error => {
    assert.equal(error.code, code, `expected HttpsError code "${code}" but received "${error.code}" (${error.message})`);
    return true;
  });
}

const stateOf = (result, month) => result.timeline.find(entry => entry.month === month)?.state;

// --------------------------------------------------------- 1. unauthenticated

test("unauthenticated requests are rejected before any read", async () => {
  for (const request of [{}, { data: { lmPcode: LM } }, { auth: null, data: {} }, { auth: {}, data: {} }, { auth: { uid: "" }, data: {} }]) {
    await rejectsWithCode(() => invoke({ request }), "unauthenticated");
  }
});

// ------------------------------------------------------------ 2. malformed input

test("malformed scope arguments are rejected as invalid-argument", async () => {
  const bad = [
    undefined, {}, { lmPcode: "" }, { lmPcode: null }, { lmPcode: "ZA524" }, { lmPcode: "ZA52411" },
    { lmPcode: "za5241" }, { lmPcode: "XX5241" }, { lmPcode: " ZA5241" }, { lmPcode: 5241 },
    { lmPcode: LM, provider: "" }, { lmPcode: LM, provider: "Contour" }, { lmPcode: LM, provider: "1contour" },
    { lmPcode: LM, provider: "contour!" }, { lmPcode: LM, provider: "c".repeat(41) },
  ];
  for (const data of bad) {
    await rejectsWithCode(() => invoke({ request: authed(data) }), "invalid-argument");
  }
});

test("provider defaults to contour when omitted", async () => {
  const result = await ok(BASELINE().files);
  assert.equal(result.provider, PROVIDER);
  assert.equal(result.latestMonth, "2026-06");
});

// ------------------------------------------------------------------ 3. missing user

test("absent user document is denied", async () => {
  for (const users of [{}, { UID_A: undefined }, { UID_A: {} }]) {
    await rejectsWithCode(() => invoke({ request: authed({ lmPcode: LM }), users }), "permission-denied");
  }
});

// ------------------------------------------------- 4. unauthorized workbase

test("workbase assignment for another LM is denied", async () => {
  const users = { UID_A: { access: { workbases: [{ id: "ZA7423" }] } } };
  await rejectsWithCode(() => invoke({ request: authed({ lmPcode: LM }), users }), "permission-denied");
});

test("empty or malformed workbase assignment is denied", async () => {
  for (const user of [{ access: {} }, { access: { workbases: [] } }, { access: { workbases: "ZA5241" } }, { access: { workbases: [{}] } }]) {
    await rejectsWithCode(() => invoke({ request: authed({ lmPcode: LM }), users: { UID_A: user } }), "permission-denied");
  }
});

// ------------------------------------------------- 5. unauthorized provider

test("an ungoverned provider partition is denied even for an authorized workbase", async () => {
  for (const provider of ["othersupplier", "eskom", "contour2", "conto"]) {
    await assert.rejects(
      () => invoke({ request: authed({ lmPcode: LM, provider }), users: { UID_A: AUTHORIZED } }),
      error => {
        assert.equal(error.code, "permission-denied");
        assert.equal(error.details?.reasonCode, "PROVIDER_NOT_GOVERNED");
        return true;
      },
    );
  }
});

test("provider authorization is checked before any storage read", async () => {
  // Bucket throws on any access; the denial must arrive regardless.
  const exploding = { file() { throw new Error("storage must not be touched"); } };
  await rejectsWithCode(
    () => invoke({ request: authed({ lmPcode: LM, provider: "othersupplier" }), users: { UID_A: AUTHORIZED }, bucket: exploding }),
    "permission-denied",
  );
});

test("provider authorization does not weaken workbase authorization", async () => {
  const users = { UID_A: { access: { workbases: [{ id: "ZA7423" }] } } };
  await rejectsWithCode(() => invoke({ request: authed({ lmPcode: LM, provider: PROVIDER }), users }), "permission-denied");
});

// ------------------------------------------------------------ 6. authorized request

test("authorized request returns publication metadata with verified snapshots", async () => {
  const { files, publication } = BASELINE();
  const result = await ok(files);
  assert.equal(result.status, "OK");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.lmPcode, LM);
  assert.equal(result.provider, PROVIDER);
  assert.equal(result.latestMonth, "2026-06");
  assert.equal(result.baselineMonth, "2026-06");
  assert.equal(result.latestVerifiedMonth, "2026-06");
  assert.deepEqual(Object.keys(result.months), Object.keys(publication.months));
  assert.equal(result.snapshots.length, 1);
  assert.deepEqual(result.snapshots[0].members, ["M1", "M2"]);
  assert.equal(result.diagnostics, null);
  assert.match(result.publicationRevision, /^[a-f0-9]{64}$/);
});

test("string workbase assignments are accepted", async () => {
  const result = await invoke({ request: authed({ lmPcode: LM }), files: BASELINE().files, users: { UID_A: { access: { workbases: [LM] } } } });
  assert.equal(result.latestMonth, "2026-06");
});

// ---------------------------------------------------------- 7. absent publication

test("absent publication returns an explicit PUBLICATION_ABSENT result rather than an error", async () => {
  const result = await ok({});
  assert.equal(result.status, "PUBLICATION_ABSENT");
  assert.equal(result.latestMonth, null);
  assert.deepEqual(result.months, {});
  assert.deepEqual(result.snapshots, []);
  assert.deepEqual(result.timeline, []);
  assert.equal(result.publicationRevision, null);
  assert.equal(result.baselineMonth, null);
  assert.equal(result.evaluation.timeZone, "Africa/Johannesburg");
});

// ------------------------------------------------------- 8. transient failures

test("a transient storage failure on publication is reported as unavailable, not invalid evidence", async () => {
  for (const code of [500, 502, 503, 504, 429, 408]) {
    const prefix = `governed-sales/${LM}/${PROVIDER}`;
    const bucket = fakeBucket({}, { failPaths: { [`${prefix}/publication.json`]: Object.assign(new Error("upstream"), { code }) } });
    await assert.rejects(
      () => invoke({ request: authed({ lmPcode: LM }), users: { UID_A: AUTHORIZED }, bucket }),
      error => {
        assert.equal(error.code, "unavailable", `code ${code} should classify as unavailable`);
        assert.equal(error.details?.reasonCode, "PUBLICATION_READ_FAILED");
        return true;
      },
    );
  }
});

test("a transient storage failure while reading month evidence is unavailable, not invalid evidence", async () => {
  const { files, built, prefix } = TWO_MONTHS();
  const bucket = fakeBucket(files, { failPaths: { [`${prefix}/snapshots/${built[1].snapshotSha256}.json`]: Object.assign(new Error("upstream"), { code: 503 }) } });
  await assert.rejects(
    () => invoke({ request: authed({ lmPcode: LM }), users: { UID_A: AUTHORIZED }, bucket }),
    error => {
      assert.equal(error.code, "unavailable");
      assert.equal(error.details?.reasonCode, "EVIDENCE_READ_FAILED");
      assert.equal(error.details?.month, "2026-07");
      return true;
    },
  );
});

test("a Firestore failure during authorization is unavailable, not permission-denied", async () => {
  await assert.rejects(
    () => invoke({ request: authed({ lmPcode: LM }), db: fakeDb({}, { fail: true }) }),
    error => {
      assert.equal(error.code, "unavailable");
      assert.equal(error.details?.reasonCode, "USER_LOOKUP_FAILED");
      return true;
    },
  );
});

// -------------------------------------------------------- 9. malformed publication

test("malformed publication JSON is reported as invalid evidence with a reason code", async () => {
  const prefix = `governed-sales/${LM}/${PROVIDER}`;
  for (const body of ["{ not json", "", "null", "[]"]) {
    await assert.rejects(
      () => ok({ [`${prefix}/publication.json`]: Buffer.from(body) }),
      error => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reasonCode, "PUBLICATION_ENVELOPE_INVALID");
        return true;
      },
    );
  }
});

test("a gap in the published month sequence rejects the whole publication envelope", async () => {
  const { files } = buildEvidence([{ month: "2026-06", members: ["M1", "M2"] }, { month: "2026-08", members: ["M1", "M2"] }]);
  await rejectsWithCode(() => ok(files), "failed-precondition");
});

test("a baseline other than June 2026 is rejected for the Endumeni contour release", async () => {
  const { files } = buildEvidence([{ month: "2026-07", members: ["M1", "M2"] }]);
  await rejectsWithCode(() => ok(files), "failed-precondition");
});

// --------------------------- 10. verified prefix + structured month diagnostics

test("a missing snapshot object yields the verified prefix and INVALID_EVIDENCE diagnostics", async () => {
  const { files, built, prefix } = TWO_MONTHS();
  delete files[`${prefix}/snapshots/${built[1].snapshotSha256}.json`];
  const result = await ok(files);
  assert.equal(result.status, "OK");
  assert.equal(result.snapshots.length, 1, "June must remain available");
  assert.equal(result.latestVerifiedMonth, "2026-06");
  assert.equal(stateOf(result, "2026-06"), MONTH_STATE.VERIFIED);
  assert.equal(stateOf(result, "2026-07"), MONTH_STATE.INVALID_EVIDENCE);
  assert.equal(result.diagnostics.month, "2026-07");
  assert.equal(result.diagnostics.reasonCode, "MONTH_EVIDENCE_INVALID");
  assert.match(result.diagnostics.message, /missing or unreadable/);
});

test("a missing verification report yields the verified prefix and diagnostics", async () => {
  const { files, built, prefix } = TWO_MONTHS();
  delete files[`${prefix}/reports/${built[1].reportSha256}.json`];
  const result = await ok(files);
  assert.equal(result.latestVerifiedMonth, "2026-06");
  assert.equal(stateOf(result, "2026-07"), MONTH_STATE.INVALID_EVIDENCE);
});

test("a bad snapshot hash yields the verified prefix and diagnostics", async () => {
  const { files, built, prefix } = TWO_MONTHS();
  const tampered = JSON.parse(built[1].snapshotBytes.toString("utf8"));
  tampered.members = ["M1", "M3", "M9"];
  files[`${prefix}/snapshots/${built[1].snapshotSha256}.json`] = Buffer.from(JSON.stringify(tampered));
  const result = await ok(files);
  assert.equal(result.latestVerifiedMonth, "2026-06");
  assert.equal(stateOf(result, "2026-07"), MONTH_STATE.INVALID_EVIDENCE);
  assert.match(result.diagnostics.message, /hash mismatch/i);
});

test("a bad verification report hash yields the verified prefix and diagnostics", async () => {
  const { files, built, prefix } = TWO_MONTHS();
  const tampered = JSON.parse(built[1].reportBytes.toString("utf8"));
  tampered.rowsRead = 99;
  files[`${prefix}/reports/${built[1].reportSha256}.json`] = Buffer.from(JSON.stringify(tampered));
  const result = await ok(files);
  assert.equal(result.latestVerifiedMonth, "2026-06");
  assert.equal(stateOf(result, "2026-07"), MONTH_STATE.INVALID_EVIDENCE);
});

test("a broken snapshot chain hash yields the verified prefix and diagnostics", async () => {
  const { files, built, prefix } = TWO_MONTHS();
  const second = JSON.parse(built[1].snapshotBytes.toString("utf8"));
  second.previousSnapshotSha256 = "c".repeat(64);
  const bytes = Buffer.from(JSON.stringify(second));
  const rehashed = sha(bytes);
  const publication = JSON.parse(files[`${prefix}/publication.json`].toString("utf8"));
  delete files[`${prefix}/snapshots/${built[1].snapshotSha256}.json`];
  publication.months["2026-07"].snapshotSha256 = rehashed;
  files[`${prefix}/snapshots/${rehashed}.json`] = bytes;
  files[`${prefix}/publication.json`] = Buffer.from(JSON.stringify(publication));
  const result = await ok(files);
  assert.equal(result.latestVerifiedMonth, "2026-06");
  assert.equal(stateOf(result, "2026-07"), MONTH_STATE.INVALID_EVIDENCE);
  assert.match(result.diagnostics.message, /chain mismatch/i);
});

test("an unverified month claim yields the verified prefix and diagnostics", async () => {
  const { files, prefix } = TWO_MONTHS();
  const publication = JSON.parse(files[`${prefix}/publication.json`].toString("utf8"));
  publication.months["2026-07"].verification.complete = false;
  files[`${prefix}/publication.json`] = Buffer.from(JSON.stringify(publication));
  const result = await ok(files);
  assert.equal(result.latestVerifiedMonth, "2026-06");
  assert.equal(stateOf(result, "2026-07"), MONTH_STATE.INVALID_EVIDENCE);
  assert.match(result.diagnostics.message, /not verified/i);
});

test("an unreconciled replacement yields the verified prefix and diagnostics", async () => {
  const { files } = buildEvidence([
    { month: "2026-06", members: ["M1", "M2"] },
    { month: "2026-07", members: ["M1", "M3"], replacements: [{ predecessor: "M8", successor: "M3" }] },
  ]);
  const result = await ok(files);
  assert.equal(result.latestVerifiedMonth, "2026-06");
  assert.equal(stateOf(result, "2026-07"), MONTH_STATE.INVALID_EVIDENCE);
});

test("months after a failure are MISSING_COMPARISON and are never computed through the break", async () => {
  const { files, built, prefix } = THREE_MONTHS();
  delete files[`${prefix}/snapshots/${built[1].snapshotSha256}.json`];
  const result = await ok(files);
  assert.equal(result.snapshots.length, 1);
  assert.equal(stateOf(result, "2026-06"), MONTH_STATE.VERIFIED);
  assert.equal(stateOf(result, "2026-07"), MONTH_STATE.INVALID_EVIDENCE);
  assert.equal(stateOf(result, "2026-08"), MONTH_STATE.MISSING_COMPARISON);
  const august = result.timeline.find(entry => entry.month === "2026-08");
  assert.equal(august.reasonCode, "COMPARISON_BLOCKED_BY_2026-07");
  assert.ok(!result.snapshots.some(item => item.month === "2026-08"), "August must not be computed through a broken chain");
});

// ------------------------------------------------- 11. valid multi-month result

test("a valid multi-month publication returns every verified snapshot in order", async () => {
  const result = await ok(TWO_MONTHS().files);
  assert.equal(result.latestMonth, "2026-07");
  assert.equal(result.latestVerifiedMonth, "2026-07");
  assert.equal(result.snapshots.length, 2);
  assert.deepEqual(result.snapshots.map(item => item.month), ["2026-06", "2026-07"]);
  assert.deepEqual(result.snapshots[1].replacements, [{ predecessor: "M2", successor: "M3" }]);
  assert.equal(result.snapshots[1].previousSnapshotSha256, result.months["2026-06"].snapshotSha256);
  assert.equal(result.diagnostics, null);
});

test("multi-month snapshots carry no future-month leakage beyond latestMonth", async () => {
  const result = await ok(TWO_MONTHS().files);
  for (const snapshot of result.snapshots) {
    assert.ok(snapshot.month <= result.latestMonth);
    assert.equal(snapshot.lmPcode, LM);
    assert.equal(snapshot.provider, PROVIDER);
  }
});

// --------------------------------- 12. server timestamp / Johannesburg timeline

test("the response carries the server evaluation timestamp and Johannesburg timezone", async () => {
  const result = await ok(BASELINE().files);
  assert.equal(result.evaluation.timeZone, "Africa/Johannesburg");
  assert.equal(result.evaluation.evaluatedAt, NOW.toISOString());
  assert.equal(result.evaluation.calendarMonth, "2026-09");
});

test("the calendar month is evaluated in Johannesburg, not UTC", async () => {
  // 2026-08-31T23:30Z is already 2026-09-01 in Africa/Johannesburg (UTC+2).
  const result = await ok(BASELINE().files, { now: new Date("2026-08-31T23:30:00.000Z") });
  assert.equal(result.evaluation.calendarMonth, "2026-09");
});

test("the next month after the latest published month is shown and disabled while unpublished", async () => {
  const result = await ok(TWO_MONTHS().files);
  const next = result.timeline.at(-1);
  assert.equal(next.month, "2026-08");
  assert.equal(next.published, false);
  assert.equal(next.state, MONTH_STATE.AWAITING_PUBLICATION, "2026-08 is not later than the 2026-09 evaluation month");
});

test("a next month later than the Johannesburg calendar month is FUTURE_DISABLED", async () => {
  const result = await ok(TWO_MONTHS().files, { now: new Date("2026-07-10T10:00:00.000Z") });
  const next = result.timeline.at(-1);
  assert.equal(next.month, "2026-08");
  assert.equal(next.state, MONTH_STATE.FUTURE_DISABLED);
});

test("no month is ever labelled OVERDUE or NOT_YET_DUE", async () => {
  const result = await ok(TWO_MONTHS().files);
  for (const entry of result.timeline) {
    assert.ok(!/OVERDUE|NOT_YET_DUE/.test(entry.state), `unexpected state ${entry.state}`);
  }
});
