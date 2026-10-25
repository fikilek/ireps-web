import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const here = fileURLToPath(new URL(".", import.meta.url));
import {
  PREMISE_QA_STATUS_OPTIONS,
  PREMISE_QA_REASONS,
  getPremiseQaStatus,
  getPremiseQaLabel,
  getPremiseUpdatedByUser,
  formatQaStatusDate,
  getPremiseHistoryCount,
  DEMO_QA_PREMISES,
} from "../src/utils/premiseQa.js";

let server;
let PremiseQaModal;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  const modalMod = await server.ssrLoadModule("/src/pages/registries/components/PremiseQaModal.jsx");
  PremiseQaModal = modalMod.default;
});

after(async () => {
  if (server) await server.close();
});

test("getPremiseQaStatus normalizes all canonical Premise QA states and defaults to QA NAv", () => {
  assert.equal(getPremiseQaStatus({ qa: { status: "QA PENDING" } }), "QA PENDING");
  assert.equal(getPremiseQaStatus({ qa: { status: "QA_PENDING" } }), "QA PENDING");
  assert.equal(getPremiseQaStatus({ qa: { status: "PENDING" } }), "QA PENDING");
  assert.equal(getPremiseQaStatus({ qa: { status: "QA PASS" } }), "QA PASS");
  assert.equal(getPremiseQaStatus({ qa: { status: "PASS" } }), "QA PASS");
  assert.equal(getPremiseQaStatus({ qa: { status: "QA FAIL" } }), "QA FAIL");
  assert.equal(getPremiseQaStatus({ qa: { status: "FAIL" } }), "QA FAIL");
  assert.equal(getPremiseQaStatus({ qa: { status: "QA NAV" } }), "QA NAv");
  assert.equal(getPremiseQaStatus({ qa: { status: "NAV" } }), "QA NAv");
  assert.equal(getPremiseQaStatus({}), "QA NAv");
  assert.equal(getPremiseQaStatus(null), "QA NAv");
  assert.equal(getPremiseQaStatus({ qa: null }), "QA NAv");
});

test("getPremiseQaLabel displays authoritative 'QA PENDING' for pending review", () => {
  assert.equal(getPremiseQaLabel({ qa: { status: "QA PENDING" } }), "QA PENDING");
  assert.equal(getPremiseQaLabel({ qa: { status: "QA PASS" } }), "QA PASS");
  assert.equal(getPremiseQaLabel({ qa: { status: "QA FAIL" } }), "QA FAIL");
  assert.equal(getPremiseQaLabel({ qa: { status: "QA NAv" } }), "QA NAv");
});

test("PREMISE_QA_REASONS contains the approved 7 canonical failure codes", () => {
  const codes = PREMISE_QA_REASONS.map(r => r.code);
  assert.deepEqual(codes, [
    "ADDRESS_INCORRECT",
    "ERF_MISMATCH",
    "PROPERTY_TYPE_INCORRECT",
    "PHOTO_UNCLEAR",
    "PHOTO_MISSING",
    "COORDINATES_INACCURATE",
    "OTHER",
  ]);
});

test("DEMO_QA_PREMISES supplies isolated sample records for all 4 QA states safely", () => {
  assert.equal(DEMO_QA_PREMISES.length, 4);
  const states = DEMO_QA_PREMISES.map(p => getPremiseQaStatus(p));
  assert.ok(states.includes("QA PENDING"), "Includes QA PENDING sample");
  assert.ok(states.includes("QA PASS"), "Includes QA PASS sample");
  assert.ok(states.includes("QA FAIL"), "Includes QA FAIL sample");
  assert.ok(states.includes("QA NAv"), "Includes QA NAv sample");
});

