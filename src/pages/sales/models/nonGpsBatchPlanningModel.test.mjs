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
  evaluateNgpBatchability,
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
  masterVisibility = "",
  targetedBatchId,
} = {}) {
  return {
    id: id || `SALES_${Math.random()}`,
    meterNo: meterNo || id || "07100000000",
    accountNumber: accountNumber || `ACC_${id || "1"}`,
    lmPcode,
    masterVisibility,
    ...(targetedBatchId !== undefined ? { targetedBatchId } : {}),
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

function makeInProgressRef(overrides = {}) {
  const timestamp = { seconds: 1_700_000_000, nanoseconds: 0 };

  return {
    id: "TB_IP",
    date: timestamp,
    rowId: "TBR_IP_000001",
    fieldWork: {
      status: "IN_PROGRESS",
      updatedAt: timestamp,
    },
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

test("current membership decides the already-batched classification (TB-R037)", () => {
  assert.equal(
    classifyNonGpsSalesRow(makeRow({ id: "N", targetedBatchId: null, tbRefs: [makeUnresolvedRef()] }))
      .classification,
    NGP_CLASSIFICATIONS.OUTSTANDING,
  );
  assert.equal(
    classifyNonGpsSalesRow(makeRow({ id: "M", targetedBatchId: "TGB_20260912_100000_CURR" }))
      .classification,
    NGP_CLASSIFICATIONS.ALREADY_BATCHED,
  );
  const malformed = classifyNonGpsSalesRow(makeRow({ id: "X", targetedBatchId: "TGB_BAD" }));
  assert.equal(malformed.classification, NGP_CLASSIFICATIONS.EXCEPTION);
  assert.deepEqual(malformed.exceptionReasons, ["Current Targeted Batch ID is malformed"]);
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
    batchable: 1,
    notBatchable: 2,
    outstanding: 1,
    alreadyBatched: 1,
    discovered: 1,
    notStarted: 3,
    inProgress: 0,
    completed: 0,
  });
});

test("Town and Street counters use the canonical three-state Sales Meter Status", () => {
  const inProgressRef = makeInProgressRef();
  const inProgressIntegrity = inspectSalesTbRefsIntegrity([inProgressRef]);

  assert.equal(inProgressIntegrity.valid, true);

  const model = buildNonGpsBatchPlanningModel([
    makeRow({
      id: "NS_1",
      town: "Dundee",
      strNo: "1",
      strName: "Ann",
    }),
    makeRow({
      id: "IP_1",
      town: "Dundee",
      strNo: "2",
      strName: "Ann",
      tbRefs: [inProgressRef],
      tbRefsIntegrity: inProgressIntegrity,
    }),
    makeRow({
      id: "DONE_1",
      town: "Dundee",
      strNo: "3",
      strName: "Beaconsfield",
      masterVisibility: "VISIBLE",
    }),
    makeRow({
      id: "DONE_2",
      town: "Glencoe",
      strNo: "4",
      strName: "Smith",
      masterVisibility: "VISIBLE",
    }),
  ]);

  const dundee = model.towns.find((town) => town.town === "Dundee");
  const glencoe = model.towns.find((town) => town.town === "Glencoe");
  const ann = dundee.streets.find(
    (street) => street.streetLabel === "Ann Street",
  );
  const beaconsfield = dundee.streets.find(
    (street) => street.streetLabel === "Beaconsfield Street",
  );

  assert.deepEqual(
    ann.targets.map((target) => target.salesWorkStatus),
    ["NOT_STARTED", "IN_PROGRESS"],
  );
  assert.deepEqual(
    beaconsfield.targets.map((target) => target.salesWorkStatus),
    ["COMPLETED"],
  );
  assert.deepEqual(
    glencoe.streets[0].targets.map((target) => target.salesWorkStatus),
    ["COMPLETED"],
  );

  assert.equal(dundee.counters.total, 3);
  assert.equal(dundee.counters.notStarted, 1);
  assert.equal(dundee.counters.inProgress, 1);
  assert.equal(dundee.counters.completed, 1);
  assert.equal(
    dundee.counters.total,
    dundee.counters.notStarted +
      dundee.counters.inProgress +
      dundee.counters.completed,
  );

  for (const town of model.towns) {
    assert.equal(
      town.counters.total,
      town.counters.notStarted +
        town.counters.inProgress +
        town.counters.completed,
    );

    for (const street of town.streets) {
      assert.equal(
        street.counters.total,
        street.counters.notStarted +
          street.counters.inProgress +
          street.counters.completed,
      );
    }
  }
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

test("Batchable requires NOT_STARTED plus the current NGP planning gates", () => {
  const clean = makeRow({ id: "CLEAN" });
  assert.deepEqual(evaluateNgpBatchability(clean), {
    batchable: true,
    code: "BATCHABLE",
    reason: "Batchable Sales meter",
  });

  const completed = evaluateNgpBatchability(
    makeRow({ id: "DONE", masterVisibility: "VISIBLE" }),
  );
  assert.equal(completed.batchable, false);
  assert.equal(completed.code, "SALES_STATUS_COMPLETED");

  const inProgressRef = makeInProgressRef();
  const inProgress = evaluateNgpBatchability(
    makeRow({
      id: "IP",
      tbRefs: [inProgressRef],
      tbRefsIntegrity: inspectSalesTbRefsIntegrity([inProgressRef]),
    }),
  );
  assert.equal(inProgress.batchable, false);
  assert.equal(inProgress.code, "SALES_STATUS_IN_PROGRESS");

  const currentBatch = evaluateNgpBatchability(
    makeRow({ id: "CURRENT", targetedBatchId: "TGB_20260912_100000_CURR" }),
  );
  assert.equal(currentBatch.batchable, false);
  assert.equal(currentBatch.code, "CURRENT_TARGETED_BATCH");

  const releasedBatch = evaluateNgpBatchability(
    makeRow({ id: "RELEASED", targetedBatchId: null, tbRefs: [makeUnresolvedRef()] }),
  );
  assert.equal(releasedBatch.batchable, true);

  const malformedBatch = evaluateNgpBatchability(
    makeRow({ id: "MALFORMED", targetedBatchId: "TGB_BAD" }),
  );
  assert.equal(malformedBatch.batchable, false);
  assert.equal(malformedBatch.code, "TARGETED_BATCH_MEMBERSHIP_UNRESOLVED");

  const brokenRefs = evaluateNgpBatchability(
    makeRow({
      id: "BROKEN_REFS",
      targetedBatchId: null,
      tbRefsIntegrity: { valid: false, issues: ["malformed entry"] },
    }),
  );
  assert.equal(brokenRefs.batchable, false);
  assert.equal(brokenRefs.code, "TB_REFERENCE_INTEGRITY_INVALID");

  const legacyBatch = evaluateNgpBatchability(
    makeRow({ id: "LEGACY", tbRefs: [makeUnresolvedRef()] }),
  );
  assert.equal(legacyBatch.batchable, false);
  assert.equal(legacyBatch.code, "EXISTING_TARGETED_BATCH_REFERENCE");

  const invalidAddress = evaluateNgpBatchability(
    makeRow({ id: "BAD_ADDRESS", strNo: "" }),
  );
  assert.equal(invalidAddress.batchable, false);
  assert.equal(invalidAddress.code, "PLANNING_ADDRESS_INVALID");

  const gpsAvailable = evaluateNgpBatchability(
    makeRow({ id: "GPS", gps: true }),
  );
  assert.equal(gpsAvailable.batchable, false);
  assert.equal(gpsAvailable.code, "GPS_AVAILABLE");
});

test("selection requires 1-20 unique Batchable Sales meters and may combine streets", () => {
  const model = buildNonGpsBatchPlanningModel([
    makeRow({ id: "A", strNo: "1" }),
    makeRow({ id: "B", strNo: "2" }),
    makeRow({ id: "C", town: "Glencoe", strNo: "1" }),
    makeRow({ id: "D", tbRefs: [makeUnresolvedRef({ id: "TB_1" })] }),
  ]);
  const dundeeStreet = model.towns.find((town) => town.town === "Dundee").streets[0];
  const glencoeStreet = model.towns.find((town) => town.town === "Glencoe").streets[0];
  const batchable = dundeeStreet.targets.filter((target) => target.batchable);
  const alreadyBatched = dundeeStreet.targets.find(
    (target) => target.classification === NGP_CLASSIFICATIONS.ALREADY_BATCHED,
  );

  assert.equal(validateNgpSelection([]).code, "NGP_SELECTION_EMPTY");
  assert.equal(validateNgpSelection(batchable).ok, true);
  assert.equal(
    validateNgpSelection([batchable[0], alreadyBatched]).code,
    "NGP_SELECTION_NOT_BATCHABLE",
  );
  assert.equal(
    validateNgpSelection([batchable[0], glencoeStreet.targets[0]]).ok,
    true,
  );
  assert.equal(
    validateNgpSelection([batchable[0], batchable[0]]).code,
    "NGP_SELECTION_DUPLICATE",
  );

  const tooMany = Array.from({ length: NGP_SELECTION_MAX + 1 }, (_, index) => ({
    ...batchable[0],
    id: `SELECT_${index}`,
  }));
  assert.equal(validateNgpSelection(tooMany).code, "NGP_SELECTION_TOO_LARGE");
});

test("street selection tops up partial selection and never silently truncates to capacity", () => {
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

  const tooLarge = updateNgpStreetSelection({
    selectedIds: new Set(),
    streetTargets: street.targets,
  });
  assert.equal(tooLarge.selectedIds.size, 0);
  assert.equal(tooLarge.blockedByCapacity, true);
  assert.equal(tooLarge.requestedCount, 25);
  assert.equal(tooLarge.remainingCapacity, 20);

  const narrowedStreet = street.targets.slice(0, 3);
  const oneSelected = new Set([narrowedStreet[0].id]);
  const toppedUp = updateNgpStreetSelection({
    selectedIds: oneSelected,
    streetTargets: narrowedStreet,
  });
  assert.equal(toppedUp.selectedIds.size, 3);
  assert.equal(toppedUp.addedCount, 2);
  assert.equal(toppedUp.removedCount, 0);
  assert.equal(toppedUp.blockedByCapacity, false);

  const toggledOff = updateNgpStreetSelection({
    selectedIds: toppedUp.selectedIds,
    streetTargets: narrowedStreet,
  });
  assert.equal(toggledOff.selectedIds.size, 0);
  assert.equal(toggledOff.removedCount, 3);

  const capacityBlocked = updateNgpStreetSelection({
    selectedIds: new Set(Array.from({ length: 18 }, (_, index) => `OTHER_${index}`)),
    streetTargets: narrowedStreet,
  });
  assert.equal(capacityBlocked.selectedIds.size, 18);
  assert.equal(capacityBlocked.blockedByCapacity, true);
  assert.equal(capacityBlocked.requestedCount, 3);
  assert.equal(capacityBlocked.remainingCapacity, 2);
});

test("NGP draft plan creates exactly one 1-20 PREPAID_SALES batch without ward scope", () => {
  const model = buildNonGpsBatchPlanningModel([
    makeRow({ id: "A100", town: "Dundee", strNo: "1", strName: "Acacia" }),
    makeRow({ id: "B200", town: "Dundee", strNo: "2", strName: "Albert" }),
  ]);
  const targets = model.streetPlanningTargets.filter(
    (target) => target.batchable === true,
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

test("NGP tables display canonical Sales Meter Status columns", () => {
  const planning = readSource("../components/NonGpsStreetPlanning.jsx");
  const detail = readSource("../components/NonGpsStreetDetail.jsx");

  assert.match(planning, /label="Not Started"/);
  assert.match(planning, /label="In Progress"/);
  assert.match(planning, /label="Completed"/);
  assert.match(planning, /town\.counters\.notStarted/);
  assert.match(planning, /street\.counters\.notStarted/);
  assert.match(planning, /Sales Meter Status/);
  assert.match(planning, /SalesStatusSummary counters=\{townStatusCounters\}/);
  assert.match(planning, /counters=\{selectedTown\.counters\}/);
  assert.match(planning, /allLabel="All towns"/);
  assert.match(planning, /ariaLabel="Filter Town \/ Area"/);
  assert.match(planning, /options=\{townOptions\}/);
  assert.match(planning, /!townFilters\.town \|\| town\.town === townFilters\.town/);
  assert.doesNotMatch(planning, /label="Outstanding"/);
  assert.doesNotMatch(planning, /label="Already Batched"/);
  assert.doesNotMatch(planning, /label="Discovered"/);

  assert.match(detail, /label="Sales Meter Status"/);
  assert.match(detail, /\{target\.salesWorkStatus\}/);
  assert.doesNotMatch(detail, />Account Number</);
  assert.doesNotMatch(detail, />Planning Status</);
});

test("NGP tables use standard five-row pagination controls at top and bottom", () => {
  const planning = readSource("../components/NonGpsStreetPlanning.jsx");
  const detail = readSource("../components/NonGpsStreetDetail.jsx");

  assert.match(planning, /const DEFAULT_PAGE_SIZE = 5;/);
  assert.match(detail, /const DEFAULT_PAGE_SIZE = 5;/);

  assert.equal((planning.match(/<PaginationControls/g) || []).length, 4);
  assert.equal((detail.match(/<PaginationControls/g) || []).length, 2);

  assert.match(detail, /label="Address"/);
  assert.match(detail, /label="Meter Number"/);
  assert.match(detail, /label="Sales Meter Status"/);
  assert.match(detail, /placeholder="Filter address"/);
  assert.match(detail, /placeholder="Filter meter number"/);
  assert.match(detail, /aria-label="Filter Sales Meter Status"/);
  assert.match(detail, /All statuses/);
});

test("NGP checkbox and selection bar follow the shared Targeted Batch rules", () => {
  const page = readSource("../NonGpsBatchPlanningPage.jsx");
  const planning = readSource("../components/NonGpsStreetPlanning.jsx");
  const detail = readSource("../components/NonGpsStreetDetail.jsx");
  const model = readSource("./nonGpsBatchPlanningModel.js");

  assert.match(page, /target\.batchable === true/);
  assert.match(page, /Selection is retained while paging and filtering\./);
  assert.match(page, />\s*Clear Selection\s*</);
  assert.match(page, />\s*Download Selected\s*</);
  assert.match(page, />\s*Create Target Batch\s*</);
  assert.match(page, /quickDownloadExcel\(/);
  assert.match(page, /position: "fixed"/);
  assert.doesNotMatch(page, /Review Targeted Batch/);
  assert.doesNotMatch(page, /Selected:\s*\{/);
  assert.doesNotMatch(page, /Select Outstanding meters/);

  assert.match(planning, /target\?\.batchable === true/);
  assert.match(planning, /batchable Sales meters/);
  assert.doesNotMatch(planning, /Select Outstanding meters/);

  assert.match(detail, /const batchable = target\.batchable === true/);
  assert.match(detail, /disabled=\{!batchable\}/);
  assert.match(detail, /target\.batchabilityReason/);
  assert.doesNotMatch(detail, /selectionAtCapacity|selectableNow/);
  assert.match(page, /nextSelectedIds.size >= NGP_SELECTION_MAX/);
  assert.doesNotMatch(detail, /Select Outstanding target/);

  assert.match(model, /CHECKBOX|batchable/);
  assert.match(model, /blockedByCapacity/);
  assert.doesNotMatch(model, /\.slice\(0, capacity\)/);
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
  assert.match(page, /useGetSalesByLmPcodeQuery\(activeLmPcode \? \{ lmPcode: activeLmPcode \} : skipToken\)/);
  assert.doesNotMatch(allNgpSource, /useGetSalesGovernanceQuery|useGetSalesCategoryViewQuery/);
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

test("membership, status, counters and Batch ID share one target result", () => {
  const refs = [makeUnresolvedRef({ id: "TB_A" })];
  const ip = makeInProgressRef();
  const rows = [
    makeRow({ id: "NONE" }),
    makeRow({ id: "MEMBER", tbRefs: refs }),
    makeRow({ id: "IP", tbRefs: [ip], tbRefsIntegrity: inspectSalesTbRefsIntegrity([ip]) }),
    makeRow({ id: "DONE_MEMBER", masterVisibility: "VISIBLE", tbRefs: refs }),
    makeRow({ id: "DONE_NONE", masterVisibility: "VISIBLE" }),
    makeRow({ id: "UNRESOLVED", tbRefs: [makeUnresolvedRef({ id: "TB_A" }), makeUnresolvedRef({ id: "TB_B" })] }),
  ];
  const model = buildNonGpsBatchPlanningModel(rows);
  const targets = model.streetPlanningTargets;
  assert.equal(targets.find(t => t.id === "NONE").batchable, true);
  assert.ok(targets.filter(t => t.id !== "NONE").every(t => !t.batchable));
  assert.equal(targets.find(t => t.id === "UNRESOLVED").membership.state, "UNRESOLVED");
  for (const counters of [model.towns[0].counters, model.towns[0].streets[0].counters]) {
    assert.equal(counters.batchable, 1);
    assert.equal(counters.notBatchable, 5);
    assert.equal(counters.batchable + counters.notBatchable, counters.total);
  }
  assert.ok(targets.filter(t => t.membership.state === "MEMBER").every(t => t.membership.tbId && !t.batchable));
});

test("batching counts cover all towns and do not depend on selection capacity", () => {
  const rows = Array.from({ length: 24 }, (_, i) => makeRow({ id: "M" + i, town: i < 22 ? "Dundee" : "Glencoe" }));
  const model = buildNonGpsBatchPlanningModel(rows);
  const before = JSON.stringify(model.towns.map(t => t.counters));
  const update = updateNgpStreetSelection({ selectedIds: new Set(Array.from({ length: 20 }, (_, i) => "M" + i)),
    streetTargets: model.towns[0].streets[0].targets });
  assert.equal(update.blockedByCapacity, true);
  assert.equal(update.selectedIds.size, 20);
  assert.equal(JSON.stringify(model.towns.map(t => t.counters)), before);
  assert.equal(model.towns.reduce((n, t) => n + t.counters.batchable, 0), 24);
});

test("visibility columns, KPI context, dropdown and modal wiring stay narrow", () => {
  const planning = readSource("../components/NonGpsStreetPlanning.jsx");
  const detail = readSource("../components/NonGpsStreetDetail.jsx");
  const summary = readSource("../components/NonGpsBatchingSummary.jsx");
  const modal = readSource("../components/SalesTargetedBatchDetailsModal.jsx");
  for (const key of ["batchable", "notBatchable"]) {
    assert.ok(planning.includes('sortKey="' + key + '"'));
    assert.ok(planning.includes('filters.' + key));
    assert.ok(planning.includes('matchesCountFilter(town.counters.' + key));
    assert.ok(planning.includes('matchesCountFilter(street.counters.' + key));
  }
  assert.equal((planning.match(/colSpan=\{8\}/g) || []).length, 2);
  assert.match(detail, /colSpan=\{5\}/);
  assert.match(detail, /aria-label="Filter Batch ID"/);
  assert.match(planning, /NonGpsBatchingSummary counters=\{townStatusCounters\}/);
  assert.match(planning, /NonGpsBatchingSummary counters=\{selectedTown.counters\}/);
  assert.match(detail, /NonGpsBatchingSummary counters=\{street.counters\}/);
  assert.match(summary, /TARGETED BATCHING/);
  assert.doesNotMatch(summary, /selectedIds|capacity/);
  assert.match(modal, /useGetTargetedBatchDetailsByIdQuery/);
  assert.match(modal, /Not recorded/);
  assert.doesNotMatch(modal, /firebase\/firestore|onSnapshot|getDocs|tbRefs|allocation|acceptance/);
  assert.doesNotMatch(detail, /target\.row\??\.tbRefs/);
});
