// The ITO launch button: which transaction is offered when, and what a count
// says when the meter does not carry one. `DR-R001` 3.2, owner 9 October 2026.
//
// The availability rules are not new inventions — four of the five are read
// out of the code that already enforces them on the phone and on the server,
// so these tests are also a record of what those rules were on the day the
// button was built. If one of them changes, this should change with it rather
// than the two drifting apart silently.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ITO_COLUMN_LABEL,
  ITO_TRANSACTIONS,
  readItoCount,
} from "../src/components/ito/itoTransactions.js";

const byWork = Object.fromEntries(ITO_TRANSACTIONS.map((t) => [t.work, t]));
const STATES = ["FIELD", "CONNECTED", "DISCONNECTED", "REMOVED", "DECOMMISSIONED"];

test("the column is called what the thing is called", () => {
  // Owner, 9 October 2026. It was "Launch a transaction", which described what
  // the buttons do instead of naming the thing. One thing, one word: a screen
  // that calls it something of its own is how two names for one thing begin.
  assert.equal(ITO_COLUMN_LABEL, "Individual Transaction Origination");
});

test("the button offers the five transactions the office can originate", () => {
  assert.deepEqual(
    ITO_TRANSACTIONS.map((t) => t.code),
    ["DCN", "RCN", "INSP", "REM", "MREAD"],
  );

  // One word for the thing, everywhere (owner, 9 October 2026): DCN and RCN,
  // never DISC and RECON.
  assert.ok(!ITO_TRANSACTIONS.some((t) => ["DISC", "RECON"].includes(t.code)));
});

test("each transaction raises its own count, and no two share one", () => {
  const keys = ITO_TRANSACTIONS.map((t) => t.countKey);

  assert.deepEqual(keys, [
    "disconnections",
    "reconnections",
    "inspections",
    "removals",
    "readings",
  ]);
  assert.equal(new Set(keys).size, keys.length);
});

test("a disconnection is offered on a connected meter and nowhere else", () => {
  for (const state of STATES) {
    assert.equal(
      byWork.disconnect.available(state),
      state === "CONNECTED",
      `disconnect on a ${state} meter`,
    );
  }
});

test("a reconnection is offered on a disconnected meter and nowhere else", () => {
  for (const state of STATES) {
    assert.equal(
      byWork.reconnect.available(state),
      state === "DISCONNECTED",
      `reconnect on a ${state} meter`,
    );
  }
});

test("an inspection is offered on any meter, in any state", () => {
  // The owner's decision, and the reason matters: an inspection is the only
  // way a stale record gets corrected (DR-R001 6.2). A meter it could not be
  // run on would be the one meter nobody could ever put right — and a
  // decommissioned meter is exactly the record worth testing.
  for (const state of [...STATES, "NAv", "", "SOMETHING_NEW"]) {
    assert.equal(byWork.inspect.available(state), true, `inspect on a ${state} meter`);
  }
});

test("a removal is not offered on a meter already removed or decommissioned", () => {
  assert.equal(byWork.remove.available("FIELD"), true);
  assert.equal(byWork.remove.available("CONNECTED"), true);
  assert.equal(byWork.remove.available("DISCONNECTED"), true);
  assert.equal(byWork.remove.available("REMOVED"), false);
  assert.equal(byWork.remove.available("DECOMMISSIONED"), false);
});

test("a reading is offered on anything but a decommissioned meter", () => {
  for (const state of STATES) {
    assert.equal(
      byWork.read.available(state),
      state !== "DECOMMISSIONED",
      `read on a ${state} meter`,
    );
  }
});

test("a refused button says why, in words the office can act on", () => {
  assert.equal(byWork.disconnect.refusal("DISCONNECTED"), "This meter is already disconnected");
  assert.equal(byWork.reconnect.refusal("CONNECTED"), "This meter is already connected");
  assert.equal(byWork.remove.refusal("REMOVED"), "This meter has already been removed");
  assert.equal(byWork.read.refusal("DECOMMISSIONED"), "A decommissioned meter cannot be read");

  for (const transaction of ITO_TRANSACTIONS) {
    if (transaction.work === "inspect") continue;

    assert.ok(
      transaction.refusal("DECOMMISSIONED").length > 0,
      `${transaction.code} must say why it is refused, never go quiet`,
    );
  }
});

test("a count the meter does not carry is NAv, not zero", () => {
  // ABSENT AND ZERO ARE DIFFERENT FACTS. Zero says this never happened to this
  // meter; absent says iREPS does not know. An environment the backfill has
  // not reached holds neither, and a 0 drawn there would be a plausible number
  // covering a gap.
  assert.equal(readItoCount({ counts: { disconnections: 0 } }, "disconnections"), 0);
  assert.equal(readItoCount({ counts: {} }, "disconnections"), null);
  assert.equal(readItoCount({}, "disconnections"), null);
  assert.equal(readItoCount(undefined, "disconnections"), null);
  assert.equal(readItoCount({ counts: { disconnections: "2" } }, "disconnections"), null);
  assert.equal(readItoCount({ counts: { disconnections: Number.NaN } }, "disconnections"), null);
});

test("a count that is held is read as a whole, non-negative number", () => {
  assert.equal(readItoCount({ counts: { readings: 12 } }, "readings"), 12);
  assert.equal(readItoCount({ counts: { readings: 3.7 } }, "readings"), 3);
  assert.equal(readItoCount({ counts: { readings: -4 } }, "readings"), 0);
});
