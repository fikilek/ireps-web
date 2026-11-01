import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AST_VISIBILITY_OUTCOMES,
  METER_VISIBILITY_SYSTEM_ACTOR,
  SALES_LINK_SKIP_REASONS,
  applySalesLink,
  deriveMeterVisibility,
  planAstVisibilitySync,
  planBlankSalesLink,
} from "../meterVisibility/helpers.js";
import {
  buildBackEndSalesLinkFields,
  buildBackEndSalesLinkUpdate,
  buildCanonicalFieldOnlyMeterMaster,
  describeMeterNumberProblem,
  normalizeMeterNo,
} from "../meterMaster/helpers.js";

const timestamp = (seconds) => ({ seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) });
const master = (asts = "", sales = "", provider = "") => ({
  lmPcode: "ZA5241",
  meterType: "electricity",
  refs: { asts: { id: asts }, sales: { id: sales, provider } },
});

test("MV-R001: Visible only when both links are present", () => {
  assert.equal(deriveMeterVisibility(master("AST-1", "04297698195", "contour")), "VISIBLE");
  assert.equal(deriveMeterVisibility(master("AST-1", "")), "INVISIBLE");
  assert.equal(deriveMeterVisibility(master("", "04297698195", "contour")), "INVISIBLE");
  assert.equal(deriveMeterVisibility(master("  ", " ")), "INVISIBLE");
  assert.equal(deriveMeterVisibility(null), "INVISIBLE");
});

test("blank Sales link is filled with the meter's own number and the Sales provider", () => {
  const plan = planBlankSalesLink({
    masterId: "04297698195",
    master: master("AST-1"),
    salesExists: true,
    salesData: { provider: "contour", lmPcode: "ZA5241" },
    masterLmPcode: "ZA5241",
    masterMeterType: "electricity",
  });
  assert.deepEqual(plan, { link: { id: "04297698195", provider: "contour" }, reason: null });
});

test("a new meter master with no existing record also gets the link", () => {
  const plan = planBlankSalesLink({
    masterId: "04297698195",
    master: null,
    salesExists: true,
    salesData: { provider: "Contour", lmPcode: "za5241" },
    masterLmPcode: "ZA5241",
    masterMeterType: "electricity",
  });
  assert.deepEqual(plan.link, { id: "04297698195", provider: "contour" });
});

const skipCases = [
  ["no Sales record", { salesExists: false }, SALES_LINK_SKIP_REASONS.NO_SALES_RECORD],
  ["link already set to this meter", { master: master("AST-1", "04297698195", "contour") }, SALES_LINK_SKIP_REASONS.LINK_ALREADY_SET],
  ["link set to another meter", { master: master("AST-1", "OTHER", "contour") }, SALES_LINK_SKIP_REASONS.LINK_SET_TO_OTHER_METER],
  ["Sales provider missing", { salesData: { provider: " ", lmPcode: "ZA5241" } }, SALES_LINK_SKIP_REASONS.SALES_PROVIDER_MISSING],
  ["Sales provider not governed", { salesData: { provider: "acme", lmPcode: "ZA5241" } }, SALES_LINK_SKIP_REASONS.SALES_PROVIDER_NOT_GOVERNED],
  ["Sales record without an LM", { salesData: { provider: "contour" } }, SALES_LINK_SKIP_REASONS.SALES_LM_MISSING],
  ["different LM", { salesData: { provider: "contour", lmPcode: "ZA9999" } }, SALES_LINK_SKIP_REASONS.LM_MISMATCH],
  ["water meter against an electricity Sales record", { masterMeterType: "water" }, SALES_LINK_SKIP_REASONS.METER_TYPE_MISMATCH],
];

for (const [name, overrides, reason] of skipCases) {
  test(`Sales link is not set: ${name}`, () => {
    const plan = planBlankSalesLink({
      masterId: "04297698195",
      master: master("AST-1"),
      salesExists: true,
      salesData: { provider: "contour", lmPcode: "ZA5241" },
      masterLmPcode: "ZA5241",
      masterMeterType: "electricity",
      ...overrides,
    });
    assert.equal(plan.link, null);
    assert.equal(plan.reason, reason);
  });
}

test("applySalesLink keeps the field link and everything else", () => {
  const before = { ...master("AST-1"), customerNo: "C1" };
  const after = applySalesLink(before, { id: "04297698195", provider: "contour" });
  assert.equal(after.refs.asts.id, "AST-1");
  assert.deepEqual(after.refs.sales, { id: "04297698195", provider: "contour" });
  assert.equal(after.customerNo, "C1");
  assert.equal(before.refs.sales.id, "");
  assert.equal(applySalesLink(before, null), before);
});

test("field record copy: updated with system actor, keeping the ISO text time type", () => {
  const plan = planAstVisibilitySync({
    masterId: "04297698195",
    astData: { master: { id: "04297698195", visibility: "INVISIBLE" }, metadata: { updatedAt: "2026-09-01T10:00:00.000Z" } },
    desiredVisibility: "VISIBLE",
    isoNow: "2026-09-17T12:00:00.000Z",
    timestampNow: timestamp(99),
  });
  assert.equal(plan.outcome, AST_VISIBILITY_OUTCOMES.UPDATED);
  assert.deepEqual(plan.patch, {
    "master.visibility": "VISIBLE",
    "metadata.updatedAt": "2026-09-17T12:00:00.000Z",
    "metadata.updatedByUid": METER_VISIBILITY_SYSTEM_ACTOR.uid,
    "metadata.updatedByUser": METER_VISIBILITY_SYSTEM_ACTOR.user,
  });
});

