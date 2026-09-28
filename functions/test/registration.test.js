// RG-R001: a registration produces its meter, or it never happened.
//
// These tests hold the rule itself: the four writes go together, the two times are both kept, a
// refused submission is recorded where the office can read it, and the sentence a worker reads is the
// right one for the field that was missing.
import assert from "node:assert/strict";
import test from "node:test";

import { registerMeterInTransaction } from "../registration/registerMeter.js";
import { recordRefusedSubmission } from "../registration/refusedSubmissions.js";
import {
  DEVICE_TIME_MISSING,
  buildRegistrationMetadata,
} from "../registration/registrationMetadata.js";
import { plainReasonFor } from "../meterDiscovery/captureOutcome.js";

// ---------------------------------------------------------------------------
// Fakes: just enough Firestore to watch what a registration writes.
// ---------------------------------------------------------------------------

function fakeDb(docs = {}) {
  return {
    collection(name) {
      return {
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
  assert.equal(Object.keys(docs).length, 1);
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
