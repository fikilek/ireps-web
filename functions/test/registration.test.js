// RG-R001: a registration produces its meter, or it never happened.
//
// These tests hold the rule itself: the four writes go together, the two times are both kept, a
// refused submission is recorded where the office can read it, and the sentence a worker reads is the
// right one for the field that was missing.
import assert from "node:assert/strict";
import test from "node:test";

import { registerMeterInTransaction } from "../registration/registerMeter.js";
import {
  recordRefusedSubmission,
  resolveRefusalsForMeter,
  resolveRefusedSubmission,
} from "../registration/refusedSubmissions.js";
import {
  DEVICE_TIME_MISSING,
  buildRegistrationMetadata,
} from "../registration/registrationMetadata.js";
import { plainReasonFor } from "../meterDiscovery/captureOutcome.js";

// ---------------------------------------------------------------------------
// Fakes: just enough Firestore to watch what a registration writes.
// ---------------------------------------------------------------------------

function this_collection(docs, name) {
  return {
    doc(id) {
      const path = name + "/" + id;
      return {
        path,
        id,
        get: async () => ({ exists: Boolean(docs[path]), id, data: () => docs[path] || null }),
        set: async (value, options) => {
          docs[path] = options?.merge ? { ...(docs[path] || {}), ...value } : value;
          return { path, value };
        },
      };
    },
  };
}

// Enough of a query for the one the resolver makes: two equality filters on one collection.
function fakeQuery(docs, name, tests = []) {
  return {
    where: (field, op, value) => fakeQuery(docs, name, [...tests, { field, op, value }]),
    get: async () => ({
      docs: Object.keys(docs)
        .filter((path) => path.startsWith(name + "/") && !path.slice(name.length + 1).includes("/"))
        .filter((path) => tests.every(({ field, value }) => docs[path]?.[field] === value))
        .map((path) => ({ id: path.slice(name.length + 1), data: () => docs[path] })),
    }),
  };
}

function fakeDb(docs = {}) {
  return {
    collection(name) {
      return {
        where: (field, op, value) => fakeQuery(docs, name, [{ field, op, value }]),
        doc(id) {
          const path = `${name}/${id}`;
          return {
            path,
            id,
            get: async () => ({
              exists: Boolean(docs[path]),
              id,
              data: () => docs[path] || null,
            }),
            set: async (value, options) => {
              docs[path] = options?.merge
                ? { ...(docs[path] || {}), ...value }
                : value;
              return { path, value };
            },
            // RG-R001 1.3.0: a refusal keeps its attempts beneath it, so a document has collections.
            collection: (child) => this_collection(docs, path + "/" + child),
          };
        },
      };
    },
  };
}

function fakeTx(docs = {}) {
  const writes = [];
  return {
    writes,
    get: async (ref) => ({
      exists: Boolean(docs[ref.path]),
      id: ref.id,
      data: () => docs[ref.path] || null,
    }),
    create: (ref, value) => writes.push({ op: "create", path: ref.path, value }),
    update: (ref, value) => writes.push({ op: "update", path: ref.path, value }),
    set: (ref, value) => writes.push({ op: "set", path: ref.path, value }),
  };
}

const METADATA = {
  createdOnDevice: "2026-09-25T06:00:00.000Z",
  updatedOnDevice: "2026-09-25T06:00:00.000Z",
  createdOnServer: "2026-09-28T09:00:00.000Z",
  updatedOnServer: "2026-09-28T09:00:00.000Z",
  createdAt: "2026-09-28T09:00:00.000Z",
  updatedAt: "2026-09-28T09:00:00.000Z",
  createdByUid: "uid-fwr",
  createdByUser: "Kaiser",
  updatedByUid: "uid-fwr",
  updatedByUser: "Kaiser",
};

const TRN_ID = "TRN_MDIS_1790000000000_ELC_ZA5241006_1755";