test("field record copy: Firestore Timestamp time stays a Timestamp", () => {
  const now = timestamp(99);
  const plan = planAstVisibilitySync({
    masterId: "M1",
    astData: { master: { id: "M1", visibility: "VISIBLE" }, metadata: { updatedAt: timestamp(1) } },
    desiredVisibility: "INVISIBLE",
    isoNow: "2026-09-17T12:00:00.000Z",
    timestampNow: now,
  });
  assert.equal(plan.patch["metadata.updatedAt"], now);
});

test("field record copy: a record with no update time gets ISO text, as asts.md requires", () => {
  const plan = planAstVisibilitySync({
    masterId: "M1",
    astData: { master: { id: "M1", visibility: "VISIBLE" }, metadata: {} },
    desiredVisibility: "INVISIBLE",
    isoNow: "2026-09-17T12:00:00.000Z",
    timestampNow: timestamp(99),
  });
  assert.equal(plan.patch["metadata.updatedAt"], "2026-09-17T12:00:00.000Z");
});

test("field record copy: unchanged, missing or pointing at another meter writes nothing", () => {
  const base = { masterId: "M1", desiredVisibility: "VISIBLE", isoNow: "x", timestampNow: timestamp(1) };
  assert.deepEqual(
    planAstVisibilitySync({ ...base, astData: { master: { id: "M1", visibility: "VISIBLE" } } }),
    { outcome: AST_VISIBILITY_OUTCOMES.UNCHANGED, patch: null },
  );
  assert.deepEqual(
    planAstVisibilitySync({ ...base, astData: null }),
    { outcome: AST_VISIBILITY_OUTCOMES.AST_MISSING, patch: null },
  );
  assert.deepEqual(
    planAstVisibilitySync({ ...base, astData: { master: { id: "OTHER", visibility: "INVISIBLE" } } }),
    { outcome: AST_VISIBILITY_OUTCOMES.AST_MASTER_MISMATCH, patch: null },
  );
});

test("MV-R001 section 8: one cleaning rule; other characters are refused with a message", () => {
  assert.equal(normalizeMeterNo(" 0429 769 8195 "), "04297698195");
  assert.equal(normalizeMeterNo("ab12cd"), "AB12CD");
  assert.equal(describeMeterNumberProblem(" 0429 769 8195 "), null);
  assert.equal(describeMeterNumberProblem("   "), "Meter number is required.");
  for (const bad of ["0429-769", "0429/769", "0429.769", "0429_769", "straße1", "ıd1", "ſ1"]) {
    assert.throws(() => normalizeMeterNo(bad));
    assert.match(describeMeterNumberProblem(bad), /only contain letters and digits/);
  }
});

test("a new meter master can carry the Sales link when the Sales record exists", () => {
  const doc = buildCanonicalFieldOnlyMeterMaster({
    lmPcode: "za5241",
    meterNoRaw: "0429 769 8195",
    meterType: "Electricity",
    astId: "TRN_MDIS_1",
    actorUid: "U1",
    actorUser: "Worker",
    operationTimestamp: timestamp(5),
    salesLink: { id: "04297698195", provider: "contour" },
  });
  assert.deepEqual(doc.refs, {
    asts: { id: "TRN_MDIS_1" },
    sales: { id: "04297698195", provider: "contour" },
  });
  assert.equal(doc.meterNo.normalized, "04297698195");
  assert.equal(deriveMeterVisibility(doc), "VISIBLE");

  const withoutSales = buildCanonicalFieldOnlyMeterMaster({
    lmPcode: "ZA5241", meterNoRaw: "1", meterType: "water", astId: "A",
    actorUid: "U1", actorUser: "Worker", operationTimestamp: timestamp(5),
  });
  assert.deepEqual(withoutSales.refs.sales, { id: "", provider: "" });
});

test("back-end Sales link fields need both an id and a provider", () => {
  assert.deepEqual(buildBackEndSalesLinkFields({ id: "M1", provider: "contour" }), {
    "refs.sales.id": "M1",
    "refs.sales.provider": "contour",
  });
  assert.throws(() => buildBackEndSalesLinkFields({ id: "M1", provider: "" }));
  const update = buildBackEndSalesLinkUpdate({
    salesLink: { id: "M1", provider: "contour" },
    actorUid: "SYSTEM",
    actorUser: "Meter visibility rule (MV-R001)",
    operationTimestamp: timestamp(7),
  });
  assert.deepEqual(Object.keys(update).sort(), [
    "metadata.updatedAt", "metadata.updatedByUid", "metadata.updatedByUser",
    "refs.sales.id", "refs.sales.provider",
  ]);
});

test("wiring: onSalesAllMetersCreated follows MV-R001", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
  const section = (start, end) => source.slice(source.indexOf(start), end ? source.indexOf(end) : undefined);

  const salesCreated = section("export const onSalesAllMetersCreated", "export const signupFieldWorker");
  assert.match(salesCreated, /onDocumentCreated\(\s*"sales-all-meters\/\{meterId\}"/);
  assert.match(salesCreated, /planBlankSalesLink\(/);
  assert.match(salesCreated, /buildBackEndSalesLinkUpdate\(/);
  assert.match(salesCreated, /syncAstVisibilityFromMaster\(/);
  assert.match(salesCreated, /return \{ outcome: "NO_FIELD_LINK" \}/);
});
