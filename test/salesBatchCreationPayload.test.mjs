import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildNonGpsBatchPlanningModel, buildNgpTargetedBatchDraftPlan } from "../src/pages/sales/models/nonGpsBatchPlanningModel.js";
import { buildTargetedBatchDraft } from "../src/redux/targetedBatchDraftModel.js";

const golden = JSON.parse(await readFile(new URL("./fixtures/salesBatchCreationGolden.json", import.meta.url), "utf8"));

test("Non-GPS model, selected identities and complete frontend draft remain equal to pre-change golden", () => {
  const model = buildNonGpsBatchPlanningModel(golden.rows);
  assert.deepEqual(model, golden.model);
  const plan = buildNgpTargetedBatchDraftPlan({ targets: model.noGpsTargets, tbId: "TGB_20260906_045500_AB12", lmPcode: "ZA5241", lmName: "Endumeni" });
  assert.deepEqual(plan, golden.plan);
});

test("actual frontend callable payload construction is byte-identical to baseline and wraps the same draft", async () => {
  const path = "src/pages/operations/TargetedBatchDraftPage.jsx";
  const after = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [sourcePath, hash] of Object.entries(golden.sourceHashes)) {
    const bytes = await readFile(new URL(`../${sourcePath}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, sourcePath);
  }
  const payloadExpression = after.match(/await createTargetedBatch\((\{ draft \})\)/)?.[1];
  assert.equal(payloadExpression, "{ draft }");
  const createdAt = "2026-09-06T04:55:26.000Z";
    const expected = buildTargetedBatchDraft({ ...golden.plan.draft, createdAt });
    const model = buildNonGpsBatchPlanningModel(golden.rows);
    const actual = buildTargetedBatchDraft({ ...buildNgpTargetedBatchDraftPlan({ targets: model.noGpsTargets, tbId: "TGB_20260906_045500_AB12", lmPcode: "ZA5241", lmName: "Endumeni" }).draft, createdAt });
    assert.deepEqual({ draft: actual }, { draft: expected });
});