const TRN_DATA = {
  id: TRN_ID,
  meterType: "electricity",
  accessData: {
    trnType: "METER_DISCOVERY",
    erfId: "ERF-1",
    erfNo: "1755",
    access: { hasAccess: "yes", reason: "NAv" },
    premise: { id: "PRM-1", address: "12 Smith Street", propertyType: "House" },
    parents: { lmPcode: "ZA5241", wardPcode: "W006" },
  },
  ast: { astData: { astNo: "04297698369" } },
  status: { state: "CONNECTED", id: "ZA5241", detail: "Endumeni" },
  serviceProvider: { id: "SP-1", name: "Lefu Metering" },
  media: [{ tag: "astNoPhoto", url: "https://x/1.jpg" }],
  metadata: METADATA,
};

function deps(overrides = {}) {
  return {
    classifyOperationalAstChange: () => ({ classification: "CREATE_FIELD_ONLY" }),
    METER_MASTER_CLASSIFICATIONS: {
      CONFLICT: "CONFLICT",
      CREATE_FIELD_ONLY: "CREATE_FIELD_ONLY",
      UPDATE_AST_LINK: "UPDATE_AST_LINK",
    },
    MeterMasterConflictError: class extends Error {
      constructor(conflict) {
        super(conflict?.message || "conflict");
        this.conflict = conflict;
      }
    },
    buildCanonicalFieldOnlyMeterMaster: () => ({
      refs: { asts: { id: TRN_ID }, sales: { id: "" } },
    }),
    buildOperationalAstUpdate: () => ({ "refs.asts.id": TRN_ID }),
    deriveMasterVisibility: (master) =>
      master?.refs?.sales?.id ? "VISIBLE" : "INVISIBLE",
    syncSalesAllMetersFromMaster: async () => ({ outcome: "NO_SALES_RECORD" }),
    completeTargetedBatchMeterDiscoveryInTransaction: async () => ({
      applied: false,
    }),
    normalizeCreationReadings: ({ data }) => ({
      ast: data.ast,
      mreadings: [],
      treadings: [],
    }),
    projectMeterDiscoveryAstMedia: (media) => media,
    buildPremiseUpdateMetadata: () => ({
      updatedAt: METADATA.updatedOnServer,
      updatedByUid: "uid-fwr",
      updatedByUser: "Kaiser",
    }),
    getServiceBucketFromMeterType: () => "electricityMeters",
    normalizePremiseServiceSnapshotItem: (item) => item,
    logger: { log() {}, info() {}, warn() {}, error() {} },
    ...overrides,
  };
}

async function register(docs, overrides = {}) {
  const tx = fakeTx(docs);
  const result = await registerMeterInTransaction({
    tx,
    db: fakeDb(docs),
    Timestamp: { now: () => "TS" },
    trnData: TRN_DATA,
    trnId: TRN_ID,
    rawMeterNo: "04297698369",
    normalizedMeterNo: "04297698369",
    meterType: "electricity",
    lmPcode: "ZA5241",
    premiseId: "PRM-1",
    erfId: "ERF-1",
    metadata: METADATA,
    deps: deps(overrides),
  });

  return { tx, result };
}

// ---------------------------------------------------------------------------
// The four writes
// ---------------------------------------------------------------------------

test("a registration writes the meter, the master, the premise and the ERF together", async () => {
  const { tx } = await register({ "premises/PRM-1": { services: {} } });
  const paths = tx.writes.map((write) => `${write.op} ${write.path}`);

  assert.deepEqual(paths, [
    `create asts/${TRN_ID}`,
    "create meter_master/04297698369",
    "update premises/PRM-1",
    "update ireps_erfs/ERF-1",
  ]);
});

test("the meter carries the transaction's own id, inside and out", async () => {
  const { tx, result } = await register({ "premises/PRM-1": { services: {} } });
  const ast = tx.writes.find((write) => write.path.startsWith("asts/"));

  assert.equal(result.astId, TRN_ID);
  assert.equal(ast.value.trnId, TRN_ID);
  assert.equal(ast.value.ast.astData.astId, TRN_ID);
  assert.equal(result.derived.astId, TRN_ID);
});

