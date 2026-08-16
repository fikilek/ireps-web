import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TARGETED_BATCH_DERIVED_STATES as FUNCTIONS_DERIVED_STATES,
  TARGETED_BATCH_ROW_STATUSES as FUNCTIONS_ROW_STATUSES,
  deriveTargetedBatchState as deriveFunctionsTargetedBatchState,
} from "../targetedBatches/lifecycle.js";
import {
  TARGETED_BATCH_DERIVED_STATES as WEB_DERIVED_STATES,
  TARGETED_BATCH_ROW_STATUSES as WEB_ROW_STATUSES,
  deriveTargetedBatchState as deriveWebTargetedBatchState,
} from "../../src/pages/operations/targeted-batches/targetedBatchLifecycle.js";

const fixtureUrl = new URL(
  "./fixtures/targetedBatchLifecycle.conformance.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

function diagnosticCodes(result) {
  return result.diagnostics.map(({ code }) => code);
}

test("Functions and Web expose the same Targeted Batch lifecycle constants", () => {
  assert.deepEqual(FUNCTIONS_ROW_STATUSES, WEB_ROW_STATUSES);
  assert.deepEqual(FUNCTIONS_DERIVED_STATES, WEB_DERIVED_STATES);
  assert.deepEqual(
    Object.values(FUNCTIONS_ROW_STATUSES),
    fixture.contract.canonicalRowStatuses,
  );
  assert.equal(
    FUNCTIONS_DERIVED_STATES.inconsistent,
    fixture.contract.derivedOnlyStatus,
  );
});

for (const fixtureCase of fixture.cases) {
  test(`Functions/Web parity: ${fixtureCase.name}`, () => {
    const functionsResult = deriveFunctionsTargetedBatchState(fixtureCase.input);
    const webResult = deriveWebTargetedBatchState(fixtureCase.input);

    assert.deepEqual(webResult, functionsResult);
    assert.equal(functionsResult.status, fixtureCase.expected.status);
    assert.equal(
      functionsResult.completeRowSet,
      fixtureCase.expected.completeRowSet,
    );
    assert.deepEqual(
      diagnosticCodes(functionsResult),
      fixtureCase.expected.diagnosticCodes,
    );
  });
}
