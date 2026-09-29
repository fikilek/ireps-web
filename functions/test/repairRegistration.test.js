// RG-R001 section 8: a transaction with no meter is repaired under its own TRN ID.
//
// Eight of these exist across the three environments. Each is a real visit whose meter was never made.
// The repair makes the meter from what the transaction already holds, keeps the worker's own
// attribution, records who repaired it, and refuses whenever a person should decide instead.
import assert from "node:assert/strict";
import test from "node:test";

import {
  NOT_REPAIRABLE,
  inspectRegistration,
  repairRegistration,
  whyNot,
} from "../registration/repairRegistration.js";

const TRN_ID = "TRN_MDIS_1790555986842_ELC_ZA5241006_1755";

const ORPHAN = {
  id: TRN_ID,
  meterType: "electricity",
  accessData: {
    trnType: "METER_DISCOVERY",
    erfId: "ERF-1755",
    erfNo: "1755",
    access: { hasAccess: "yes", reason: "NAv" },
    premise: { id: "PRM-1", address: "12 Smith Street", propertyType: "House" },
    parents: { lmPcode: "ZA5241", wardPcode: "W006" },
  },
  ast: { astData: { astNo: "04297698369" } },
  status: { state: "CONNECTED", id: "ZA5241", detail: "Endumeni" },
  serviceProvider: { id: "SP-1", name: "Lefu Metering" },
  metadata: {
    createdOnDevice: "2026-09-25T06:00:00.000Z",
    createdAt: "2026-09-28T00:42:21.000Z",
    createdByUid: "uid-simo",
    createdByUser: "Simo Phemba",
  },
};

function fakeDb(docs) {
  const deleted = [];
  const written = [];

  return {
    docs,
    deleted,
    written,
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
            delete: async () => {
              deleted.push(path);
              delete docs[path];
            },
          };
        },
      };
    },
    runTransaction: async (body) => {
      const tx = {
        get: async (ref) => ({
          exists: Boolean(docs[ref.path]),
          id: ref.id,
          data: () => docs[ref.path] || null,
        }),
        create: (ref, value) => written.push({ op: "create", path: ref.path, value }),
        update: (ref, value) => written.push({ op: "update", path: ref.path, value }),
        set: (ref, value) => written.push({ op: "set", path: ref.path, value }),
      };

      return body(tx);
    },
  };
}

