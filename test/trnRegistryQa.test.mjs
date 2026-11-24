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
  isNoAccessTrnRow,
  isSubmittedRegistryTrn,
} from "../src/utils/trnQa.js";
import { getBgoBatchId, getBgoRowId, getBgoKind } from "../src/redux/trnBgoFields.js";

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
  assert.equal(getTrnHistoryCount({ workflowState: "COMPLETED" }), 0);
  assert.equal(getTrnHistoryCount({ workflowState: "QA PASS", qa: { reviewedByUser: "Supervisor" } }), 1);
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

  // Badge count on QA History button only when historyCount > 0
  assert.match(trnsSrc, /getTrnHistoryCount\(row\)/);
  assert.match(trnsSrc, /historyCount > 0 && \(/);
  assert.match(trnsSrc, /style=\{\{[\s\S]*?position:\s*["']absolute["'][\s\S]*?background:\s*["']#1d4ed8["']/);

  // QA Status and QA History columns share identical width
  assert.match(trnsSrc, /key:\s*["']qaState["'][\s\S]*?minWidth:\s*["']8\.5rem["']/);
  assert.match(trnsSrc, /key:\s*["']qaHistory["'][\s\S]*?minWidth:\s*["']8\.5rem["']/);

  // Modal support for mode='review' and mode='history'
  assert.match(trnsSrc, /mode:\s*["']history["']/);
  assert.match(trnsSrc, /mode:\s*["']review["']/);

  // Date under QA pill uses formatQaStatusDate and does not render user name
  assert.match(trnsSrc, /formatQaStatusDate\(dateVal\)/);
  assert.doesNotMatch(trnsSrc, /row\.qa\?\.reviewedByUser\s*&&\s*<small>/);
});

test("TrnQaModal source supports mode='history' and hides form data, evidence and decision form", () => {
  const modalSrc = readFileSync(join(here, "../src/pages/registries/components/TrnQaModal.jsx"), "utf8");
  assert.match(modalSrc, /mode === "history" \? "TRN QA History" : "TRN QA"/);
  assert.match(modalSrc, /\{mode !== "history" && \(\s*<>\s*<Snapshot/);
  assert.match(modalSrc, /export function TrnQaHistoryModal/);

  // Closes modal upon successful submit
  assert.match(modalSrc, /onClose\?\.?\(\)/);
});

test("getTrnUpdatedByUser skips 'NAv' placeholders and falls back to metadata.updatedByUser", () => {
  const row = {
    workflowState: "IN_PROGRESS",
    completedByUser: "NAv",
    updatedByUser: "NAv",
    metadata: { updatedByUser: "Elsa Swanepoel" },
    createdByUser: "Mandy Mandy",
  };
  assert.equal(getTrnUpdatedByUser(row), "Elsa Swanepoel");
});

test("isSubmittedRegistryTrn excludes unexecuted instructions while keeping NA visits and executed TRNs", () => {
  assert.equal(isSubmittedRegistryTrn({ workflowState: "CREATED", hasAccess: "NAv", originChannel: "OFFICE" }), false);
  assert.equal(isSubmittedRegistryTrn({ workflowState: "ISSUED", hasAccess: "NAv", originChannel: "OFFICE" }), false);
  assert.equal(isSubmittedRegistryTrn({ workflowState: "ACCEPTED", hasAccess: "NAv", originChannel: "OFFICE" }), false);
  assert.equal(isSubmittedRegistryTrn({ workflowState: "IN_PROGRESS", hasAccess: "NAv", originChannel: "OFFICE" }), false);
  assert.equal(isSubmittedRegistryTrn({ workflowState: "COMPLETED", hasAccess: "NO", originChannel: "OFFICE" }), true);
  assert.equal(isSubmittedRegistryTrn({ workflowState: "COMPLETED", hasAccess: "YES", originChannel: "OFFICE" }), true);
  assert.equal(isSubmittedRegistryTrn({ workflowState: "NAv", hasAccess: "NAv", originChannel: "FIELD" }), true);

  assert.equal(isNoAccessTrnRow({ hasAccess: "NO" }), true);
  assert.equal(isNoAccessTrnRow({ hasAccess: "YES" }), false);
});

test("trnBgoFields reads origin.trnBgoNoAccess batchId and rowId for TRN BGO NA rows", () => {
  const naDoc = {
    origin: {
      channel: "OFFICE",
      trnBgoNoAccess: {
        batchId: "TRN_BGO_20261124_033837_ZA5241006_MDCN",
        rowId: "TRN_BGO_20261124_033837_ZA5241006_MDCN_R000001",
        instructionTrnId: "TRN_MDCN_1",
      },
    },
  };
  assert.equal(getBgoBatchId(naDoc), "TRN_BGO_20261124_033837_ZA5241006_MDCN");
  assert.equal(getBgoRowId(naDoc), "TRN_BGO_20261124_033837_ZA5241006_MDCN_R000001");
  assert.equal(getBgoKind(naDoc, getBgoBatchId(naDoc)), "TRN_BGO");
});

test("TrnsRegistryPage excludes NA visits from operation QA and filters out unsubmitted instructions", () => {
  const trnsSrc = readFileSync(join(here, "../src/pages/registries/TrnsRegistryPage.jsx"), "utf8");
  assert.match(trnsSrc, /if \(isNoAccessTrnRow\(row\)\) return "NOT_ELIGIBLE";/);
  assert.match(trnsSrc, /if \(!isSubmittedRegistryTrn\(row\)/);
});

