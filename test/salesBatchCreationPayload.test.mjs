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

// Rules TB-R046 (targeted-batch rules 1.3.28): only CAT meters are batched. The category is the one
// Mpilo supplies for the LM's newest category month; iREPS never calculates it. Nothing pinned this at
// the draft level, so when the rule arrived it broke the two tests above instead of failing a test of
// its own. These do that job: the same canonical selection, refused for the category alone.
const clone = () => JSON.parse(JSON.stringify(golden.rows));
function plan(rows) {
  const model = buildNonGpsBatchPlanningModel(rows);
  return { model, result: buildNgpTargetedBatchDraftPlan({ targets: model.noGpsTargets, tbId, lmPcode: "ZA5241", lmName: "Endumeni" }) };
}
// The second row keeps its CAT category in every case below, so the LM's newest category month stays
// 2026-07 and each refusal is the first row's own category, never a missing category month.
test("a Sales meter with no category is refused, and its selection cannot be drafted", () => {
  const rows = clone();
  delete rows[0].monthlyCategories;
  const { model, result } = plan(rows);
  assert.equal(model.categoryMonth, "2026-07");
  const [uncategorised, cat] = model.noGpsTargets;
  assert.equal(uncategorised.category, "NONE");
  assert.equal(uncategorised.batchable, false);
  assert.equal(uncategorised.selectable, false);
  assert.equal(uncategorised.batchabilityCode, "SALES_CATEGORY_NONE");
  assert.match(uncategorised.batchabilityReason, /No category for 2026-07/);
  // The refusal is the category and nothing else: the CAT meter beside it is still batchable.
  assert.equal(cat.category, "CAT");
  assert.equal(cat.batchable, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, "NGP_SELECTION_NOT_BATCHABLE");
});
test("a Normal meter, and a CAT category in an older month, are both refused", () => {
  const normal = clone();
  normal[0].monthlyCategories["2026-07"].leakageCategory = "Normal - No Leakage Flag";
  const refusedNormal = plan(normal);
  assert.equal(refusedNormal.model.noGpsTargets[0].category, "NORMAL");
  assert.equal(refusedNormal.model.noGpsTargets[0].batchabilityCode, "SALES_CATEGORY_NORMAL");
  assert.equal(refusedNormal.result.ok, false);
  assert.equal(refusedNormal.result.code, "NGP_SELECTION_NOT_BATCHABLE");
  // TB-R046: a meter missing from the LM's newest category month has no category for batching,
  // even where an older month gives it one.
  const stale = clone();
  stale[0].monthlyCategories = { "2026-06": stale[0].monthlyCategories["2026-07"] };
  const refusedStale = plan(stale);
  assert.equal(refusedStale.model.categoryMonth, "2026-07");
  assert.equal(refusedStale.model.noGpsTargets[0].category, "NONE");
  assert.equal(refusedStale.model.noGpsTargets[0].batchabilityCode, "SALES_CATEGORY_NONE");
  assert.equal(refusedStale.result.ok, false);
  assert.equal(refusedStale.result.code, "NGP_SELECTION_NOT_BATCHABLE");
});
