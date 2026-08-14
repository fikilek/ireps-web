import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TARGETED_BATCH_DERIVED_STATES,
  TARGETED_BATCH_ROW_STATUSES,
  deriveTargetedBatchState,
} from "./targetedBatchLifecycle.js";

const fixtureUrl = new URL(
  "../../../../functions/test/fixtures/targetedBatchLifecycle.conformance.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

function diagnosticCodes(result) {
  return result.diagnostics.map(({ code }) => code);
}

test("Web Targeted Batch lifecycle constants conform to the shared contract", () => {
  assert.deepEqual(
    Object.values(TARGETED_BATCH_ROW_STATUSES),
    fixture.contract.canonicalRowStatuses,
  );
  assert.equal(
    TARGETED_BATCH_DERIVED_STATES.inconsistent,
    fixture.contract.derivedOnlyStatus,
  );
  assert.equal(
    Object.values(TARGETED_BATCH_ROW_STATUSES).includes(
      TARGETED_BATCH_DERIVED_STATES.inconsistent,
    ),
    false,
  );
});

for (const fixtureCase of fixture.cases) {
  test(`Web conformance: ${fixtureCase.name}`, () => {
    const result = deriveTargetedBatchState(fixtureCase.input);

    assert.equal(result.status, fixtureCase.expected.status);
    assert.equal(result.completeRowSet, fixtureCase.expected.completeRowSet);
    assert.deepEqual(diagnosticCodes(result), fixtureCase.expected.diagnosticCodes);
  });
}
