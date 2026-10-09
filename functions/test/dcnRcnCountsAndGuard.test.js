// DR-R001 3.1, 3.2 and 3.3:
//   the three counts a meter keeps about itself, and the guard that refuses to
//   issue work for a meter iREPS cannot account for.
import test from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

import { buildMeterCountPatch } from "../meterLifecycle/callables.js";
import {
  checkMeterRegistration,
  normalizeMeterNo,
  premiseHoldsMeter,
} from "../meterLifecycle/registrationGuard.js";

const METER = "TRN_MDIS_1777906617841_ELC_ZA7423013_2347";
const METER_NO = "07142661946";
const PREMISE = "PRM_1790072747921_691_W006_614";

// A database stub: documents keyed by "collection/id".
function dbWith(docs = {}) {
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const data = docs[`${name}/${id}`];

              return { exists: data !== undefined, data: () => data };
            },
          };
        },
      };
    },
  };
}

function soundWorld(overrides = {}) {
  return {
    [`asts/${METER}`]: {
      ast: { astData: { astId: METER, astNo: METER_NO } },
      accessData: { premise: { id: PREMISE } },
      status: { state: "CONNECTED" },
    },
    // A real METER DISCOVERY transaction: it carries the meter's NUMBER and
    // the meter's details, and no astId. The meter's id is this transaction's
    // own id, so there is nothing for it to repeat. Building this fixture the
    // other way - as an Installation, which does write astId - is what let the
    // guard refuse every discovered meter on DEV while these tests stayed green.
    [`trns/${METER}`]: {
      accessData: {
        trnType: "METER_DISCOVERY",
        access: { hasAccess: "yes" },
      },
      ast: { astData: { astNo: METER_NO } },
    },
    [`meter_master/${METER_NO}`]: { refs: { asts: { id: METER } } },
    [`premises/${PREMISE}`]: {
      services: { electricityMeters: [{ trnId: METER, status: "CONNECTED" }] },
    },
    ...overrides,
  };
}

test("a sound meter passes all seven checks", async () => {
  const outcome = await checkMeterRegistration({
    db: dbWith(soundWorld()),
    astId: METER,
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.checks.length, 7);
  assert.ok(outcome.checks.every((item) => item.ok));
});

test("a meter iREPS has no record of is refused", async () => {
  const world = soundWorld();
  delete world[`asts/${METER}`];

  const outcome = await checkMeterRegistration({ db: dbWith(world), astId: METER });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "METER_NOT_FOUND");
});

test("a meter whose registration cannot be found is refused", async () => {
  const world = soundWorld();
  delete world[`trns/${METER}`];

  const outcome = await checkMeterRegistration({ db: dbWith(world), astId: METER });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "REGISTRATION_NOT_FOUND");
  assert.equal(outcome.checks.find((c) => c.key === "REGISTRATION_TRN").ok, false);
});

