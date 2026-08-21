import assert from "node:assert/strict";
import test from "node:test";

import {
  NGP_CLASSIFICATIONS,
  NGP_SELECTION_MAX,
  NGP_TARGETED_BATCH_PLANNING_MODE,
  buildNgpTargetedBatchDraftPlan,
  buildNonGpsBatchPlanningModel,
  classifyNonGpsSalesRow,
  compareStreetNumbers,
  formatAuthoritativeAddress,
  normalizePlanningKey,
  reconcileNgpVisibility,
  updateNgpStreetSelection,
  validateNgpSelection,
} from "./nonGpsBatchPlanningModel.js";
import { inspectSalesTbRefsIntegrity } from "./salesTbRefsIntegrityModel.js";
import {
  hasUsableSalesGps,
  isSalesWithoutUsableGps,
  matchesSalesGpsFilter,
  SALES_GPS_FILTERS,
} from "./salesGpsModel.js";

function makeRow({
  id,
  gps = false,
  town = "Dundee",
  strNo = "1",
  strName = "Mckenzie",
  strType = "Street",
  tbRefs = [],
  tbRefsIntegrity = { valid: true, issues: [] },
  meterNo,
  accountNumber,
  lmPcode = "ZA5241",
} = {}) {
  return {
    id: id || `SALES_${Math.random()}`,
    meterNo: meterNo || id || "07100000000",
    accountNumber: accountNumber || `ACC_${id || "1"}`,
    lmPcode,
    hasUsableGps: gps,
    town,
    adr: { strNo, strName, strType },
    tbRefs,
    tbRefsIntegrity,
  };
}

