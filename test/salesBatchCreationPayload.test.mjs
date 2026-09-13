import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildNonGpsBatchPlanningModel, buildNgpTargetedBatchDraftPlan } from "../src/pages/sales/models/nonGpsBatchPlanningModel.js";
import { buildTargetedBatchDraft } from "../src/redux/targetedBatchDraftModel.js";
import { salesDraftIntent } from "../src/pages/operations/targeted-batches/draft/sales-batch-draft-model.js";
const golden = JSON.parse(await readFile(new URL("./fixtures/salesBatchCreationGolden.json", import.meta.url), "utf8"));
const tbId = "TGB_20260906_045500_AB12";
function draft() {
  const model = buildNonGpsBatchPlanningModel(golden.rows);
  const plan = buildNgpTargetedBatchDraftPlan({ targets: model.noGpsTargets, tbId, lmPcode: "ZA5241", lmName: "Endumeni" });
  assert.equal(plan.ok, true);
  return buildTargetedBatchDraft({ ...plan.draft, scopeKey: "FIXTURE_SCOPE" });
}
test("canonical NGP selection becomes one retained proposal with unchanged meter identities", () => {
  const value = draft();
  assert.deepEqual(value.retainedIds, ["07100000001", "07100000002"]);
  assert.equal(value.proposedBatches.length, 1);
  assert.equal(value.source.type, "PREPAID_SALES_NON_GPS");
  assert.equal(value.selection.planningMode, "ERF_GEOFENCE");
  assert.equal(value.savedFence, null); assert.equal(value.confirmation, null);
});
test("callable intent carries retained identities and signed evidence, without client commercial or eligibility authority", () => {
  const value = draft(); value.selection.reason = "Fixture selection";
  value.resolutions = { "07100000001": { proof: "MOCK_SIGNED_PROOF", erfId: "UNTRUSTED", ready: true } };
  const input = salesDraftIntent(value);
  assert.deepEqual(Object.keys(input).sort(), ["tbId", "lmPcode", "source", "geofenceId", "salesIds", "reason", "salesPeriodFrom", "salesPeriodTo", "resolutionProofs"].sort());
  assert.deepEqual(input.salesIds, value.retainedIds);
  assert.equal(input.resolutionProofs["07100000001"], "MOCK_SIGNED_PROOF");
  assert.equal(Object.hasOwn(input, "draft"), false);
  assert.equal(Object.hasOwn(input, "monthlySalesC"), false);
});