test("the premise gets the meter on its own list, which is what the premise card reads", async () => {
  const { tx } = await register({ "premises/PRM-1": { services: {} } });
  const premise = tx.writes.find((write) => write.path === "premises/PRM-1");

  assert.deepEqual(premise.value["services.electricityMeters"], [
    { trnId: TRN_ID, status: "CONNECTED", updatedAt: METADATA.updatedOnServer },
  ]);
  assert.equal(premise.value["occupancy.status"], "Accessed");
});

test("a meter already on the premise's list is updated, never added twice", async () => {
  const { tx } = await register({
    "premises/PRM-1": {
      services: {
        electricityMeters: [
          { trnId: TRN_ID, status: "RECORDED", updatedAt: "old" },
        ],
      },
    },
  });
  const premise = tx.writes.find((write) => write.path === "premises/PRM-1");

  assert.equal(premise.value["services.electricityMeters"].length, 1);
  assert.equal(premise.value["services.electricityMeters"][0].status, "CONNECTED");
});

test("visibility is derived, so a meter Sales has never heard of is INVISIBLE", async () => {
  const { result } = await register({ "premises/PRM-1": { services: {} } });
  assert.equal(result.visibility, "INVISIBLE");
});

test("a meter Sales already holds is VISIBLE", async () => {
  const { result } = await register(
    { "premises/PRM-1": { services: {} } },
    {
      buildCanonicalFieldOnlyMeterMaster: () => ({
        refs: { asts: { id: TRN_ID }, sales: { id: "SALES-1" } },
      }),
    },
  );
  assert.equal(result.visibility, "VISIBLE");
});

test("a meter master conflict stops the whole registration", async () => {
  await assert.rejects(
    register(
      { "premises/PRM-1": { services: {} } },
      {
        classifyOperationalAstChange: () => ({
          classification: "CONFLICT",
          conflict: {
            conflictCode: "MM_AST_REFERENCE_CONFLICT",
            message: "Meter Master is already linked to a different AST",
          },
        }),
      },
    ),
    (error) => error.conflict.conflictCode === "MM_AST_REFERENCE_CONFLICT",
  );
});

test("a premise that has gone stops the registration, and nothing is written", async () => {
  await assert.rejects(register({}), (error) => {
    assert.equal(error.irepsCode, "PREMISE_NOT_FOUND");
    return true;
  });
});

test("a meter that is neither water nor electricity is refused before any write", async () => {
  await assert.rejects(
    register(
      { "premises/PRM-1": { services: {} } },
      { getServiceBucketFromMeterType: () => null },
    ),
    (error) => error.irepsCode === "INVALID_SERVICE_BUCKET",
  );
});

test("an existing meter is left alone, so a repair cannot double-write it", async () => {
  const { tx } = await register({
    "premises/PRM-1": { services: {} },
    [`asts/${TRN_ID}`]: { trnId: TRN_ID },
  });

  assert.equal(
    tx.writes.some((write) => write.path === `asts/${TRN_ID}`),
    false,
  );
});

// ---------------------------------------------------------------------------
// The two times
// ---------------------------------------------------------------------------

test("the phone's own time is kept, and the server's time beside it", () => {
  const metadata = buildRegistrationMetadata({
    phoneMetadata: { createdOnDevice: "2026-09-25T06:00:00.000Z" },
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    nowIso: "2026-09-28T09:00:00.000Z",
  });

  assert.equal(metadata.createdOnDevice, "2026-09-25T06:00:00.000Z");
  assert.equal(metadata.createdOnServer, "2026-09-28T09:00:00.000Z");
  assert.equal(metadata.createdByUser, "Kaiser");
  assert.equal(metadata[DEVICE_TIME_MISSING], undefined);
});

