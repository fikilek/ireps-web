import test from "node:test";
import assert from "node:assert/strict";
import { calculateTbQaStatus, applyPremiseQaTbRowProjection } from "../qa/premiseQaReview.js";
import { reportingQaFinal } from "../../src/utils/reportingQaFinal.js";
import { countRows } from "../targetedBatches/rowFollowsSales.js";
const states = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];
const components = ["QA_PASS", "QA_FAIL", "QA_PENDING", "QA_NAv"];
test("final QA uses current components in every execution state, ignoring stale final and No Access", () => {
  for (const execution of states) for (const p of components) for (const m of components) {
    const expected = p === "QA_FAIL" || m === "QA_FAIL" ? "QA_FAIL" : p === "QA_PASS" && m === "QA_PASS" ? "QA_PASS" : [p,m].every(v => ["QA_PASS","QA_PENDING"].includes(v)) ? "QA_PENDING" : "QA_NAv";
    assert.equal(calculateTbQaStatus(p,m,execution), expected);
    assert.equal(reportingQaFinal({ completed: execution === "COMPLETED", premise: p, meter: m, noAccess: "QA_FAIL", stored: "QA_PASS" }), expected === "QA_PENDING" ? "QA NAv" : expected.replaceAll("_"," "));
    const counts = countRows([{ execution: { status: execution }, qa: { premiseStatus: p, meterStatus: m, tbStatus: "QA_PASS" } }]);
    assert.equal(counts.qaPassRows, expected === "QA_PASS" ? 1 : 0);
    assert.equal(counts.qaFailRows, expected === "QA_FAIL" ? 1 : 0);
  }
});

test("premise review and correction project final QA and parent counters before completion", () => {
  for (const [state, expected] of [["QA_FAIL", "QA_FAIL"], ["QA_PASS", "QA_PASS"], ["QA_PENDING", "QA_PENDING"]]) {
    const updates = [];
    const row = { id: "R", execution: { status: "IN_PROGRESS" }, qa: { premiseStatus: "QA_FAIL", meterStatus: "QA_PASS", tbStatus: "QA_FAIL" } };
    applyPremiseQaTbRowProjection({ update: (ref, data) => updates.push({ ref, data }) }, { canProject: true, rowRef: "row", rowId: "R", row, parentRef: "batch", tbRows: [row] }, state);
    assert.equal(updates[0].data["qa.finalStatus"], expected);
    assert.equal(updates[0].data["execution.status"], undefined);
    assert.equal(updates[1].data["counts.qaFailRows"], expected === "QA_FAIL" ? 1 : 0);
    assert.equal(updates[1].data["counts.qaPassRows"], expected === "QA_PASS" ? 1 : 0);
    assert.ok(updates[0].data["metadata.updatedAt"]);
  }
});
