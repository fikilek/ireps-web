import test from "node:test";
import assert from "node:assert/strict";
import { planFieldCommentBackfill, assertFieldCommentBackfillProject } from "../maintenance/fieldCommentBackfillPlan.js";

const discovery = { accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "yes" } } };
test("only absent Discovery comment fields are backfilled; existing words and media survive", () => {
  const media = [{ tag: "fieldCommentPhoto", url: "https://example.test/photo.jpg" }];
  const source = { ...discovery, media };
  const original = structuredClone(source);
  assert.deepEqual(planFieldCommentBackfill(source), { status: "UPDATE", patch: { fieldComment: { text: "NAv" } } });
  assert.deepEqual(source, original);
  assert.deepEqual(planFieldCommentBackfill({ ...source, fieldComment: { extra: "preserve" } }).patch, { "fieldComment.text": "NAv" });
  for (const text of ["", "  ", "NAv", "First line\nSecond line", null, 0]) {
    assert.equal(planFieldCommentBackfill({ ...source, fieldComment: { text } }).status, "UNCHANGED");
  }
  assert.equal(planFieldCommentBackfill({ ...source, fieldComment: { text: "NAv" } }).status, "UNCHANGED", "rerun is idempotent");
});
test("No Access, other forms, unknown access and malformed existing maps are not rewritten", () => {
  for (const data of [{}, { accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "no" } } }, { accessData: { trnType: "METER_DISCOVERY" } }, { accessData: { trnType: "METER_READING", access: { hasAccess: "yes" } } }]) {
    assert.deepEqual(planFieldCommentBackfill(data), { status: "OUT_OF_SCOPE", patch: {} });
  }
  for (const fieldComment of [null, "existing legacy words", [], false]) {
    const plan = planFieldCommentBackfill({ ...discovery, fieldComment });
    assert.equal(plan.status, "HOLD");
    assert.deepEqual(plan.patch, {});
  }
});
test("migration allows matching approved environments and refuses cross-project or unknown credentials", () => {
  const projects = ["ireps2", "ireps-test", "ireps-5c3e9"];
  for (const project of projects) {
    assert.equal(assertFieldCommentBackfillProject(project, project), project);
    for (const credentialProject of projects.filter(value => value !== project)) {
      assert.throws(() => assertFieldCommentBackfillProject(project, credentialProject));
    }
  }
  assert.throws(() => assertFieldCommentBackfillProject("other-project", "other-project"));
});