function deps(overrides = {}) {
  return {
    normalizeMeterNo: (value) => {
      const normalized = String(value ?? "").replace(/\s+/g, "").toUpperCase();
      if (!normalized || !/^[A-Z0-9]+$/.test(normalized)) {
        throw new TypeError("bad meter number");
      }
      return normalized;
    },
    validateMeterDiscoveryPayload: () => null,
    registerMeterInTransaction: async ({ tx, db, trnId, metadata }) => {
      tx.create(db.collection("asts").doc(trnId), { trnId, metadata });
      return {
        astId: trnId,
        visibility: "INVISIBLE",
        derived: { astId: trnId, master: { id: "04297698369", visibility: "INVISIBLE" } },
      };
    },
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
}

const base = () => ({
  [`trns/${TRN_ID}`]: ORPHAN,
  "premises/PRM-1": { services: {} },
});

// ---------------------------------------------------------------------------
// The dry run
// ---------------------------------------------------------------------------

test("a dry run says what it would write and writes nothing", async () => {
  const db = fakeDb(base());

  const outcome = await repairRegistration({
    db,
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    dryRun: true,
    deps: deps(),
  });

  assert.equal(outcome.success, true);
  assert.equal(outcome.repaired, false);
  assert.equal(outcome.code, "WOULD_REPAIR");
  assert.equal(outcome.willWrite.ast, `asts/${TRN_ID}`);
  assert.equal(outcome.willWrite.meterNo, "04297698369");
  assert.equal(outcome.willWrite.workedOn, "2026-09-25T06:00:00.000Z");
  assert.equal(outcome.willWrite.worker, "Simo Phemba");
  assert.equal(db.written.length, 0);
});

test("a dry run is the default, so a repair is never run by accident", async () => {
  const db = fakeDb(base());

  const outcome = await repairRegistration({
    db,
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    deps: deps(),
  });

  assert.equal(outcome.repaired, false);
  assert.equal(db.written.length, 0);
});

// ---------------------------------------------------------------------------
// The repair
// ---------------------------------------------------------------------------

test("the repair makes the meter under the transaction's own id", async () => {
  const db = fakeDb(base());

  const outcome = await repairRegistration({
    db,
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    reason: "Simo's meter of 25 September never became a meter",
    dryRun: false,
    deps: deps(),
    now: "2026-09-28T12:00:00.000Z",
  });

  assert.equal(outcome.repaired, true);
  assert.equal(outcome.astId, TRN_ID);

  const ast = db.written.find((write) => write.path === `asts/${TRN_ID}`);
  assert.ok(ast, "no meter was written");
});

test("the worker keeps the credit, and the repair is recorded beside it", async () => {
  const db = fakeDb(base());

  await repairRegistration({
    db,
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    reason: "orphan from 28 September",
    dryRun: false,
    deps: deps(),
    now: "2026-09-28T12:00:00.000Z",
  });

  const trnWrite = db.written.find((write) => write.path === `trns/${TRN_ID}`);
  assert.ok(trnWrite, "the transaction was not told it now has its meter");

  // The visit stays Simo's, on the day he did it.
  assert.equal(trnWrite.value.metadata.createdByUser, "Simo Phemba");
  assert.equal(trnWrite.value.metadata.createdOnDevice, "2026-09-25T06:00:00.000Z");
  // And the repair is recorded, not hidden.
  assert.equal(trnWrite.value.repair.byUser, "Fikile");
  assert.equal(trnWrite.value.repair.at, "2026-09-28T12:00:00.000Z");
  assert.equal(trnWrite.value.repair.reason, "orphan from 28 September");
  assert.equal(trnWrite.value.derived.astId, TRN_ID);
});

test("the refusal record is cleared, because the work is no longer refused", async () => {
  const docs = base();
  docs[`refused_submissions/${TRN_ID}`] = { trnId: TRN_ID };
  const db = fakeDb(docs);

  await repairRegistration({
    db,
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    reason: "orphan",
    dryRun: false,
    deps: deps(),
  });

  assert.deepEqual(db.deleted, [`refused_submissions/${TRN_ID}`]);
});

test("a repair without a reason is refused, because it is recorded in the person's own words", async () => {
  const db = fakeDb(base());

  await assert.rejects(
    repairRegistration({
      db,
      Timestamp: { now: () => "TS" },
      trnId: TRN_ID,
      actorUid: "uid-mng",
      actorName: "Fikile",
      dryRun: false,
      deps: deps(),
    }),
    (error) => error.irepsCode === "REPAIR_REASON_REQUIRED",
  );
});

// ---------------------------------------------------------------------------
// What it refuses to repair
// ---------------------------------------------------------------------------

test("a transaction that already has its meter is left alone", async () => {
  const docs = base();
  docs[`asts/${TRN_ID}`] = { trnId: TRN_ID };

  const outcome = await repairRegistration({
    db: fakeDb(docs),
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    deps: deps(),
  });

  assert.equal(outcome.success, false);
  assert.equal(outcome.code, NOT_REPAIRABLE.ALREADY_HAS_ITS_METER);
  assert.match(outcome.message, /nothing to repair/);
});

test("a No Access visit is complete as it stands", async () => {
  const docs = base();
  docs[`trns/${TRN_ID}`] = {
    ...ORPHAN,
    meterType: "NA",
    ast: null,
    accessData: {
      ...ORPHAN.accessData,
      access: { hasAccess: "no", reason: "Property Locked" },
    },
  };

  const outcome = await repairRegistration({
    db: fakeDb(docs),
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    deps: deps(),
  });

  assert.equal(outcome.code, NOT_REPAIRABLE.NO_ACCESS_HAS_NO_METER);
});

test("a meter number that now belongs to another meter needs a person, not a repair", async () => {
  const docs = base();
  docs["meter_master/04297698369"] = {
    refs: { asts: { id: "TRN_MDIS_OTHER_VISIT" } },
  };

  const outcome = await repairRegistration({
    db: fakeDb(docs),
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    deps: deps(),
  });

  assert.equal(outcome.code, NOT_REPAIRABLE.METER_NUMBER_TAKEN);
  assert.match(outcome.detail, /TRN_MDIS_OTHER_VISIT/);
});

test("a premise that has gone must be restored first", async () => {
  const docs = base();
  delete docs["premises/PRM-1"];

  const outcome = await repairRegistration({
    db: fakeDb(docs),
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    deps: deps(),
  });

  assert.equal(outcome.code, NOT_REPAIRABLE.PREMISE_NOT_FOUND);
});

test("work that would be refused today is not quietly stored by a repair", async () => {
  const outcome = await repairRegistration({
    db: fakeDb(base()),
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    deps: deps({
      validateMeterDiscoveryPayload: () => ({
        code: "ANOMALY_PHOTO_REQUIRED",
        message: "Anomaly photo is required",
      }),
    }),
  });

  assert.equal(outcome.code, NOT_REPAIRABLE.INVALID_PAYLOAD);
  assert.match(outcome.detail, /ANOMALY_PHOTO_REQUIRED/);
});

test("an unknown TRN ID says so plainly", async () => {
  const outcome = await repairRegistration({
    db: fakeDb({}),
    Timestamp: { now: () => "TS" },
    trnId: "TRN_MDIS_NOT_A_THING",
    actorUid: "uid-mng",
    actorName: "Fikile",
    deps: deps(),
  });

  assert.equal(outcome.code, NOT_REPAIRABLE.TRN_NOT_FOUND);
  assert.equal(whyNot(outcome.code), "There is no transaction with that TRN ID.");
});

test("inspecting never writes, whatever it finds", async () => {
  const db = fakeDb(base());
  const inspection = await inspectRegistration({ db, trnId: TRN_ID, deps: deps() });

  assert.equal(inspection.repairable, true);
  assert.equal(db.written.length, 0);
  assert.equal(db.deleted.length, 0);
});

// RG-R001 section 8 (owner, 2026-09-29): a batch that has since been deleted must not keep a meter out of
// iREPS. Found on TEST: Kaiser's capture of 7 August named batch TGB_20260807_051319_KYJL, which no longer
// exists, so the repair refused the whole thing. The visit happened and the worker was there.
test("a batch that no longer exists does not stop the repair, and is recorded", async () => {
  const db = fakeDb(base());
  const gone = Object.assign(new Error("Targeted Batch TGB_GONE was not found."), {
    irepsCode: "TARGETED_BATCH_NOT_FOUND",
  });

  const outcome = await repairRegistration({
    db,
    Timestamp: { now: () => "TS" },
    trnId: TRN_ID,
    actorUid: "uid-mng",
    actorName: "Fikile",
    reason: "the batch was deleted, the meter was not",
    dryRun: false,
    deps: deps({
      registerMeterInTransaction: async ({ tx, db: database, trnId, metadata, deps: inner }) => {
        // The creator calls the batch completion; here it finds the batch gone.
        const completion = await inner.completeTargetedBatchMeterDiscoveryInTransaction({});
        assert.equal(completion.batchGone, true, "the repair swallowed the missing batch");
        tx.create(database.collection("asts").doc(trnId), { trnId, metadata });
        return { astId: trnId, visibility: "INVISIBLE", derived: { astId: trnId } };
      },
      completeTargetedBatchMeterDiscoveryInTransaction: async () => {
        throw gone;
      },
    }),
    now: "2026-09-29T12:00:00.000Z",
  });

  assert.equal(outcome.repaired, true);
  assert.equal(outcome.batchGone, "TARGETED_BATCH_NOT_FOUND");
  assert.match(outcome.message, /batch it was filed under no longer exists/);

  const trnWrite = db.written.find((write) => write.path === `trns/${TRN_ID}`);
  assert.equal(trnWrite.value.repair.batchGone.code, "TARGETED_BATCH_NOT_FOUND");
});

test("anything else still stops the repair, so it never writes half a registration", async () => {
  const db = fakeDb(base());
  const other = Object.assign(new Error("Sales membership does not match"), {
    irepsCode: "TARGETED_BATCH_MEMBERSHIP_CONFLICT",
  });

  await assert.rejects(
    repairRegistration({
      db,
      Timestamp: { now: () => "TS" },
      trnId: TRN_ID,
      actorUid: "uid-mng",
      actorName: "Fikile",
      reason: "should not get through",
      dryRun: false,
      deps: deps({
        registerMeterInTransaction: async ({ deps: inner }) =>
          inner.completeTargetedBatchMeterDiscoveryInTransaction({}),
        completeTargetedBatchMeterDiscoveryInTransaction: async () => {
          throw other;
        },
      }),
    }),
    (error) => error.irepsCode === "TARGETED_BATCH_MEMBERSHIP_CONFLICT",
  );
});