test("a meter made by something that is not a registration is refused", async () => {
  const disconnectionId = "TRN_MDCN_1780462300896_ELC_ZA7423013_170";
  const world = {
    [`asts/${disconnectionId}`]: {
      ast: { astData: { astId: disconnectionId, astNo: METER_NO } },
      accessData: { premise: { id: PREMISE } },
    },
    [`trns/${disconnectionId}`]: {
      accessData: {
        trnType: "METER_DISCONNECTION",
        access: { hasAccess: "yes" },
      },
      ast: { astData: { astId: disconnectionId } },
    },
  };

  const outcome = await checkMeterRegistration({
    db: dbWith(world),
    astId: disconnectionId,
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "NOT_A_REGISTRATION");
});

// DR-R001 3.1 check 4, as corrected on 7 October 2026. It asks the METER to
// name its registration, and asks both records for the meter number. Both are
// true of a Discovery and of an Installation; the old check was true only of
// an Installation and refused 130 of 194 meters on DEV.
test("a meter made by an INSTALLATION passes, and so does one made by a DISCOVERY", async () => {
  const discovered = await checkMeterRegistration({
    db: dbWith(soundWorld()),
    astId: METER,
  });

  // An Installation also writes the meter id onto its own transaction. That
  // extra field must not be required, and must not get in the way either.
  const installed = await checkMeterRegistration({
    db: dbWith(
      soundWorld({
        [`trns/${METER}`]: {
          accessData: {
            trnType: "METER_INSTALLATION",
            access: { hasAccess: "yes" },
          },
          ast: { astData: { astId: METER, astNo: METER_NO } },
        },
      }),
    ),
    astId: METER,
  });

  assert.equal(discovered.ok, true, "a discovered meter must not be refused");
  assert.equal(installed.ok, true, "an installed meter must not be refused");
});

test("a meter that does not name its own registration is refused", async () => {
  const world = soundWorld({
    [`asts/${METER}`]: {
      ast: { astData: { astId: "TRN_MDIS_SOMETHING_ELSE", astNo: METER_NO } },
      accessData: { premise: { id: PREMISE } },
      status: { state: "CONNECTED" },
    },
  });

  const outcome = await checkMeterRegistration({ db: dbWith(world), astId: METER });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "REGISTRATION_METER_MISMATCH");
});

test("a meter whose number differs from the one captured is refused", async () => {
  const world = soundWorld({
    [`trns/${METER}`]: {
      accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "yes" } },
      ast: { astData: { astNo: "99999999999" } },
    },
  });

  const outcome = await checkMeterRegistration({ db: dbWith(world), astId: METER });

  assert.equal(outcome.ok, false, "the meter that was made is not the meter that was captured");
  assert.equal(outcome.code, "REGISTRATION_METER_MISMATCH");
});

test("a meter against a visit that never got in is refused", async () => {
  const world = soundWorld({
    [`trns/${METER}`]: {
      accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "no" } },
      ast: { astData: { astNo: METER_NO } },
    },
  });

  const outcome = await checkMeterRegistration({ db: dbWith(world), astId: METER });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "REGISTRATION_WITHOUT_ACCESS");
});

test("a meter number meter master holds against another meter is refused", async () => {
  const world = soundWorld({
    [`meter_master/${METER_NO}`]: { refs: { asts: { id: "TRN_MDIS_OTHER" } } },
  });

  const outcome = await checkMeterRegistration({ db: dbWith(world), astId: METER });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "METER_MASTER_MISMATCH");
});

test("a premise that does not list the meter is refused", async () => {
  const world = soundWorld({
    [`premises/${PREMISE}`]: { services: { electricityMeters: [] } },
  });

  const outcome = await checkMeterRegistration({ db: dbWith(world), astId: METER });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "PREMISE_DOES_NOT_LIST_METER");
});

test("the premise holds its meters under trnId, which is the meter's id", () => {
  assert.equal(
    premiseHoldsMeter(
      { services: { waterMeters: [{ trnId: METER }] } },
      METER,
    ),
    true,
  );
  assert.equal(premiseHoldsMeter({ services: {} }, METER), false);
});

test("a meter number is read with spaces out and in capitals", () => {
  assert.equal(normalizeMeterNo(" 071 426 61946 "), "07142661946");
  assert.equal(normalizeMeterNo("abc123"), "ABC123");
  assert.equal(normalizeMeterNo("07-142"), "");
  assert.equal(normalizeMeterNo(""), "");
});

test("a disconnection that was done counts on the meter", () => {
  const patch = buildMeterCountPatch({
    trnType: "METER_DISCONNECTION",
    outcome: "SUCCESS",
  });

  assert.deepEqual(Object.keys(patch), ["counts.disconnections"]);
});

test("a reconnection that was done counts on the meter", () => {
  const patch = buildMeterCountPatch({
    trnType: "METER_RECONNECTION",
    outcome: "SUCCESS",
  });

  assert.deepEqual(Object.keys(patch), ["counts.reconnections"]);
});

