import assert from "node:assert/strict";
import test from "node:test";

import { inspectSalesTbRefsIntegrity } from "./salesTbRefsIntegrityModel.js";

const timestamp = (seconds) => ({ seconds, nanoseconds: 0 });

const frozenAggregateFixtures = [
  { name: "undefined", value: undefined, expected: { valid: true, issues: [] } },
  { name: "null", value: null, expected: { valid: true, issues: [] } },
  {
    name: "non-array",
    value: "invalid",
    expected: { valid: false, issues: ["tbRefs"] },
  },
  { name: "empty", value: [], expected: { valid: true, issues: [] } },
  {
    name: "allocation-only",
    value: [{ id: "TGB_1", date: timestamp(1) }],
    expected: { valid: true, issues: [] },
  },
  {
    name: "case-insensitive duplicate",
    value: [
      { id: "TGB_1", date: timestamp(1) },
      { id: " tgb_1 ", date: timestamp(2) },
    ],
    expected: { valid: false, issues: ["tbRefs.1.id"] },
  },
  {
    name: "malformed in-progress",
    value: [
      {
        id: "TGB_1",
        date: timestamp(1),
        rowId: "",
        fieldWork: { status: "IN_PROGRESS", updatedAt: null },
      },
    ],
    expected: {
      valid: false,
      issues: [
        "tbRefs.0.rowId",
        "tbRefs.0.rowId",
        "tbRefs.0.fieldWork.updatedAt",
      ],
    },
  },
];

for (const fixture of frozenAggregateFixtures) {
  test(`frozen aggregate valid/issues parity: ${fixture.name}`, () => {
    const { valid, issues } = inspectSalesTbRefsIntegrity(fixture.value);
    assert.deepEqual({ valid, issues }, fixture.expected);
  });
}

function inProgressReference(overrides = {}) {
  return {
    id: "TGB_1",
    rowId: "ROW_1",
    date: timestamp(1),
    fieldWork: { status: "IN_PROGRESS", updatedAt: timestamp(2) },
    ...overrides,
  };
}

test("a malformed sibling does not hide a valid classifiable reference", () => {
  const result = inspectSalesTbRefsIntegrity([
    { id: "BROKEN" },
    inProgressReference(),
  ]);

  assert.equal(result.valid, false);
  assert.equal(result.entries[0].classifiable, false);
  assert.equal(result.entries[1].classifiable, true);
  assert.equal(result.entriesByKey["TGB_1::ROW_1"].classifiable, true);
});

test("a malformed in-progress reference is not classifiable", () => {
  const result = inspectSalesTbRefsIntegrity([
    inProgressReference({ rowId: undefined }),
    { id: "TGB_2", date: timestamp(3) },
  ]);

  assert.equal(result.entries[0].classifiable, false);
  assert.equal(result.entries[1].classifiable, true);
});

for (const [name, second] of [
  ["same identity and row", inProgressReference()],
  ["same identity with a different row", inProgressReference({ rowId: "ROW_2" })],
  ["case variant", inProgressReference({ id: "tgb_1", rowId: "ROW_2" })],
  ["whitespace variant", inProgressReference({ id: " TGB_1 ", rowId: "ROW_2" })],
]) {
  test(`duplicate logical identity suppresses every member: ${name}`, () => {
    const result = inspectSalesTbRefsIntegrity([inProgressReference(), second]);
    assert.deepEqual(
      result.entries.map((entry) => ({
        duplicate: entry.duplicateLogicalIdentity,
        classifiable: entry.classifiable,
      })),
      [
        { duplicate: true, classifiable: false },
        { duplicate: true, classifiable: false },
      ],
    );
  });
}

for (const reverse of [false, true]) {
  test(`valid/malformed duplicate suppression is order-independent: reverse=${reverse}`, () => {
    const valid = inProgressReference();
    const malformed = inProgressReference({ date: null });
    const value = reverse ? [malformed, valid] : [valid, malformed];
    const result = inspectSalesTbRefsIntegrity(value);
    assert.equal(result.entries.every((entry) => !entry.classifiable), true);
  });
}

test("canonical and legacy aliases colliding on one correlation key are suppressed", () => {
  const canonical = inProgressReference();
  const legacy = {
    tbId: "TGB_1",
    tbRowId: "ROW_1",
    date: timestamp(3),
    fieldWork: { status: "IN_PROGRESS", updatedAt: timestamp(4) },
  };
  const result = inspectSalesTbRefsIntegrity([canonical, legacy]);

  assert.equal(result.entries.every((entry) => entry.correlationAmbiguous), true);
  assert.equal(result.entries.every((entry) => !entry.classifiable), true);
  assert.equal(result.entriesByKey["TGB_1::ROW_1"].classifiable, false);
});

test("legacy-only identity correlates for diagnostics but is not classifiable", () => {
  const result = inspectSalesTbRefsIntegrity([
    {
      tbId: "TGB_1",
      tbRowId: "ROW_1",
      date: timestamp(1),
      fieldWork: { status: "IN_PROGRESS", updatedAt: timestamp(2) },
    },
  ]);

  assert.equal(result.entries[0].correlationKey, "TGB_1::ROW_1");
  assert.equal(result.entries[0].valid, false);
  assert.equal(result.entries[0].classifiable, false);
});