test("an older build that sends its time under the old name is still believed", () => {
  const metadata = buildRegistrationMetadata({
    phoneMetadata: { createdAt: "2026-09-25T06:00:00.000Z" },
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    nowIso: "2026-09-28T09:00:00.000Z",
  });

  assert.equal(metadata.createdOnDevice, "2026-09-25T06:00:00.000Z");
});

test("a build that sends no time at all says so, rather than pretending", () => {
  const metadata = buildRegistrationMetadata({
    phoneMetadata: {},
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    nowIso: "2026-09-28T09:00:00.000Z",
  });

  assert.equal(metadata.createdOnDevice, "2026-09-28T09:00:00.000Z");
  assert.equal(metadata[DEVICE_TIME_MISSING], true);
});

test("a time that is not a time is not stored as one", () => {
  const metadata = buildRegistrationMetadata({
    phoneMetadata: { createdOnDevice: "yesterday morning" },
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    nowIso: "2026-09-28T09:00:00.000Z",
  });

  assert.equal(metadata.createdOnDevice, "2026-09-28T09:00:00.000Z");
  assert.equal(metadata[DEVICE_TIME_MISSING], true);
});

// ---------------------------------------------------------------------------
// A refused submission
// ---------------------------------------------------------------------------

test("a refusal is recorded where the office can read it, and never as a transaction", async () => {
  const docs = {};
  const result = await recordRefusedSubmission({
    db: fakeDb(docs),
    trnId: TRN_ID,
    code: "MM_AST_REFERENCE_CONFLICT",
    message: "Meter Master is already linked to a different AST",
    data: TRN_DATA,
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    now: "2026-09-28T09:00:00.000Z",
  });

  assert.equal(result.recorded, true);
  // The submission, and the attempt beneath it. RG-R001 1.3.0: no attempt overwrites another.
  assert.equal(Object.keys(docs).length, 2);
  const record = docs[`refused_submissions/${TRN_ID}`];
  assert.ok(record, "the refusal is in refused_submissions");
  assert.equal(record.meterNo, "04297698369");
  assert.equal(record.erfNo, "1755");
  assert.equal(record.worker.name, "Kaiser");
  assert.equal(record.doneOnDevice, METADATA.createdOnDevice);
  assert.equal(
    record.refusal.reason,
    "This meter number is already registered on another meter.",
  );
  assert.equal(
    record.refusal.detail,
    "Meter Master is already linked to a different AST",
  );
});

test("a refusal that cannot be written never replaces itself with a worse failure", async () => {
  const result = await recordRefusedSubmission({
    db: {
      collection: () => ({
        doc: () => ({
          set: async () => {
            throw new Error("Firestore is unhappy");
          },
        }),
      }),
    },
    trnId: TRN_ID,
    code: "UNKNOWN",
  });

  assert.equal(result.recorded, false);
});

// ---------------------------------------------------------------------------
// The words a worker reads
// ---------------------------------------------------------------------------

test("the three silent refusals now say what is wrong and who fixes it", () => {
  assert.match(
    plainReasonFor({
      code: "MISSING_REQUIRED_FIELD",
      message: "accessData.erfId is required",
    }),
    /no ERF number/,
  );

  assert.match(
    plainReasonFor({
      code: "MISSING_REQUIRED_FIELD",
      message: "serviceProvider.id is required",
    }),
    /not linked to a service provider/,
  );

  assert.match(
    plainReasonFor({ code: "OUTDATED_APP_NORMALISATION" }),
    /Update the app/,
  );
});

test("a missing ward reads as an office problem, not a worker's mistake", () => {
  assert.match(
    plainReasonFor({
      code: "MISSING_REQUIRED_PARENT",
      message: "accessData.parents.wardPcode is required",
    }),
    /missing its ward or municipality/,
  );
});

