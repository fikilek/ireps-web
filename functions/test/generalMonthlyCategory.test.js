import test from "node:test";
import assert from "node:assert/strict";

import { buildCanonicalGmrMeterRow } from "../reports/generalMonthlyReport.js";

function buildRow(data, reportMonth) {
  return buildCanonicalGmrMeterRow({
    registry: {},
    sourceSalesEntry: { id: "M1", data },
    reportMonth,
  });
}

test("GMR reads only its explicit report month and never legacy or another month", () => {
  const data = {
    leakageCategory: "LEGACY",
    monthlyCategories: {
      "2026-06": {
        leakageCategory: "JUNE",
        riskTier: "High",
        riskScore: 3,
      },
      "2026-08": {
        leakageCategory: "AUGUST",
        riskTier: "Low",
        riskScore: 0,
      },
    },
  };

  assert.equal(buildRow(data, "2026-06").salesCategory, "JUNE");
  assert.equal(buildRow(data, "2026-08").salesCategory, "AUGUST");
  assert.equal(buildRow(data, "2026-07").salesCategory, null);
  assert.equal(buildRow(data, null).salesCategory, null);
});

test("GMR rejects malformed monthly category entries without falling back to legacy", () => {
  const base = {
    leakageCategory: "LEGACY",
  };

  assert.equal(
    buildRow({
      ...base,
      monthlyCategories: {
        "2026-08": {
          leakageCategory: "AUGUST",
          riskScore: 0,
        },
      },
    }, "2026-08").salesCategory,
    null
  );

  assert.equal(
    buildRow({
      ...base,
      monthlyCategories: {
        "2026-08": {
          leakageCategory: "AUGUST",
          riskTier: "Low",
          riskScore: 0.5,
        },
      },
    }, "2026-08").salesCategory,
    null
  );

  assert.equal(
    buildRow({
      ...base,
      monthlyCategories: {
        "2026-08": {
          leakageCategory: "AUGUST",
          riskTier: "Low",
          riskScore: 0,
          extra: "NOT_ALLOWED",
        },
      },
    }, "2026-08").salesCategory,
    null
  );
});