// This test used to assert the opposite, and it is the reason the break it now
// guards against would have shipped. The No Access count was raised here, in
// the lifecycle callable. Main then moved every No Access to its own writer,
// returning before this code is reached — so the count became unreachable while
// this test, which calls the helper directly and never the writer, stayed green.
// The Meter Registry would have shown 0 No Access beside a window listing the
// visits: a number disagreeing with the table it opens.
//
// So the helper must now refuse to count a No Access, and the count lives in
// `recordLifecycleNoAccess`, beside the record and the premise's link.
test("the lifecycle counter does not count a No Access — its one writer does", () => {
  for (const trnType of [
    "METER_DISCONNECTION",
    "METER_RECONNECTION",
    "METER_INSPECTION",
    "METER_READING",
    "METER_REMOVAL",
  ]) {
    assert.deepEqual(
      buildMeterCountPatch({ trnType, outcome: "NO_ACCESS" }),
      {},
      `${trnType} must not raise a count here; recordLifecycleNoAccess owns it`,
    );
  }
});

test("the one No Access writer raises the meter's count, once", async () => {
  const source = await readFile(
    new URL("../noAccess/recordLifecycleNoAccess.js", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /"counts\.noAccess":\s*FieldValue\.increment\(1\)/,
    "recordLifecycleNoAccess must raise counts.noAccess — if this moved, the Meter Registry's number goes stale",
  );
  assert.match(
    source,
    /alreadyRecorded/,
    "the increment must be guarded so a repeat delivery of the same visit cannot count twice",
  );
  assert.ok(
    source.indexOf("alreadyRecorded") < source.indexOf('"counts.noAccess"'),
    "the guard must be decided before the count is built",
  );
});

// Until 9 October 2026 an inspection and a reading raised no count, because
// the meter held only three numbers. The owner then asked for a count per
// transaction type, so each of the five now raises its own.
test("every kind of work that was done raises its own count", () => {
  const expected = {
    METER_DISCONNECTION: "disconnections",
    METER_RECONNECTION: "reconnections",
    METER_INSPECTION: "inspections",
    METER_REMOVAL: "removals",
  };

  for (const [trnType, key] of Object.entries(expected)) {
    const patch = buildMeterCountPatch({ trnType, outcome: "SUCCESS" });

    assert.deepEqual(Object.keys(patch), [`counts.${key}`], `${trnType} must raise counts.${key}`);
  }
});

test("a reading that was taken raises the reading count, though it never says SUCCESS", () => {
  // THE TRAP THIS PINS. A Meter Reading writes SUCCESSFUL_READING, not
  // SUCCESS. A count guarded on the literal SUCCESS therefore never moves, and
  // nothing says so: the reading is recorded, the register shows nothing, and
  // the number looks exactly like a meter nobody has ever read.
  assert.deepEqual(
    Object.keys(
      buildMeterCountPatch({ trnType: "METER_READING", outcome: "SUCCESSFUL_READING" }),
    ),
    ["counts.readings"],
  );
});

test("work that was not done raises nothing", () => {
  for (const outcome of ["NO_ACCESS", "UNSUCCESSFUL_READING", "", undefined]) {
    assert.deepEqual(
      buildMeterCountPatch({ trnType: "METER_DISCONNECTION", outcome }),
      {},
      `a disconnection with outcome ${JSON.stringify(outcome)} did not disconnect the meter`,
    );
  }

  assert.deepEqual(
    buildMeterCountPatch({ trnType: "METER_READING", outcome: "UNSUCCESSFUL_READING" }),
    {},
    "a reading that could not be taken is not a reading",
  );
});

test("a kind of work the meter does not count raises nothing", () => {
  // A registration is the meter's own origin and is always exactly one; a
  // commissioning is not issued from the ITO button. Neither is counted.
  for (const trnType of ["METER_DISCOVERY", "METER_INSTALLATION", "METER_COMMISSIONING"]) {
    assert.deepEqual(buildMeterCountPatch({ trnType, outcome: "SUCCESS" }), {});
  }
});