test("an unknown code still reads as a sentence", () => {
  assert.equal(
    plainReasonFor({ code: "SOMETHING_NEW" }),
    "This capture could not be completed.",
  );
});

test("every meter master refusal reads as one thing to a worker", () => {
  assert.equal(
    plainReasonFor({ code: "MM_CANONICAL_SHAPE_UNSAFE", message: "Meter Master canonical shape is unsafe" }),
    "This meter number is already registered on another meter.",
  );
});

// ---------------------------------------------------------------------------
// Rules 1.3.88: a batch the server recognised is not a capture made from a batch row.
//
// The same line that stopped TB-R056 closing rows also counted a Normal Path find on a batched ERF as
// batch work in the team's field work summary, and left it out of the tally it belongs in. One meaning,
// asked in one place, so the two cannot drift apart again.
// ---------------------------------------------------------------------------
const { isBatchTrn, summarizeFieldWork } = await import("../teams/field-work-summary.js");

const RECOGNISED = {
  tbId: "TGB_20260919_065232_OXIN",
  rowId: "TBR_20260919_065232_OXIN_000005",
  erfId: "ERF-1",
  premiseId: "PRM-1",
  recognisedBy: "IREPS",
  rule: "GMR-R038",
};

test("a batch the server recognised is not sales-path work", () => {
  assert.equal(isBatchTrn({ targetedBatchContext: RECOGNISED }), false);
});

test("a capture made from a batch row is", () => {
  assert.equal(
    isBatchTrn({
      sourceModule: "SALES_TARGETED_BATCH",
      targetedBatchContext: { tbId: "TGB_1", rowId: "TBR_1" },
    }),
    true,
  );
  assert.equal(isBatchTrn({ targetedBatchContext: { tbId: "TGB_1" } }), true);
});

test("a find the Sales Path completed stays sales-path work, stamp or no stamp", () => {
  assert.equal(
    isBatchTrn({
      targetedBatchContext: RECOGNISED,
      derived: { targetedBatch: { tbId: "TGB_1", rowId: "TBR_1" } },
    }),
    true,
  );
});

test("the team's summary counts a recognised find as the normal-path work it is", () => {
  const trn = {
    id: "TRN_MDIS_1790601908827_ELC_ZA5241006_5276",
    targetedBatchContext: RECOGNISED,
    accessData: {
      trnType: "METER_DISCOVERY",
      access: { hasAccess: "yes" },
    },
    metadata: {
      createdAt: "2026-09-28T13:28:22.734Z",
      createdByUid: "uid-simo",
      createdByUser: "Simo Phemba",
    },
  };

  const summary = summarizeFieldWork({
    trns: [trn],
    periods: [
      {
        id: "TEAM1__uid-simo__1",
        teamId: "TEAM1",
        teamName: "Simo Team",
        userUid: "uid-simo",
        joinedAt: "2026-09-01T00:00:00.000Z",
        leftAt: null,
      },
    ],
    usersSp: { "uid-simo": { id: "SP1", name: "RSTE" } },
  });

  assert.equal(summary.totals.batchTrns, 0, "it was counted as batch work");
  assert.equal(summary.totals.normalTrns, 1, "and left out of the normal-path tally");
});

