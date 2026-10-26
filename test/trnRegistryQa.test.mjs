import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TRN_QA_STATUS_OPTIONS,
  getTrnUpdatedByUser,
  formatQaStatusDate,
  getTrnHistoryCount,
} from "../src/utils/trnQa.js";

const here = fileURLToPath(new URL(".", import.meta.url));

test("getTrnUpdatedByUser resolves amendment actor, QA reviewer, or submitter", () => {
  const amendedRow = {
    workflowState: "COMPLETED",
    qa: {
      lastAmendment: { byUser: "Correcting Supervisor" },
      reviewedByUser: "First Reviewer",
    },
    createdByUser: "Field Worker",
  };
  assert.equal(getTrnUpdatedByUser(amendedRow), "Correcting Supervisor");

  const reviewedRow = {
    workflowState: "QA PASS",
    qa: { reviewedByUser: "QA Reviewer" },
    createdByUser: "Field Worker",
  };
  assert.equal(getTrnUpdatedByUser(reviewedRow), "QA Reviewer");

  const completedRow = {
    workflowState: "COMPLETED",
    completedByUser: "Field Worker 2",
    createdByUser: "Field Worker 1",
  };
  assert.equal(getTrnUpdatedByUser(completedRow), "Field Worker 2");

  assert.equal(getTrnUpdatedByUser(null), "NAv");
});

test("formatQaStatusDate formats clean date without seconds", () => {
  const formatted = formatQaStatusDate("2026-10-24T08:30:00Z");
  assert.ok(formatted, "Returns non-null formatted string");
  assert.match(formatted, /\d{4}\/\d{2}\/\d{2}/);
  assert.equal(formatQaStatusDate(null), null);
  assert.equal(formatQaStatusDate("NAv"), null);
});

test("getTrnHistoryCount accurately counts timeline events", () => {
  assert.equal(getTrnHistoryCount({ qa: { historyCount: 3 } }), 3);
  assert.equal(getTrnHistoryCount({ historyCount: 2 }), 2);
  assert.equal(getTrnHistoryCount({ qaHistory: [{}, {}] }), 2);
  assert.equal(getTrnHistoryCount({ workflowState: "COMPLETED" }), 1);
  assert.equal(getTrnHistoryCount({ workflowState: "QA PASS", qa: { reviewedByUser: "Supervisor" } }), 2);
  assert.equal(getTrnHistoryCount(null), 0);
});

test("TrnsRegistryPage standardizes columns with Premise Registry", () => {
  const trnsSrc = readFileSync(join(here, "../src/pages/registries/TrnsRegistryPage.jsx"), "utf8");

  // Columns alignment
  assert.match(trnsSrc, /key:\s*["']createdByUser["'],\s*label:\s*["']Created By User["']/);
  assert.match(trnsSrc, /key:\s*["']updatedByUser["'],\s*label:\s*["']Updated By User["']/);
  assert.match(trnsSrc, /key:\s*["']lastUpdatedAt["'],\s*label:\s*["']updatedAt["']/);
  assert.match(trnsSrc, /key:\s*["']qaState["'],\s*label:\s*["']QA Status["']/);
  assert.match(trnsSrc, /key:\s*["']qaHistory["'],\s*label:\s*["']QA History["']/);

  // Badge count on QA History button
  assert.match(trnsSrc, /getTrnHistoryCount\(row\)/);
  assert.match(trnsSrc, /style=\{\{[\s\S]*?position:\s*["']absolute["'][\s\S]*?background:\s*["']#1d4ed8["']/);

  // Modal support for mode='review' and mode='history'
  assert.match(trnsSrc, /mode:\s*["']history["']/);
  assert.match(trnsSrc, /mode:\s*["']review["']/);
});

test("TrnQaModal source supports mode='history' and hides form data, evidence and decision form", () => {
  const modalSrc = readFileSync(join(here, "../src/pages/registries/components/TrnQaModal.jsx"), "utf8");
  assert.match(modalSrc, /mode === "history" \? "TRN QA History" : "TRN QA"/);
  assert.match(modalSrc, /\{mode !== "history" && \(\s*<>\s*<Snapshot/);
  assert.match(modalSrc, /export function TrnQaHistoryModal/);
});