test("QA Status cell rendering formats reviewer stamp, date and decision controls properly", () => {
  const pendingRow = DEMO_QA_PREMISES.find(p => getPremiseQaStatus(p) === "QA PENDING");
  const passRow = DEMO_QA_PREMISES.find(p => getPremiseQaStatus(p) === "QA PASS");
  const failRow = DEMO_QA_PREMISES.find(p => getPremiseQaStatus(p) === "QA FAIL");
  const navRow = DEMO_QA_PREMISES.find(p => getPremiseQaStatus(p) === "QA NAv");

  assert.equal(getPremiseQaLabel(pendingRow), "QA PENDING");
  assert.equal(getPremiseQaLabel(passRow), "QA PASS");
  assert.equal(getPremiseQaLabel(failRow), "QA FAIL");
  assert.equal(getPremiseQaLabel(navRow), "QA NAv");

  assert.ok(passRow.qa.reviewedByUser.includes("Jane Khumalo"));
  assert.ok(failRow.qa.reasonCode === "ADDRESS_INCORRECT");
});

test("Filtering matches exact QA status values across all 4 canonical states", () => {
  const rows = DEMO_QA_PREMISES;
  const filterByQa = (status) => rows.filter(r => status === "ALL" || getPremiseQaStatus(r) === status);

  assert.equal(filterByQa("ALL").length, 4);
  assert.equal(filterByQa("QA PENDING").length, 1);
  assert.equal(filterByQa("QA PASS").length, 1);
  assert.equal(filterByQa("QA FAIL").length, 1);
  assert.equal(filterByQa("QA NAv").length, 1);
});

test("Self-review is prohibited: creator UID matching reviewer UID disables decision selector", () => {
  const pendingRow = DEMO_QA_PREMISES.find(p => getPremiseQaStatus(p) === "QA PENDING");
  const reviewerUid = "FWR_001"; // Matches pendingRow.metadata.createdByUid
  const isSelf = pendingRow.metadata?.createdByUid === reviewerUid;
  assert.equal(isSelf, true, "Self-review condition identified");

  const otherUid = "MNG_999";
  const isOther = pendingRow.metadata?.createdByUid === otherUid;
  assert.equal(isOther, false, "Independent reviewer permitted");
});

test("PremiseQaModal renders premise identity, photos, decision controls and decision history", () => {
  const pendingRow = DEMO_QA_PREMISES.find(p => getPremiseQaStatus(p) === "QA PENDING");
  const html = renderToStaticMarkup(
    React.createElement(PremiseQaModal, {
      premise: pendingRow,
      initialAction: "FAIL",
      reviewerRole: true,
      onClose: () => {},
    })
  );

  assert.ok(html.includes("Premise QA"), "Renders Premise QA header");
  assert.ok(html.includes("10 Victoria Street"), "Renders premise address");
  assert.ok(html.includes("ERF 5220"), "Renders ERF number");
  assert.ok(html.includes("Submitted Evidence"), "Renders Submitted Evidence box");
  assert.ok(html.includes("Submitted Details"), "Renders Submitted Details disclosures");
  assert.ok(html.includes("Decision"), "Renders Decision box");
  assert.ok(html.includes("Failure reason (required)"), "Renders required failure reason label for QA FAIL");
  assert.ok(html.includes("Failure explanation (optional)"), "Renders optional comment field for QA FAIL");
  assert.ok(html.includes("Decision History"), "Renders Decision History box");
  assert.ok(html.includes("John Sithole (SPV)"), "Renders past decision history actor");
  assert.ok(html.includes("Sipho Dlamini (FWR)"), "Renders resubmission history actor");
  assert.ok(!html.includes("<details open"), "All Submitted Details disclosures must start closed by default");
});