// RG-R001 1.3.0 section 7 (owner, 2026-09-29): every attempt is kept. One document per TRN ID meant each
// attempt overwrote the one before it, so a worker refused four times on one meter looked like a worker
// refused once - and that number is the signal that a rule or a form is wrong.
test("a second refusal does not overwrite the first, and the count climbs", async () => {
  const docs = {};
  const db = fakeDb(docs);
  const when = (n) => `2026-09-28T09:0${n}:00.000Z`;

  const first = await recordRefusedSubmission({
    db,
    trnId: TRN_ID,
    code: "MM_AST_REFERENCE_CONFLICT",
    message: "Meter Master is already linked to a different AST",
    data: TRN_DATA,
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    now: when(0),
  });

  const second = await recordRefusedSubmission({
    db,
    trnId: TRN_ID,
    code: "METER_IN_ANOTHER_TEAMS_BATCH",
    message: "That meter belongs to another team's batch",
    data: TRN_DATA,
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    now: when(5),
  });

  assert.equal(first.attempts, 1);
  assert.equal(second.attempts, 2);

  const record = docs[`refused_submissions/${TRN_ID}`];
  assert.equal(record.attempts, 2);
  assert.equal(record.firstRefusedAt, when(0), "the first refusal keeps its own time");
  assert.equal(record.lastRefusedAt, when(5));
  assert.equal(record.open, true);
  assert.equal(record.refusal.code, "METER_IN_ANOTHER_TEAMS_BATCH", "the latest reason is on top");

  // Both attempts survive, each under its own name.
  const attempts = Object.keys(docs).filter((path) => path.includes("/attempts/"));
  assert.equal(attempts.length, 2, "no attempt overwrote another");
  const older = docs[attempts.find((path) => path.includes("09-00-00"))];
  assert.equal(older.attempt, 1);
  assert.equal(older.refusal.code, "MM_AST_REFERENCE_CONFLICT", "the first reason is still readable");
});

test("a refusal is resolved, never deleted, and says which transaction stands", async () => {
  const docs = {};
  const db = fakeDb(docs);

  await recordRefusedSubmission({
    db,
    trnId: TRN_ID,
    code: "MM_AST_REFERENCE_CONFLICT",
    message: "Meter Master is already linked to a different AST",
    data: TRN_DATA,
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    now: "2026-09-28T09:00:00.000Z",
  });

  const outcome = await resolveRefusedSubmission({
    db,
    trnId: TRN_ID,
    how: "the worker submitted again",
    standingTrnId: "TRN_MDIS_LATER_ELC_ZA5241006_1755",
    byUid: "uid-fwr",
    byUser: "Kaiser",
    now: "2026-09-28T09:30:00.000Z",
  });

  assert.equal(outcome.resolved, true);
  assert.equal(outcome.attempts, 1);

  const record = docs[`refused_submissions/${TRN_ID}`];
  assert.equal(record.open, false);
  assert.equal(record.resolved.standingTrnId, "TRN_MDIS_LATER_ELC_ZA5241006_1755");
  assert.equal(record.resolved.how, "the worker submitted again");
  assert.ok(record.refusal, "the reason it was refused is still there");
  assert.equal(
    Object.keys(docs).filter((path) => path.includes("/attempts/")).length,
    1,
    "the attempt was not deleted either",
  );
});

// The phone never reuses a refused TRN ID - a Submit after a refusal is a new attempt with a new id. So
// the record that must be closed is almost never the one that succeeded, and it is found by the meter.
test("a registration that lands closes the open refusals for that meter, under whatever id they carry", async () => {
  const docs = {};
  const db = fakeDb(docs);

  await recordRefusedSubmission({
    db,
    trnId: TRN_ID,
    code: "METER_IN_ANOTHER_TEAMS_BATCH",
    message: "That meter belongs to another team's batch",
    data: TRN_DATA,
    actorUid: "uid-fwr",
    actorName: "Kaiser",
    now: "2026-09-28T09:00:00.000Z",
  });

  const outcome = await resolveRefusalsForMeter({
    db,
    meterNo: "04297698369",
    standingTrnId: "TRN_MDIS_LATER_ELC_ZA5241006_1755",
    byUid: "uid-fwr",
    byUser: "Kaiser",
    now: "2026-09-28T10:00:00.000Z",
  });

  assert.equal(outcome.resolved, 1);
  const record = docs[`refused_submissions/${TRN_ID}`];
  assert.equal(record.open, false);
  assert.equal(record.resolved.how, "the worker submitted again");
  assert.equal(record.resolved.standingTrnId, "TRN_MDIS_LATER_ELC_ZA5241006_1755");
});
