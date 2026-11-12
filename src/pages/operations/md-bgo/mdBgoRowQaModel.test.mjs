import test from "node:test";
import assert from "node:assert/strict";
import { enrichMdBgoRowQa, mdBgoRowQaLinks, mdBgoRowTrnId } from "./mdBgoRowQaModel.js";
import { reportingQaFinal } from "../../../utils/reportingQaFinal.js";
import { MD_BGO_ROW_DEFAULT_VISIBILITY } from "./mdBgoRowsPresentation.js";

const rows = [{ premiseId: "UNIT A", meterId: "AST", refs: { trnId: "TRN/A", meterId: "AST" }, progress: "COMPLETED", metadata: { updatedAt: "2026-11-10T10:00:00Z" }, qaFinalStatus: "QA_PASS" }, { premiseId: "UNIT B", progress: "IN_PROGRESS" }];
const source = { ready: true, premises: { "UNIT A": { qa: { status: "QA_PENDING" } }, "UNIT B": { qa: { status: "QA_FAIL" } } }, trns: { "TRN/A": { workflow: { state: "QA FAIL" }, qa: { state: "PASS", reviewedAt: { seconds: 1794477600 } } } } };

test("each flat points to its own exact premise; meter points to discovery TRN rather than AST", () => {
  const [a, b] = enrichMdBgoRowQa(rows, source);
  assert.equal(a.premiseQaHref, "/registries/premises?premiseId=UNIT%20A");
  assert.equal(b.premiseQaHref, "/registries/premises?premiseId=UNIT%20B");
  assert.equal(a.meterQaHref, "/registries/trns?trnId=TRN%2FA");
  assert.equal(b.meterQaHref, "");
  assert.equal(a.premiseQa, "QA PENDING"); assert.equal(b.premiseQa, "QA FAIL");
  assert.equal(a.meterQa, "QA FAIL"); assert.equal(a.qaFinal, "QA FAIL"); assert.equal(b.qaFinal, "QA NAv");
});

test("canonical TRN workflow overrides stale legacy QA; completed TRN is pending", () => {
  for (const [state, expected] of [["COMPLETED", "QA PENDING"], ["QA PASS", "QA PASS"], ["QA FAIL", "QA FAIL"], ["ISSUED", "QA NAv"]]) {
    const changed = { ...source, trns: { "TRN/A": { workflow: { state }, qa: { state: "PASS" } } } };
    assert.equal(enrichMdBgoRowQa(rows, changed)[0].meterQa, expected);
  }
});

test("loading, failure and missing documents cannot expose stale outcomes or links", () => {
  for (const state of [undefined, { ...source, ready: false }, { ready: true, premises: {}, trns: {} }]) {
    const row = enrichMdBgoRowQa(rows, state)[0];
    assert.equal(row.premiseQa, "QA NAv"); assert.equal(row.meterQa, "QA NAv"); assert.equal(row.qaFinal, "QA NAv");
    assert.equal(row.premiseQaHref, ""); assert.equal(row.meterQaHref, "");
  }
});

test("QA changes recompute final without modifying work progress or requiring row writeback", () => {
  const changed = structuredClone(source);
  changed.premises["UNIT A"].qa.status = "QA_PASS";
  changed.trns["TRN/A"].workflow.state = "QA PASS";
  const row = enrichMdBgoRowQa(rows, changed)[0];
  assert.equal(row.qaFinal, "QA PASS"); assert.equal(row.progress, "COMPLETED");
  changed.trns["TRN/A"].workflow.state = "COMPLETED";
  assert.equal(enrichMdBgoRowQa(rows, changed)[0].qaFinal, "QA NAv");
});

test("links deduplicate and sort identities; fanout never borrows another meter's TRN", () => {
  assert.deepEqual(mdBgoRowQaLinks([...rows, rows[0]]), { premiseIds: ["UNIT A", "UNIT B"], trnIds: ["TRN/A"] });
  assert.equal(mdBgoRowTrnId({ ...rows[0], meterId: "OTHER" }), "OTHER");
  assert.deepEqual(mdBgoRowQaLinks([{ premiseId: "NAv", meterId: "NAv" }]), { premiseIds: [], trnIds: [] });
});

test("last activity accepts Firestore/ISO stamps and never invents a missing date", () => {
  assert.equal(enrichMdBgoRowQa(rows, source)[0].lastActivity, 1794477600000);
  assert.equal(enrichMdBgoRowQa([{}], { ready: true, premises: {}, trns: {} })[0].lastActivity, null);
});

test("all four QA columns default visible", () => {
  for (const key of ["lastActivity", "premiseQa", "meterQa", "qaFinal"]) assert.equal(MD_BGO_ROW_DEFAULT_VISIBILITY[key], true);
});

test("shared final presentation preserves TB stored precedence and completion gate", () => {
  assert.equal(reportingQaFinal({ completed: false, stored: "QA_FAIL" }), "QA NAv");
  assert.equal(reportingQaFinal({ completed: true, premise: "QA PENDING", meter: "QA PENDING", stored: "QA_FAIL" }), "QA FAIL");
  assert.equal(reportingQaFinal({ completed: true, stored: "QA_PENDING" }), "QA NAv");
  assert.equal(reportingQaFinal({ completed: true, premise: "QA PASS", meter: "QA PASS" }), "QA PASS");
});