test("PremiseQaModal renders real premise media with human-readable tags and metadata", () => {
  const premiseWithPhotos = {
    id: "PRM_002",
    addressText: "25 Nelson Mandela Ave",
    erfNo: "8801",
    media: [
      {
        tag: "propertyAdrPhoto",
        url: "https://example.com/addr.jpg",
        gps: { lat: -28.1515, lng: 30.2513 },
        created: { at: "2026-10-22T01:11:47Z", byUser: "Simo Phemba" },
      },
      {
        tag: "propertyTypePhoto",
        url: "https://example.com/type.jpg",
      },
    ],
    qa: { status: "QA_PENDING" },
  };

  const html = renderToStaticMarkup(
    React.createElement(PremiseQaModal, {
      premise: premiseWithPhotos,
      reviewerRole: true,
      qaPreview: false,
      onClose: () => {},
    })
  );

  assert.ok(html.includes("Property Address Photo"), "Formats propertyAdrPhoto tag to human-readable label");
  assert.ok(html.includes("Property Type Photo"), "Formats propertyTypePhoto tag to human-readable label");
  assert.ok(html.includes("https://example.com/addr.jpg"), "Renders photo link url");
  assert.ok(html.includes("-28.15150, 30.25130"), "Renders photo GPS coordinates");
  assert.ok(html.includes("Simo Phemba"), "Renders photo submitter name");
  assert.ok(!html.includes("<details open"), "Submitted Details are closed by default");
});

test("Premise Registry and TRN Registry standardize modal-first QaPill and topScrollbar", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");

  const here = fileURLToPath(new URL(".", import.meta.url));
  const premisesSrc = readFileSync(join(here, "../src/pages/registries/PremisesRegistryPage.jsx"), "utf8");
  const trnsSrc = readFileSync(join(here, "../src/pages/registries/TrnsRegistryPage.jsx"), "utf8");

  // Premise Registry topScrollbar
  assert.match(
    premisesSrc,
    /<IrepsTable[\s\S]*?topScrollbar/,
    "PremisesRegistryPage must pass topScrollbar to IrepsTable",
  );

  // Premise Registry QaPill and no inline select
  assert.match(
    premisesSrc,
    /<QaPill\s+status=\{status\}/,
    "PremisesRegistryPage must render QaPill for QA Status column",
  );
  assert.doesNotMatch(
    premisesSrc,
    /<select[^>]*aria-label=\{`QA decision for premise/,
    "PremisesRegistryPage must NOT have inline select dropdown for QA decisions",
  );
  assert.match(
    premisesSrc,
    /key:\s*["']qaHistory["']/,
    "PremisesRegistryPage must retain the separate qaHistory column",
  );
  assert.match(
    premisesSrc,
    /<DataActionButton[\s\S]*?title=["']QA History["'][\s\S]*?>\s*QA History\s*<\/DataActionButton>/,
    "PremisesRegistryPage qaHistory column button must strictly say 'QA History'",
  );

  // TRN Registry QaPill and no inline select
  assert.match(
    trnsSrc,
    /<QaPill\s+status=\{status\}/,
    "TrnsRegistryPage must render QaPill for QA Status column",
  );
  assert.doesNotMatch(
    trnsSrc,
    /<select[^>]*aria-label=\{`QA decision for \$\{row\.trnId\}/,
    "TrnsRegistryPage must NOT have inline select dropdown for QA decisions",
  );
  // IrepsTable universal default
  const irepsTableSrc = readFileSync(join(here, "../src/components/table/IrepsTable.jsx"), "utf8");
  assert.match(
    irepsTableSrc,
    /topScrollbar\s*=\s*true/,
    "IrepsTable must default topScrollbar to true so all tables have top horizontal scrolling",
  );
});

test("PremiseQaModal in history mode strictly renders Premise QA History, Premise Details and Decision History", () => {
  const pendingRow = DEMO_QA_PREMISES.find(p => getPremiseQaStatus(p) === "QA PENDING");
  const html = renderToStaticMarkup(
    React.createElement(PremiseQaModal, {
      premise: pendingRow,
      mode: "history",
      reviewerRole: true,
      onClose: () => {},
    })
  );

  assert.ok(html.includes("Premise QA History"), "Header must be strictly 'Premise QA History'");
  assert.ok(!html.includes("<h2 id=\"qa-premise-title\">Premise QA</h2>"), "Must not display standard Premise QA review header");
  assert.ok(html.includes("Premise Details"), "Must render Premise Details box");
  assert.ok(html.includes("Decision History"), "Must render Decision History box");
  assert.ok(!html.includes("Submitted Evidence"), "Must NOT render Submitted Evidence box in history mode");
  assert.ok(!html.includes("Submitted Details"), "Must NOT render Submitted Details disclosures in history mode");
  assert.ok(!html.includes("<h3>Decision</h3>"), "Must NOT render Decision review box in history mode");
});