function makeDiscoveredRef({ targeted = "111", discovered = "222" } = {}) {
  const timestamp = { seconds: 1_700_000_000, nanoseconds: 0 };

  return {
    id: "TB_001",
    date: timestamp,
    rowId: "TBR_001_000001",
    fieldWork: {
      status: "COMPLETED",
      outcomeCode: "METER_DISCOVERED",
      outcomeLabel: "Meter discovered",
      targetedMeterNo: targeted,
      discoveredMeterNo: discovered,
      meterMatch: targeted === discovered,
      premiseId: "PRM_1",
      meterId: "MTR_1",
      trnId: "TRN_1",
      submittedAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function makeUnresolvedRef(overrides = {}) {
  return {
    id: "TB_123",
    date: { seconds: 1_700_000_000, nanoseconds: 0 },
    ...overrides,
  };
}

test("shared GPS predicate is the same rule used by Sales and NGP", () => {
  const withGps = makeRow({ gps: true });
  const withoutGps = makeRow({ gps: false });

  assert.equal(hasUsableSalesGps(withGps), true);
  assert.equal(isSalesWithoutUsableGps(withGps), false);
  assert.equal(hasUsableSalesGps(withoutGps), false);
  assert.equal(isSalesWithoutUsableGps(withoutGps), true);
  assert.equal(
    matchesSalesGpsFilter(withGps, SALES_GPS_FILTERS.WITH_GPS),
    true,
  );
  assert.equal(
    matchesSalesGpsFilter(withoutGps, SALES_GPS_FILTERS.WITHOUT_GPS),
    true,
  );
});

test("authoritative address formatting keeps source values and suppresses dash type", () => {
  assert.equal(
    formatAuthoritativeAddress(
      makeRow({ strNo: "42", strName: "Mckenzie", strType: "Street" }),
    ),
    "42 Mckenzie Street",
  );
  assert.equal(
    formatAuthoritativeAddress(
      makeRow({ strNo: "34", strName: "Bulwer", strType: "-" }),
    ),
    "34 Bulwer",
  );
});

test("planning normalization collapses spacing and compares case-insensitively", () => {
  assert.equal(normalizePlanningKey("  McKenzie   STREET "), "mckenzie street");
  assert.equal(normalizePlanningKey("MCKENZIE STREET"), "mckenzie street");
});

test("same street name in different towns never merges", () => {
  const model = buildNonGpsBatchPlanningModel([
    makeRow({ id: "A", town: "Dundee", strName: "Smith" }),
    makeRow({ id: "B", town: "Glencoe", strName: "Smith" }),
  ]);

  assert.equal(model.towns.length, 2);
  assert.notEqual(model.towns[0].streets[0].key, model.towns[1].streets[0].key);
});

test("case and spacing variants group without mutating display source", () => {
  const first = makeRow({
    id: "A",
    town: "Dundee",
    strName: "Mckenzie",
    strNo: "1",
  });
  const second = makeRow({
    id: "B",
    town: "  DUNDEE  ",
    strName: "  MCKENZIE ",
    strNo: "2",
  });
  const model = buildNonGpsBatchPlanningModel([first, second]);

  assert.equal(model.towns.length, 1);
  assert.equal(model.towns[0].streets.length, 1);
  assert.equal(first.town, "Dundee");
  assert.equal(second.adr.strName, "  MCKENZIE ");
});

test("street numbers sort naturally", () => {
  const rows = ["1", "10", "100", "11", "2", "20"].map((strNo, index) =>
    makeRow({ id: String(index), strNo }),
  );

  rows.sort(compareStreetNumbers);

  assert.deepEqual(
    rows.map((row) => row.adr.strNo),
    ["1", "2", "10", "11", "20", "100"],
  );
});

test("classification precedence puts valid completed Meter Discovery before address exceptions", () => {
  const row = makeRow({
    id: "DISCOVERED",
    strNo: "",
    strName: "",
    tbRefs: [makeDiscoveredRef({ targeted: "111", discovered: "222" })],
    tbRefsIntegrity: { valid: true, issues: [] },
  });

  const result = classifyNonGpsSalesRow(row);

  assert.equal(result.classification, NGP_CLASSIFICATIONS.DISCOVERED);
  assert.equal(result.selectable, false);
});

test("Meter Discovery closes the original target when physical meter differs", () => {
  const row = makeRow({
    id: "MISMATCH",
    meterNo: "111",
    tbRefs: [makeDiscoveredRef({ targeted: "111", discovered: "999" })],
  });

  assert.equal(
    classifyNonGpsSalesRow(row).classification,
    NGP_CLASSIFICATIONS.DISCOVERED,
  );
});

test("missing planning address becomes a non-selectable exception", () => {
  const result = classifyNonGpsSalesRow(
    makeRow({ id: "EX", strNo: "", strName: "", strType: "-" }),
  );

  assert.equal(result.classification, NGP_CLASSIFICATIONS.EXCEPTION);
  assert.equal(result.selectable, false);
  assert.ok(result.exceptionReasons.includes("Street number is missing"));
  assert.ok(result.exceptionReasons.includes("Street name is missing"));
});

test("malformed Targeted Batch references fail closed as exceptions", () => {
  const result = classifyNonGpsSalesRow(
    makeRow({
      id: "BAD_TB",
      tbRefs: [],
      tbRefsIntegrity: {
        valid: false,
        issues: ["TB_REF_1_DUPLICATE_ID"],
      },
    }),
  );

  assert.equal(result.classification, NGP_CLASSIFICATIONS.EXCEPTION);
  assert.equal(result.selectable, false);
});

test("frontend TB integrity rejects unknown status and malformed linkage cannot become Outstanding", () => {
  const rawTbRefs = [
    makeUnresolvedRef({ fieldWork: { status: "BOGUS" } }),
  ];
  const integrity = inspectSalesTbRefsIntegrity(rawTbRefs);
  const result = classifyNonGpsSalesRow(
    makeRow({ id: "BOGUS", tbRefs: rawTbRefs, tbRefsIntegrity: integrity }),
  );

  assert.equal(integrity.valid, false);
  assert.equal(result.classification, NGP_CLASSIFICATIONS.EXCEPTION);
  assert.notEqual(result.classification, NGP_CLASSIFICATIONS.OUTSTANDING);
});

test("frontend TB integrity rejects malformed reference dates and duplicate IDs", () => {
  const malformedDate = inspectSalesTbRefsIntegrity([
    makeUnresolvedRef({ date: "2026-08-14" }),
  ]);
  const duplicateIds = inspectSalesTbRefsIntegrity([
    makeUnresolvedRef({ id: "TB_1" }),
    makeUnresolvedRef({ id: " tb_1 " }),
  ]);

  assert.equal(malformedDate.valid, false);
  assert.ok(malformedDate.issues.includes("tbRefs.0.date"));
  assert.equal(duplicateIds.valid, false);
  assert.ok(duplicateIds.issues.includes("tbRefs.1.id"));
});

test("frontend TB integrity requires IN_PROGRESS rowId and valid updatedAt", () => {
  const missingRowId = inspectSalesTbRefsIntegrity([
    makeUnresolvedRef({
      fieldWork: {
        status: "IN_PROGRESS",
        updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
      },
    }),
  ]);
  const invalidUpdatedAt = inspectSalesTbRefsIntegrity([
    makeUnresolvedRef({
      rowId: "TBR_1",
      fieldWork: { status: "IN_PROGRESS", updatedAt: "yesterday" },
    }),
  ]);

  assert.equal(missingRowId.valid, false);
  assert.ok(missingRowId.issues.includes("tbRefs.0.rowId"));
  assert.equal(invalidUpdatedAt.valid, false);
  assert.ok(invalidUpdatedAt.issues.includes("tbRefs.0.fieldWork.updatedAt"));
});

test("frontend TB integrity rejects incomplete COMPLETED evidence", () => {
  const integrity = inspectSalesTbRefsIntegrity([
    makeUnresolvedRef({
      rowId: "TBR_1",
      fieldWork: {
        status: "COMPLETED",
        outcomeCode: "METER_DISCOVERED",
      },
    }),
  ]);
  const result = classifyNonGpsSalesRow(
    makeRow({
      id: "INCOMPLETE_COMPLETED",
      tbRefs: [
        makeUnresolvedRef({
          rowId: "TBR_1",
          fieldWork: {
            status: "COMPLETED",
            outcomeCode: "METER_DISCOVERED",
          },
        }),
      ],
      tbRefsIntegrity: integrity,
    }),
  );

  assert.equal(integrity.valid, false);
  assert.equal(result.classification, NGP_CLASSIFICATIONS.EXCEPTION);
});

test("valid COMPLETED discovery and valid unresolved reference preserve classifications", () => {
  const discoveredRef = makeDiscoveredRef();
  const unresolvedRef = makeUnresolvedRef();

  assert.equal(inspectSalesTbRefsIntegrity([discoveredRef]).valid, true);
  assert.equal(
    classifyNonGpsSalesRow(
      makeRow({
        id: "VALID_DISC",
        tbRefs: [discoveredRef],
        tbRefsIntegrity: inspectSalesTbRefsIntegrity([discoveredRef]),
      }),
    ).classification,
    NGP_CLASSIFICATIONS.DISCOVERED,
  );
  assert.equal(inspectSalesTbRefsIntegrity([unresolvedRef]).valid, true);
  assert.equal(
    classifyNonGpsSalesRow(
      makeRow({
        id: "VALID_UNRESOLVED",
        tbRefs: [unresolvedRef],
        tbRefsIntegrity: inspectSalesTbRefsIntegrity([unresolvedRef]),
      }),
    ).classification,
    NGP_CLASSIFICATIONS.ALREADY_BATCHED,
  );
});

test("valid unresolved Targeted Batch reference becomes ALREADY_BATCHED", () => {
  const result = classifyNonGpsSalesRow(
    makeRow({
      id: "BATCHED",
      tbRefs: [makeUnresolvedRef()],
    }),
  );

  assert.equal(result.classification, NGP_CLASSIFICATIONS.ALREADY_BATCHED);
  assert.equal(result.selectable, false);
});

test("clean No-GPS street target with no TB reference is OUTSTANDING", () => {
  const result = classifyNonGpsSalesRow(makeRow({ id: "OUT" }));

  assert.equal(result.classification, NGP_CLASSIFICATIONS.OUTSTANDING);
  assert.equal(result.selectable, true);
});

test("street detail retains complete population and calculates counters", () => {
  const model = buildNonGpsBatchPlanningModel([
    makeRow({ id: "OUT" }),
    makeRow({ id: "BATCHED", tbRefs: [makeUnresolvedRef({ id: "TB_1" })] }),
    makeRow({ id: "DISC", tbRefs: [makeDiscoveredRef()] }),
  ]);
  const street = model.towns[0].streets[0];

  assert.equal(street.targets.length, 3);
  assert.deepEqual(street.counters, {
    total: 3,
    outstanding: 1,
    alreadyBatched: 1,
    discovered: 1,
  });
});

test("every No-GPS row is visible in exactly one planning or exception view", () => {
  const model = buildNonGpsBatchPlanningModel([
    makeRow({ id: "STREET" }),
    makeRow({ id: "EXCEPTION", strName: "" }),
    makeRow({
      id: "UNPLACED_DISCOVERED",
      town: "",
      strNo: "",
      strName: "",
      tbRefs: [makeDiscoveredRef()],
    }),
  ]);
  const visibleRows = [
    ...model.streetPlanningTargets,
    ...model.exceptions,
  ].map((target) => target.row);

  assert.equal(model.reconciles, true);
  assert.equal(visibleRows.length, model.noGpsTargets.length);
  assert.equal(new Set(visibleRows).size, model.noGpsTargets.length);
  assert.equal(model.unplacedTargets.length, 1);
  assert.equal(
    model.unplacedTargets[0].classification,
    NGP_CLASSIFICATIONS.DISCOVERED,
  );
  assert.ok(model.exceptions.includes(model.unplacedTargets[0]));
});

test("visibility reconciliation fails when any No-GPS row is omitted", () => {
  const model = buildNonGpsBatchPlanningModel([
    makeRow({ id: "A" }),
    makeRow({ id: "B", strName: "" }),
  ]);

  assert.equal(
    reconcileNgpVisibility(
      model.noGpsTargets,
      model.streetPlanningTargets,
      [],
    ),
    false,
  );
});

test("selection requires 1-20 unique Outstanding targets and may combine streets", () => {
  const model = buildNonGpsBatchPlanningModel([
    makeRow({ id: "A", strNo: "1" }),
    makeRow({ id: "B", strNo: "2" }),
    makeRow({ id: "C", town: "Glencoe", strNo: "1" }),
    makeRow({ id: "D", tbRefs: [makeUnresolvedRef({ id: "TB_1" })] }),
  ]);
  const dundeeStreet = model.towns.find((town) => town.town === "Dundee").streets[0];
  const glencoeStreet = model.towns.find((town) => town.town === "Glencoe").streets[0];
  const outstanding = dundeeStreet.targets.filter(
    (target) => target.classification === NGP_CLASSIFICATIONS.OUTSTANDING,
  );
  const alreadyBatched = dundeeStreet.targets.find(
    (target) => target.classification === NGP_CLASSIFICATIONS.ALREADY_BATCHED,
  );

  assert.equal(validateNgpSelection([]).code, "NGP_SELECTION_EMPTY");
  assert.equal(validateNgpSelection(outstanding).ok, true);
  assert.equal(
    validateNgpSelection([outstanding[0], alreadyBatched]).code,
    "NGP_SELECTION_NOT_OUTSTANDING",
  );
  assert.equal(
    validateNgpSelection([outstanding[0], glencoeStreet.targets[0]]).ok,
    true,
  );
  assert.equal(
    validateNgpSelection([outstanding[0], outstanding[0]]).code,
    "NGP_SELECTION_DUPLICATE",
  );

  const tooMany = Array.from({ length: NGP_SELECTION_MAX + 1 }, (_, index) => ({
    ...outstanding[0],
    id: `SELECT_${index}`,
  }));
  assert.equal(validateNgpSelection(tooMany).code, "NGP_SELECTION_TOO_LARGE");
});

test("street selection fills only remaining batch capacity and toggles a fully selected street off", () => {
  const model = buildNonGpsBatchPlanningModel(
    Array.from({ length: 25 }, (_, index) =>
      makeRow({
        id: `STREET_${index + 1}`,
        strNo: String(index + 1),
        strName: "Ann",
      }),
    ),
  );
  const street = model.towns[0].streets[0];

  const first = updateNgpStreetSelection({
    selectedIds: new Set(),
    streetTargets: street.targets,
  });

  assert.equal(first.selectedIds.size, 20);
  assert.equal(first.streetSelectedCount, 20);
  assert.equal(first.filledToCapacity, true);

  const partialToggledOff = updateNgpStreetSelection({
    selectedIds: first.selectedIds,
    streetTargets: street.targets,
  });
  assert.equal(partialToggledOff.selectedIds.size, 0);
  assert.equal(partialToggledOff.removedCount, 20);
  assert.equal(partialToggledOff.streetSelectedCount, 0);
  assert.equal(partialToggledOff.filledToCapacity, false);

  const narrowedStreet = {
    targets: street.targets.slice(0, 3),
  };
  const threeSelected = updateNgpStreetSelection({
    selectedIds: new Set(),
    streetTargets: narrowedStreet.targets,
  });
  assert.equal(threeSelected.selectedIds.size, 3);

  const toggledOff = updateNgpStreetSelection({
    selectedIds: threeSelected.selectedIds,
    streetTargets: narrowedStreet.targets,
  });
  assert.equal(toggledOff.selectedIds.size, 0);
  assert.equal(toggledOff.removedCount, 3);
});

test("NGP draft plan creates exactly one 1-20 PREPAID_SALES batch without ward scope", () => {
  const model = buildNonGpsBatchPlanningModel([
    makeRow({ id: "A100", town: "Dundee", strNo: "1", strName: "Acacia" }),
    makeRow({ id: "B200", town: "Dundee", strNo: "2", strName: "Albert" }),
  ]);
  const targets = model.streetPlanningTargets.filter(
    (target) => target.classification === NGP_CLASSIFICATIONS.OUTSTANDING,
  );

  const result = buildNgpTargetedBatchDraftPlan({
    targets,
    tbId: "TGB_20260816_044220_AB12",
    lmPcode: "ZA5241",
    lmName: "Endumeni",
  });

  assert.equal(result.ok, true);
  assert.equal(result.draft.proposedBatches.length, 1);
  assert.equal(result.draft.displayRows.length, 2);
  assert.equal(
    result.draft.selection.planningMode,
    NGP_TARGETED_BATCH_PLANNING_MODE,
  );
  assert.equal(result.draft.proposedBatches[0].scope.wardPcode, "");
  assert.equal(result.draft.proposedBatches[0].scope.wardNumber, "");
  assert.deepEqual(
    result.draft.authoritativeIds.salesAllMeterIds,
    result.draft.displayRows.map((row) => row.salesAllMeterId),
  );
});


test("current regression shape reconciles 10,216 → 7,583 + 2,633 and 2,633 → 2,567 + 66", () => {
  const rows = [];

  for (let index = 0; index < 7_583; index += 1) {
    rows.push(makeRow({ id: `GPS_${index}`, gps: true }));
  }

  for (let index = 0; index < 2_567; index += 1) {
    rows.push(
      makeRow({
        id: `NGP_${index}`,
        gps: false,
        strNo: String(index + 1),
        strName: `Street ${Math.floor(index / 20) + 1}`,
      }),
    );
  }

  for (let index = 0; index < 66; index += 1) {
    rows.push(
      makeRow({
        id: `EX_${index}`,
        gps: false,
        strNo: "",
        strName: "",
        strType: "-",
      }),
    );
  }

  const model = buildNonGpsBatchPlanningModel(rows);

  assert.deepEqual(model.gpsSummary, {
    total: 10_216,
    usableGps: 7_583,
    noGps: 2_633,
  });
  assert.deepEqual(model.counts, {
    noGps: 2_633,
    streetEligible: 2_567,
    exceptions: 66,
  });
  assert.equal(model.reconciles, true);
});

import { readFileSync } from "node:fs";

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Sales normalizer exposes authoritative adr and TB reference integrity", () => {
  const source = readSource("../../../redux/salesApi.js");

  assert.match(source, /adr:\s*normalizeAuthoritativeAddress\(data\.adr\)/);
  assert.match(source, /strNo:\s*String\(value\.strNo \?\? ""\)/);
  assert.match(source, /strName:\s*String\(value\.strName \?\? ""\)/);
  assert.match(source, /strType:\s*String\(value\.strType \?\? ""\)/);
  assert.match(source, /tbRefsIntegrity:\s*inspectSalesTbRefsIntegrity/);
});

test("Exceptions view displays canonical adr without legacy address precedence", () => {
  const source = readSource("../components/NonGpsExceptions.jsx");

  assert.match(
    source,
    /target\.canonicalAddress \|\| "Unresolved canonical address"/,
  );
  assert.doesNotMatch(source, /target\.row\?\.addressLine1/);
  assert.equal(
    formatAuthoritativeAddress(
      makeRow({ strNo: "34", strName: "Bulwer", strType: "-" }),
    ),
    "34 Bulwer",
  );
});

test("Sales page and table share the GPS model and block No-GPS selection", () => {
  const salesPage = readSource("../PrepaidSales.jsx");
  const table = readSource("../components/SalesMetersTable.jsx");

  assert.match(salesPage, /from "\.\/models\/salesGpsModel"/);
  assert.match(table, /from "\.\.\/models\/salesGpsModel"/);
  assert.match(table, /disabled=\{!hasUsableSalesGps\(row\)\}/);
  assert.match(table, /No GPS — use Non GPS Batch Planning/);
  assert.match(
    table,
    /\.filter\(\(row\) => hasUsableSalesGps\(row\)\)[\s\S]*\.map\(\(row\) => row\.id\)/,
  );
});

test("NGP route and Sales navigation entry are management-side only", () => {
  const routes = readSource("../../../routes/AppRoutes.jsx");
  const layout = readSource("../../../layouts/ConsoleLayout.jsx");

  assert.match(routes, /path="\/sales\/non-gps-batch-planning"/);
  assert.match(routes, /<NonGpsBatchPlanningPage \/>/);
  assert.match(layout, /label: "Non GPS Batch Planning"/);
  assert.match(layout, /path: "\/sales\/non-gps-batch-planning"/);
});

test("NGP React page reuses salesApi and opens no direct Firestore listener", () => {
  const page = readSource("../NonGpsBatchPlanningPage.jsx");
  const planning = readSource("../components/NonGpsStreetPlanning.jsx");
  const detail = readSource("../components/NonGpsStreetDetail.jsx");
  const exceptions = readSource("../components/NonGpsExceptions.jsx");
  const allNgpSource = [page, planning, detail, exceptions].join("\n");

  assert.match(page, /useGetSalesByLmPcodeQuery/);
  assert.doesNotMatch(allNgpSource, /from "firebase\/firestore"/);
  assert.doesNotMatch(allNgpSource, /onSnapshot\s*\(/);
  assert.doesNotMatch(allNgpSource, /getDocs\s*\(/);
});

test("NGP implementation contains no Allocation or Mobile runtime dependency", () => {
  const files = [
    readSource("../NonGpsBatchPlanningPage.jsx"),
    readSource("../components/NonGpsStreetPlanning.jsx"),
    readSource("../components/NonGpsStreetDetail.jsx"),
    readSource("../components/NonGpsExceptions.jsx"),
    readSource("./nonGpsBatchPlanningModel.js"),
  ].join("\n");

  assert.doesNotMatch(files, /ireps-mobile/i);
  assert.doesNotMatch(files, /allocationCallable/i);
  assert.doesNotMatch(files, /TargetedBatchAllocationPage/);
});
