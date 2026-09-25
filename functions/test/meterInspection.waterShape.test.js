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

test("a water inspection records its normalisation as a list", () => {
  for (const normalisation of [
    { actionTaken: ["None"] },
    { actionTaken: "NONE" },
    undefined,
  ]) {
    const saved = waterInspection(normalisation)?.captured?.ast?.normalisation;
    assert.ok(Array.isArray(saved?.actionTaken), JSON.stringify(saved));
    assert.deepEqual(saved.actionTaken, ["NONE"]);
  }
});