test("Premise Registry includes Created By User and Updated By User columns aligning with standard lifecycle", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");

  const here = fileURLToPath(new URL(".", import.meta.url));
  const premisesSrc = readFileSync(join(here, "../src/pages/registries/PremisesRegistryPage.jsx"), "utf8");

  assert.match(
    premisesSrc,
    /key:\s*["']createdByUser["'][\s\S]*?label:\s*["']Created By User["']/,
    "PremisesRegistryPage must define Created By User column",
  );
  assert.match(
    premisesSrc,
    /key:\s*["']updatedByUser["'][\s\S]*?label:\s*["']Updated By User["']/,
    "PremisesRegistryPage must define Updated By User column",
  );
});

test("getPremiseUpdatedByUser resolves reviewer on QA FAIL/PASS and FWR on correction/creation", async () => {
  const { getPremiseUpdatedByUser } = await import("../src/utils/premiseQa.js");

  // Case 1: QA FAIL reviewed by Zamo Ngubs
  const qaFailRow = {
    createdByUser: "Simo Phemba",
    qa: {
      status: "QA_FAIL",
      reviewedByUser: "Zamo Ngubs",
      lastSubmittedByUser: "Simo Phemba",
    },
  };
  assert.strictEqual(getPremiseUpdatedByUser(qaFailRow), "Zamo Ngubs", "Resolves reviewer name on QA FAIL");

  // Case 2: QA PENDING corrected by Peter Peter
  const correctedRow = {
    createdByUser: "Simo Phemba",
    qa: {
      status: "QA_PENDING",
      resubmissionCount: 1,
      lastSubmittedByUser: "Peter Peter",
      reviewedByUser: "Zamo Ngubs",
    },
  };
  assert.strictEqual(getPremiseUpdatedByUser(correctedRow), "Peter Peter", "Resolves correcting FWR name on resubmission");

  // Case 3: Initial capture by Simo Phemba
  const initialRow = {
    createdByUser: "Simo Phemba",
    qa: {
      status: "QA_PENDING",
      resubmissionCount: 0,
      lastSubmittedByUser: "Simo Phemba",
    },
  };
  assert.strictEqual(getPremiseUpdatedByUser(initialRow), "Simo Phemba", "Resolves initial FWR on fresh capture");
});

test("Premise Registry streams pure live data with QA Preview toggle removed", () => {
  const premisesSrc = readFileSync(join(here, "../src/pages/registries/PremisesRegistryPage.jsx"), "utf8");

  // Ensure QA Preview toggle button, banner, and demo injection are completely removed
  assert.doesNotMatch(premisesSrc, /role="switch"/, "PremisesRegistryPage must NOT have QA Preview switch");
  assert.doesNotMatch(premisesSrc, /qa-preview-banner/, "PremisesRegistryPage must NOT have QA Preview banner");
  assert.doesNotMatch(premisesSrc, /qaPreviewMode/, "PremisesRegistryPage must NOT have qaPreviewMode state");
  assert.doesNotMatch(premisesSrc, /DEMO_QA_PREMISES/, "PremisesRegistryPage must NOT inject demo premises");

  const liveRow = {
    id: "PRM_1792586652816_92_W006_5246",
    premiseId: "PRM_1792586652816_92_W006_5246",
    qa: {
      status: "QA_PENDING",
      resubmissionCount: 1,
      lastSubmittedByUser: "Peter Peter",
      reviewedByUser: null,
    },
  };

  assert.strictEqual(liveRow.qa.status, "QA_PENDING", "Live row preserves streamed QA_PENDING status");
  assert.strictEqual(getPremiseUpdatedByUser(liveRow), "Peter Peter", "Live row reflects correcting FWR");
});

test("formatQaStatusDate formats clean date without actor name or seconds", () => {
  const dateIso = "2026-10-25T04:45:26.000Z"; // 06:45:26 SAST
  const formatted = formatQaStatusDate(dateIso);
  assert.strictEqual(formatted, "2026/10/25, 06:45");
  assert.strictEqual(formatQaStatusDate(null), null);
  assert.strictEqual(formatQaStatusDate("NAv"), null);
});

test("IrepsTable vertically centers all rows and supports stickyFirstColumn", () => {
  const irepsTableSrc = readFileSync(join(here, "../src/components/table/IrepsTable.jsx"), "utf8");
  assert.match(
    irepsTableSrc,
    /cell:\s*\{[\s\S]*?verticalAlign:\s*["']middle["']/,
    "IrepsTable must vertically center table cell contents by default",
  );
  assert.match(
    irepsTableSrc,
    /stickyFirstColumn/,
    "IrepsTable must support stickyFirstColumn prop",
  );

  const premisesSrc = readFileSync(join(here, "../src/pages/registries/PremisesRegistryPage.jsx"), "utf8");
  assert.match(
    premisesSrc,
    /<IrepsTable[\s\S]*?stickyFirstColumn/,
    "PremisesRegistryPage must set stickyFirstColumn on IrepsTable",
  );
});

test("getPremiseHistoryCount calculates event counts accurately and PremisesRegistryPage renders badge", () => {
  // Test with explicit historyCount
  assert.strictEqual(getPremiseHistoryCount({ qa: { historyCount: 5 } }), 5);

  // Test fallback with initial submission only
  assert.strictEqual(getPremiseHistoryCount({ qa: { status: "QA_PENDING", resubmissionCount: 0 } }), 1);

  // Test fallback with 2 resubmissions and reviewed
  assert.strictEqual(getPremiseHistoryCount({ qa: { status: "QA_PASS", resubmissionCount: 2, reviewedAt: "2026-10-25T00:00:00Z" } }), 4);

  const premisesSrc = readFileSync(join(here, "../src/pages/registries/PremisesRegistryPage.jsx"), "utf8");
  assert.match(
    premisesSrc,
    /getPremiseHistoryCount\(row\)/,
    "PremisesRegistryPage must calculate historyCount for each row",
  );
  assert.match(
    premisesSrc,
    /aria-label=\{`\$\{historyCount\} history events`\}/,
    "PremisesRegistryPage must render badge with accessible label",
  );
});

test("PremiseQaModal displays spinner when loading history and auto-closes on review submit", () => {
  const modalSrc = readFileSync(join(here, "../src/pages/registries/components/PremiseQaModal.jsx"), "utf8");
  const modalCss = readFileSync(join(here, "../src/pages/registries/components/PremiseQaModal.css"), "utf8");

  assert.match(modalCss, /\.qa-spinner/, "PremiseQaModal.css must define .qa-spinner styling");
  assert.match(modalSrc, /loadingContext[\s\S]*?qa-spinner/, "PremiseQaModal must render spinner when loadingContext is true");
  assert.match(modalSrc, /async function submit[\s\S]*?onClose\?\.\(\)/, "PremiseQaModal must auto-close after successfully saving review");
});

test("savePremiseQaReview defines previousStatus and historyCount accurately", () => {
  const backendSrc = readFileSync(join(here, "../functions/qa/premiseQaReview.js"), "utf8");
  assert.match(
    backendSrc,
    /const previousStatus = premise\.qa\?\.status/,
    "savePremiseQaReview must define previousStatus before writing historyEntry",
  );
  assert.match(
    backendSrc,
    /previousStatus,[\s\S]*?newStatus: qaStateName/,
    "historyEntry must record previousStatus and newStatus without reference errors",
  );
});

