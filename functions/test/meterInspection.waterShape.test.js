// MN-R001 §10 and §12: water keeps its own behaviour, but a water inspection's
// normalisation is stored in the same shape as electricity's — a list — so
// every reader can treat them alike.
import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeInspection } from "../meterLifecycle/helpers.js";

function waterInspection(normalisation) {
  return sanitizeInspection(
    { captured: { ast: { astData: { meter: { type: "prepaid" } }, normalisation } } },
    { meterType: "water" },
  );
}

const savedActions = (normalisation) => {
  const saved = waterInspection(normalisation)?.captured?.ast?.normalisation;
  assert.ok(Array.isArray(saved?.actionTaken), JSON.stringify(saved));
  return saved.actionTaken;
};

// MN-R001 1.9.0: water stores the words as written, exactly as electricity does. Before
// this, the whole list was upper-cased and the default was NONE, so the same meaning was
// stored as NONE for water and None for electricity - one filter could not match both.
test("a water inspection records its normalisation as a list, in the words themselves", () => {
  assert.deepEqual(savedActions({ actionTaken: ["None"] }), ["None"]);
  assert.deepEqual(savedActions({ actionTaken: "None" }), ["None"]);

  // Nothing recorded at all still says None, not a third spelling of it.
  assert.deepEqual(savedActions(undefined), ["None"]);
  assert.deepEqual(savedActions({}), ["None"]);

  // The words are no longer rewritten on the way in, so a value is stored as it arrives.
  assert.deepEqual(savedActions({ actionTaken: ["Tamper removed"] }), ["Tamper removed"]);
});

// A KNOWN GAP, recorded rather than hidden: an upper-case NONE arriving here is stored as
// it arrives. Electricity refuses it (OUTDATED_APP_NORMALISATION in meterDiscovery/
// validation.js), but water is not checked against the action list at all - MN-R001 §10
// parks water until it gets its own rules. Nothing in the databases holds this today
// (measured 25 September 2026, all three: zero upper-case values). Closing it means
// giving water its own validation, which is a decision, not a tidy-up.
test("water does not silently correct an outdated spelling - it is not checked at all yet", () => {
  assert.deepEqual(savedActions({ actionTaken: "NONE" }), ["NONE"]);
});
