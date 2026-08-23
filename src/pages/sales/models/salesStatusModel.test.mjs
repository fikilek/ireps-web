import assert from "node:assert/strict";
import test from "node:test";

import {
  SALES_OPERATIONAL_STATUSES,
  SALES_STATUSES,
  SALES_STATUS_FILTER_OPTIONS,
  SALES_STATUS_LABELS,
  classifySalesStatus,
  getSalesStatusLabel,
  getSalesStatusSortRank,
} from "./salesStatusModel.js";

function row({ tbRefs = [], tbRefsIntegrity = { valid: true, issues: [] } } = {}) {
  return { tbRefs, tbRefsIntegrity };
}

function ref(status, { omitFieldWork = false, omitStatus = false } = {}) {
  if (omitFieldWork) return { id: "TGB_1" };
  return {
    id: `TGB_${status || "NONE"}`,
    fieldWork: omitStatus ? {} : { status },
  };
}

test("canonical Sales Status vocabulary is stable", () => {
  assert.deepEqual(SALES_OPERATIONAL_STATUSES, [
    SALES_STATUSES.NOT_STARTED,
    SALES_STATUSES.IN_PROGRESS,
    SALES_STATUSES.COMPLETED,
  ]);
  assert.deepEqual(
    SALES_STATUS_FILTER_OPTIONS.map((option) => option.value),
    [
      SALES_STATUSES.NOT_STARTED,
      SALES_STATUSES.IN_PROGRESS,
      SALES_STATUSES.COMPLETED,
      SALES_STATUSES.INTEGRITY_EXCEPTION,
    ],
  );
});

test("no Targeted Batch references is NOT_STARTED", () => {
  assert.deepEqual(classifySalesStatus(row()), {
    status: SALES_STATUSES.NOT_STARTED,
    issues: [],
  });
});

test("Targeted Batch membership without fieldWork remains NOT_STARTED", () => {
  assert.equal(
    classifySalesStatus(row({ tbRefs: [ref(null, { omitFieldWork: true })] })).status,
    SALES_STATUSES.NOT_STARTED,
  );
});

test("missing fieldWork.status remains NOT_STARTED", () => {
  assert.equal(
    classifySalesStatus(row({ tbRefs: [ref(null, { omitStatus: true })] })).status,
    SALES_STATUSES.NOT_STARTED,
  );
});

test("explicit NOT_STARTED remains NOT_STARTED", () => {
  assert.equal(
    classifySalesStatus(row({ tbRefs: [ref("NOT_STARTED")] })).status,
    SALES_STATUSES.NOT_STARTED,
  );
});

test("IN_PROGRESS fieldwork is IN_PROGRESS", () => {
  assert.equal(
    classifySalesStatus(row({ tbRefs: [ref("IN_PROGRESS")] })).status,
    SALES_STATUSES.IN_PROGRESS,
  );
});

test("COMPLETED fieldwork is COMPLETED", () => {
  assert.equal(
    classifySalesStatus(row({ tbRefs: [ref("COMPLETED")] })).status,
    SALES_STATUSES.COMPLETED,
  );
});

test("IN_PROGRESS outranks NOT_STARTED across references", () => {
  assert.equal(
    classifySalesStatus(
      row({ tbRefs: [ref("NOT_STARTED"), ref("IN_PROGRESS")] }),
    ).status,
    SALES_STATUSES.IN_PROGRESS,
  );
});

test("COMPLETED outranks NOT_STARTED across references", () => {
  assert.equal(
    classifySalesStatus(
      row({ tbRefs: [ref("NOT_STARTED"), ref("COMPLETED")] }),
    ).status,
    SALES_STATUSES.COMPLETED,
  );
});

test("COMPLETED outranks IN_PROGRESS across references", () => {
  assert.equal(
    classifySalesStatus(
      row({ tbRefs: [ref("IN_PROGRESS"), ref("COMPLETED")] }),
    ).status,
    SALES_STATUSES.COMPLETED,
  );
});

test("multiple NOT_STARTED references remain NOT_STARTED", () => {
  assert.equal(
    classifySalesStatus(
      row({ tbRefs: [ref("NOT_STARTED"), ref("NOT_STARTED")] }),
    ).status,
    SALES_STATUSES.NOT_STARTED,
  );
});

test("invalid tbRefs integrity fails closed", () => {
  assert.deepEqual(
    classifySalesStatus(
      row({ tbRefsIntegrity: { valid: false, issues: ["tbRefs.0.id"] } }),
    ),
    {
      status: SALES_STATUSES.INTEGRITY_EXCEPTION,
      issues: ["tbRefs.0.id"],
    },
  );
});

test("unknown fieldwork status fails closed", () => {
  assert.equal(
    classifySalesStatus(row({ tbRefs: [ref("UNKNOWN")] })).status,
    SALES_STATUSES.INTEGRITY_EXCEPTION,
  );
});

test("non-canonical present fieldwork status fails closed", () => {
  assert.equal(
    classifySalesStatus(row({ tbRefs: [ref("in_progress")] })).status,
    SALES_STATUSES.INTEGRITY_EXCEPTION,
  );
});

test("malformed normalized tbRefs fail closed even when integrity flag is inconsistent", () => {
  assert.equal(
    classifySalesStatus({
      tbRefs: null,
      tbRefsIntegrity: { valid: true, issues: [] },
    }).status,
    SALES_STATUSES.INTEGRITY_EXCEPTION,
  );
});

test("labels use canonical wording", () => {
  assert.equal(SALES_STATUS_LABELS[SALES_STATUSES.NOT_STARTED], "Not Started");
  assert.equal(getSalesStatusLabel(SALES_STATUSES.IN_PROGRESS), "In Progress");
  assert.equal(getSalesStatusLabel(SALES_STATUSES.COMPLETED), "Completed");
  assert.equal(
    getSalesStatusLabel(SALES_STATUSES.INTEGRITY_EXCEPTION),
    "Integrity Exception",
  );
});

test("sort rank follows lifecycle order", () => {
  assert.ok(
    getSalesStatusSortRank(SALES_STATUSES.NOT_STARTED) <
      getSalesStatusSortRank(SALES_STATUSES.IN_PROGRESS),
  );
  assert.ok(
    getSalesStatusSortRank(SALES_STATUSES.IN_PROGRESS) <
      getSalesStatusSortRank(SALES_STATUSES.COMPLETED),
  );
  assert.ok(
    getSalesStatusSortRank(SALES_STATUSES.COMPLETED) <
      getSalesStatusSortRank(SALES_STATUSES.INTEGRITY_EXCEPTION),
  );
});
