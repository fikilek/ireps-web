import { SALES_BATCH_MAX, SALES_CATEGORY_CODES, evaluateSalesBatchability, newestSalesCategoryMonth, salesCategoryKind } from "../../../../functions/salesAllMeters/sales-batch-policy.js";
import {
  hasUsableSalesGps,
  isSalesWithoutUsableGps,
} from "./salesGpsModel.js";
import { SALES_STATUSES } from "./salesStatusModel.js";
import { classifySalesTableWorkStatus } from "./salesTableWorkStatusModel.js";
import { resolveSalesTargetedBatchMembership } from "./salesTargetedBatchMembershipModel.js";

export const NGP_CLASSIFICATIONS = Object.freeze({
  DISCOVERED: "DISCOVERED",
  EXCEPTION: "EXCEPTION",
  ALREADY_BATCHED: "ALREADY_BATCHED",
  OUTSTANDING: "OUTSTANDING",
});

export const NGP_SELECTION_MAX = SALES_BATCH_MAX;
export const NGP_TARGETED_BATCH_PLANNING_MODE = "ERF_GEOFENCE";

export function normalizePlanningKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function displayText(value) {
  return String(value ?? "").trim();
}

export function formatAuthoritativeAddress(row = {}) {
  const strNo = String(row?.adr?.strNo ?? "");
  const strName = String(row?.adr?.strName ?? "");
  const strType = String(row?.adr?.strType ?? "");
  const displayedType = strType.trim() === "-" ? "" : strType;

  return [strNo, strName, displayedType]
    .filter((value) => String(value).trim() !== "")
    .join(" ");
}

export function formatStreetLabel(row = {}) {
  const strName = String(row?.adr?.strName ?? "");
  const strType = String(row?.adr?.strType ?? "");
  const displayedType = strType.trim() === "-" ? "" : strType;

  return [strName, displayedType]
    .filter((value) => String(value).trim() !== "")
    .join(" ");
}

export function compareNaturalValues(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function compareStreetNumbers(left, right) {
  const leftNumber = displayText(left?.adr?.strNo ?? left);
  const rightNumber = displayText(right?.adr?.strNo ?? right);
  const primary = compareNaturalValues(leftNumber, rightNumber);

  if (primary !== 0) return primary;

  return compareNaturalValues(left?.meterNo, right?.meterNo);
}

export function hasCompletedMeterDiscovery(row = {}) {
  return classifySalesTableWorkStatus(row) === SALES_STATUSES.COMPLETED;
}

// Rules TB-R046 (1.3.28): categoryMonth is the LM's newest category month (the newest month among
// all of the LM's meters); only CAT meters are batchable.
export function evaluateNgpBatchability(row = {}, categoryMonth) {
  return evaluateSalesBatchability(row, { source: "PREPAID_SALES_NON_GPS", categoryMonth });
}

// A meter whose only obstacle is its category (Normal or no category) keeps its planning place: it is
// never an exception, it is just never tickable.
const blockedOnlyByCategory = result => SALES_CATEGORY_CODES.includes(result?.code);

export function classifyNonGpsSalesRow(row = {}, categoryMonth) {
  if (hasUsableSalesGps(row)) return { classification: null, exceptionReasons: [], selectable: false };
  const status = classifySalesTableWorkStatus(row);
  if (status === SALES_STATUSES.COMPLETED) return { classification: NGP_CLASSIFICATIONS.DISCOVERED, exceptionReasons: [], selectable: false };
  if (status === SALES_STATUSES.IN_PROGRESS) return { classification: NGP_CLASSIFICATIONS.ALREADY_BATCHED, exceptionReasons: [], selectable: false };
  const membership = resolveSalesTargetedBatchMembership(row);
  const result = evaluateNgpBatchability(row, categoryMonth);
  // Keep valid historical ambiguity visible in its street, with the separate
  // membership value still UNRESOLVED and Batchability still false.
  const withoutMembership = evaluateNgpBatchability({ ...row, targetedBatchId: null }, categoryMonth);
  const visibleLegacyAmbiguity = membership.state === "UNRESOLVED" && membership.source === "LEGACY_TBREFS" && (withoutMembership.batchable || blockedOnlyByCategory(withoutMembership));
  if (membership.state === "MEMBER" || visibleLegacyAmbiguity) return { classification: NGP_CLASSIFICATIONS.ALREADY_BATCHED, exceptionReasons: [], selectable: false };
  const outstanding = result.batchable || result.code === "NEEDS_MANUAL_ERFING" || blockedOnlyByCategory(result);
  return { classification: outstanding ? NGP_CLASSIFICATIONS.OUTSTANDING : NGP_CLASSIFICATIONS.EXCEPTION, exceptionReasons: result.batchable ? [] : [result.reason], selectable: result.batchable };
}

function buildTarget(row, categoryMonth) {
  const classification = classifyNonGpsSalesRow(row, categoryMonth);
  const salesWorkStatus = classifySalesTableWorkStatus(row);
  const membership = resolveSalesTargetedBatchMembership(row);
  const batchability = evaluateNgpBatchability(row, categoryMonth);
  const townKey = normalizePlanningKey(row?.town);
  const streetNameKey = normalizePlanningKey(row?.adr?.strName);

  return {
    row,
    id: String(row?.id || ""),
    meterNo: String(row?.meterNo || ""),
    accountNumber: String(row?.accountNumber || ""),
    town: String(row?.town || ""),
    townKey,
    streetNameKey,
    streetKey:
      townKey && streetNameKey ? `${townKey}::${streetNameKey}` : "",
    streetLabel: formatStreetLabel(row),
    canonicalAddress: formatAuthoritativeAddress(row),
    salesWorkStatus,
    classification: classification.classification,
    exceptionReasons: classification.exceptionReasons,
    membership,
    batchable: batchability.batchable,
    batchabilityCode: batchability.code,
    batchabilityReason: batchability.reason,
    // Rules TB-R046: CAT, NORMAL or NONE (no category in the LM's newest month).
    category: salesCategoryKind(row, categoryMonth).kind,
    // Transitional alias for older NGP consumers. Checkbox logic must use
    // batchable rather than the legacy OUTSTANDING classification.
    selectable: batchability.batchable,
  };
}

function incrementCounters(counters, classification, salesWorkStatus, batchable) {
  counters.total += 1;
  if (batchable) counters.batchable += 1;
  else counters.notBatchable += 1;

  if (classification === NGP_CLASSIFICATIONS.OUTSTANDING) {
    counters.outstanding += 1;
  } else if (classification === NGP_CLASSIFICATIONS.ALREADY_BATCHED) {
    counters.alreadyBatched += 1;
  } else if (classification === NGP_CLASSIFICATIONS.DISCOVERED) {
    counters.discovered += 1;
  }

  if (salesWorkStatus === SALES_STATUSES.NOT_STARTED) {
    counters.notStarted += 1;
  } else if (salesWorkStatus === SALES_STATUSES.IN_PROGRESS) {
    counters.inProgress += 1;
  } else if (salesWorkStatus === SALES_STATUSES.COMPLETED) {
    counters.completed += 1;
  }
}

function createCounters() {
  return {
    total: 0,
    batchable: 0,
    notBatchable: 0,
    outstanding: 0,
    alreadyBatched: 0,
    discovered: 0,
    notStarted: 0,
    inProgress: 0,
    completed: 0,
  };
}

// Rules TB-R046 (1.3.28): CAT / Normal / No cat split of a list of targets.
function categorySplit(targets = []) {
  return targets.reduce((split, target) => {
    if (target.category === "CAT") split.cat += 1;
    else if (target.category === "NORMAL") split.normal += 1;
    else split.none += 1;
    return split;
  }, { cat: 0, normal: 0, none: 0 });
}

// Towns and their streets, with counters, for the targets given.
function groupTownsAndStreets(streetEligibleTargets = []) {
  const townsByKey = new Map();

  streetEligibleTargets.forEach((target) => {
    let town = townsByKey.get(target.townKey);

    if (!town) {
      town = {
        key: target.townKey,
        town: target.town,
        counters: createCounters(),
        streetsByKey: new Map(),
      };
      townsByKey.set(target.townKey, town);
    }

    let street = town.streetsByKey.get(target.streetKey);

    if (!street) {
      street = {
        key: target.streetKey,
        townKey: target.townKey,
        town: target.town,
        streetNameKey: target.streetNameKey,
        streetLabel: target.streetLabel,
        counters: createCounters(),
        targets: [],
      };
      town.streetsByKey.set(target.streetKey, street);
    }

    street.targets.push(target);
    incrementCounters(
      street.counters,
      target.classification,
      target.salesWorkStatus,
      target.batchable,
    );
    incrementCounters(
      town.counters,
      target.classification,
      target.salesWorkStatus,
      target.batchable,
    );
  });

  return Array.from(townsByKey.values())
    .map((town) => {
      const streets = Array.from(town.streetsByKey.values())
        .map((street) => ({
          ...street,
          targets: [...street.targets].sort((left, right) =>
            compareStreetNumbers(left.row, right.row),
          ),
        }))
        .sort((left, right) =>
          compareNaturalValues(left.streetLabel, right.streetLabel),
        );

      return {
        key: town.key,
        town: town.town,
        counters: town.counters,
        streetCount: streets.length,
        streets,
      };
    })
    .sort((left, right) => compareNaturalValues(left.town, right.town));
}

// showNormal (rules TB-R046): the streets list only CAT meters unless Normal and uncategorised meters
// are asked for. The counts and the reconciliation always cover every No-GPS meter.
export function buildNonGpsBatchPlanningModel(rows = [], { showNormal = false } = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const categoryMonth = newestSalesCategoryMonth(sourceRows);
  const gpsSummary = sourceRows.reduce(
    (summary, row) => {
      summary.total += 1;

      if (hasUsableSalesGps(row)) summary.usableGps += 1;
      else summary.noGps += 1;

      return summary;
    },
    { total: 0, usableGps: 0, noGps: 0 },
  );

  const targets = sourceRows.filter(isSalesWithoutUsableGps).map((row) => buildTarget(row, categoryMonth));
  const classifiedExceptions = targets.filter(
    (target) => target.classification === NGP_CLASSIFICATIONS.EXCEPTION,
  );
  const streetEligibleTargets = targets.filter(
    (target) =>
      target.classification !== NGP_CLASSIFICATIONS.EXCEPTION &&
      target.townKey &&
      target.streetNameKey &&
      target.streetKey,
  );
  const unplacedTargets = targets
    .filter(
      (target) =>
        target.classification !== NGP_CLASSIFICATIONS.EXCEPTION &&
        (!target.townKey || !target.streetNameKey || !target.streetKey),
    )
    .map((target) => ({
      ...target,
      visibilityReasons: [
        "Planning location is incomplete; shown here to preserve complete No-GPS visibility",
      ],
    }));
  const exceptions = [
    ...classifiedExceptions.map((target) => ({
      ...target,
      visibilityReasons: target.exceptionReasons,
    })),
    ...unplacedTargets,
  ];
  const allTowns = groupTownsAndStreets(streetEligibleTargets);
  const towns = showNormal ? allTowns : groupTownsAndStreets(streetEligibleTargets.filter((target) => target.category === "CAT"));

  const streetPlanningTargets = allTowns.flatMap((town) =>
    town.streets.flatMap((street) => street.targets),
  );
  const reconciles = reconcileNgpVisibility(
    targets,
    streetPlanningTargets,
    exceptions,
  );

  return {
    gpsSummary,
    noGpsTargets: targets,
    streetEligibleTargets,
    streetPlanningTargets,
    classifiedExceptions,
    unplacedTargets,
    exceptions,
    towns,
    counts: {
      noGps: targets.length,
      streetEligible: streetEligibleTargets.length,
      exceptions: classifiedExceptions.length,
      // Rules TB-R046: the CAT / Normal / No cat split shown under each card.
      byCategory: {
        noGps: categorySplit(targets),
        streetEligible: categorySplit(streetEligibleTargets),
        exceptions: categorySplit(classifiedExceptions),
      },
    },
    categoryMonth,
    showNormal,
    hiddenFromStreets: showNormal ? 0 : streetEligibleTargets.filter((target) => target.category !== "CAT").length,
    visibilityCounts: {
      streetPlanning: streetPlanningTargets.length,
      exceptions: classifiedExceptions.length,
      unplaced: unplacedTargets.length,
      exceptionView: exceptions.length,
    },
    reconciles,
  };
}

export function reconcileNgpVisibility(
  noGpsTargets = [],
  streetPlanningTargets = [],
  exceptionViewTargets = [],
) {
  const source = Array.isArray(noGpsTargets) ? noGpsTargets : [];
  const streetVisible = Array.isArray(streetPlanningTargets)
    ? streetPlanningTargets
    : [];
  const exceptionVisible = Array.isArray(exceptionViewTargets)
    ? exceptionViewTargets
    : [];
  const sourceRows = new Set(source.map((target) => target?.row));
  const streetRows = streetVisible.map((target) => target?.row);
  const exceptionRows = exceptionVisible.map((target) => target?.row);
  const allVisibleRows = [...streetRows, ...exceptionRows];
  const visibleRowSet = new Set(allVisibleRows);

  return (
    allVisibleRows.length === source.length &&
    visibleRowSet.size === sourceRows.size &&
    [...sourceRows].every((row) => visibleRowSet.has(row))
  );
}

export function validateNgpSelection(targets = []) {
  const selectedTargets = Array.isArray(targets) ? targets : [];

  if (selectedTargets.length < 1) {
    return {
      ok: false,
      code: "NGP_SELECTION_EMPTY",
      message: "Select at least one batchable Sales meter.",
    };
  }

  if (selectedTargets.length > NGP_SELECTION_MAX) {
    return {
      ok: false,
      code: "NGP_SELECTION_TOO_LARGE",
      message: `Select no more than ${NGP_SELECTION_MAX} batchable Sales meters.`,
    };
  }

  if (selectedTargets.some((target) => target?.batchable !== true)) {
    return {
      ok: false,
      code: "NGP_SELECTION_NOT_BATCHABLE",
      message: "Only batchable Sales meters may be selected.",
    };
  }

  const targetIds = selectedTargets
    .map((target) => String(target?.id || "").trim())
    .filter(Boolean);

  if (targetIds.length !== selectedTargets.length) {
    return {
      ok: false,
      code: "NGP_SELECTION_ID_MISSING",
      message: "Every selected target must have a Sales All Meters identity.",
    };
  }

  if (new Set(targetIds).size !== targetIds.length) {
    return {
      ok: false,
      code: "NGP_SELECTION_DUPLICATE",
      message: "The same Sales target may not appear more than once.",
    };
  }

  return {
    ok: true,
    code: "NGP_SELECTION_READY",
    message: `${selectedTargets.length} batchable Sales meter${
      selectedTargets.length === 1 ? "" : "s"
    } selected.`,
  };
}

function normalizeSelectedIdSet(selectedIds) {
  if (selectedIds instanceof Set) return new Set(selectedIds);
  if (Array.isArray(selectedIds)) return new Set(selectedIds);
  return new Set();
}

export function updateNgpStreetSelection({
  selectedIds,
  streetTargets = [],
  maxSelection = NGP_SELECTION_MAX,
}) {
  const nextSelectedIds = normalizeSelectedIdSet(selectedIds);
  const batchableTargets = (Array.isArray(streetTargets) ? streetTargets : [])
    .filter((target) => target?.batchable === true);
  const batchableIds = batchableTargets
    .map((target) => String(target?.id || "").trim())
    .filter(Boolean);
  const selectedStreetIds = batchableIds.filter((id) =>
    nextSelectedIds.has(id),
  );
  const allStreetBatchableSelected =
    batchableIds.length > 0 &&
    selectedStreetIds.length === batchableIds.length;

  if (allStreetBatchableSelected) {
    batchableIds.forEach((id) => nextSelectedIds.delete(id));

    return {
      selectedIds: nextSelectedIds,
      addedCount: 0,
      removedCount: selectedStreetIds.length,
      streetBatchableCount: batchableIds.length,
      streetSelectedCount: 0,
      blockedByCapacity: false,
      requestedCount: 0,
      remainingCapacity: Math.max(
        0,
        Number(maxSelection || NGP_SELECTION_MAX) - nextSelectedIds.size,
      ),
    };
  }

  const idsToAdd = batchableIds.filter((id) => !nextSelectedIds.has(id));
  const remainingCapacity = Math.max(
    0,
    Number(maxSelection || NGP_SELECTION_MAX) - nextSelectedIds.size,
  );

  if (idsToAdd.length > remainingCapacity) {
    return {
      selectedIds: nextSelectedIds,
      addedCount: 0,
      removedCount: 0,
      streetBatchableCount: batchableIds.length,
      streetSelectedCount: selectedStreetIds.length,
      blockedByCapacity: true,
      requestedCount: idsToAdd.length,
      remainingCapacity,
    };
  }

  idsToAdd.forEach((id) => nextSelectedIds.add(id));

  return {
    selectedIds: nextSelectedIds,
    addedCount: idsToAdd.length,
    removedCount: 0,
    streetBatchableCount: batchableIds.length,
    streetSelectedCount: batchableIds.length,
    blockedByCapacity: false,
    requestedCount: idsToAdd.length,
    remainingCapacity: Math.max(
      0,
      Number(maxSelection || NGP_SELECTION_MAX) - nextSelectedIds.size,
    ),
  };
}

function describeQuickSelect({
  requestedCount,
  tickedCount,
  availableCount,
  otherSelectedCount,
  limitedBy,
  maxSelection,
}) {
  if (limitedBy === "AVAILABLE") {
    if (availableCount === 0) return "No meters on this list can be ticked.";
    return `You asked for ${requestedCount}, but only ${availableCount} meter${
      availableCount === 1 ? "" : "s"
    } on this list can be ticked. ${
      availableCount === 1 ? "It is" : `All ${availableCount} are`
    } ticked.`;
  }

  if (limitedBy === "CAPACITY") {
    const others = `${otherSelectedCount} meter${
      otherSelectedCount === 1 ? " is" : "s are"
    } already ticked on other streets`;
    if (tickedCount === 0) {
      return `${others}. One batch holds at most ${maxSelection} meters, so none were ticked here. Untick some first.`;
    }
    return `You asked for ${requestedCount}, but ${others}. One batch holds at most ${maxSelection} meters, so ${tickedCount} ${
      tickedCount === 1 ? "was" : "were"
    } ticked here.`;
  }

  return "";
}

// Quick select: tick the first `count` batchable meters of `orderedTargets`
// (the street list as shown, sorted by address) as if ticked by hand. It
// replaces this street's ticks; ticks on other streets stay and count
// towards the batch limit.
export function quickSelectNgpStreetTargets({
  selectedIds,
  streetTargets = [],
  orderedTargets = [],
  count,
  maxSelection = NGP_SELECTION_MAX,
}) {
  const max = Number(maxSelection || NGP_SELECTION_MAX);
  const requestedCount = Number(count);
  const unchanged = normalizeSelectedIdSet(selectedIds);

  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > max) {
    return {
      ok: false,
      selectedIds: unchanged,
      message: `Enter a number from 1 to ${max}.`,
    };
  }

  const streetIds = new Set(
    (Array.isArray(streetTargets) ? streetTargets : [])
      .map((target) => String(target?.id || "").trim())
      .filter(Boolean),
  );
  const nextSelectedIds = new Set([...unchanged].filter((id) => !streetIds.has(id)));
  const otherSelectedCount = nextSelectedIds.size;
  const remainingCapacity = Math.max(0, max - otherSelectedCount);

  const candidateIds = [
    ...new Set(
      (Array.isArray(orderedTargets) ? orderedTargets : [])
        .filter((target) => target?.batchable === true)
        .map((target) => String(target?.id || "").trim())
        .filter((id) => id && streetIds.has(id)),
    ),
  ];

  const tickedCount = Math.min(requestedCount, remainingCapacity, candidateIds.length);
  candidateIds.slice(0, tickedCount).forEach((id) => nextSelectedIds.add(id));

  const limitedBy =
    tickedCount === requestedCount
      ? null
      : remainingCapacity <= candidateIds.length
        ? "CAPACITY"
        : "AVAILABLE";

  const result = {
    ok: true,
    selectedIds: nextSelectedIds,
    requestedCount,
    tickedCount,
    availableCount: candidateIds.length,
    otherSelectedCount,
    remainingCapacity,
    limitedBy,
  };

  return { ...result, message: describeQuickSelect({ ...result, maxSelection: max }) };
}

function compareNgpTargets(left, right) {
  const townComparison = compareNaturalValues(left?.town, right?.town);
  if (townComparison !== 0) return townComparison;

  const streetComparison = compareNaturalValues(
    left?.streetLabel,
    right?.streetLabel,
  );
  if (streetComparison !== 0) return streetComparison;

  return compareStreetNumbers(left?.row, right?.row);
}

function getSelectionPeriod(targets, field, direction) {
  const values = targets
    .map((target) => String(target?.row?.[field] || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  if (values.length === 0) return null;
  return direction === "latest" ? values[values.length - 1] : values[0];
}

export function buildNgpTargetedBatchDraftPlan({
  targets = [],
  tbId,
  lmPcode,
  lmName,
  selectionReason = "Selected from Non-GPS Sales Table",
}) {
  const selectedTargets = [...(Array.isArray(targets) ? targets : [])].sort(
    compareNgpTargets,
  );
  const selectionValidation = validateNgpSelection(selectedTargets);

  if (!selectionValidation.ok) {
    return {
      ok: false,
      code: selectionValidation.code,
      message: selectionValidation.message,
      errors: [selectionValidation.message],
    };
  }

  const normalizedTbId = String(tbId || "").trim().toUpperCase();
  const normalizedLmPcode = String(lmPcode || "").trim().toUpperCase();

  if (!/^TGB_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$/.test(normalizedTbId)) {
    return {
      ok: false,
      code: "NGP_TB_ID_INVALID",
      message: "A valid Targeted Batch ID is required.",
      errors: ["A valid Targeted Batch ID is required."],
    };
  }

  if (!/^ZA[0-9]+$/.test(normalizedLmPcode)) {
    return {
      ok: false,
      code: "NGP_LM_SCOPE_INVALID",
      message: "A valid active Local Municipality is required.",
      errors: ["A valid active Local Municipality is required."],
    };
  }

  const mismatchedLmTargets = selectedTargets.filter(
    (target) =>
      String(target?.row?.lmPcode || "")
        .trim()
        .toUpperCase() !== normalizedLmPcode,
  );

  if (mismatchedLmTargets.length > 0) {
    return {
      ok: false,
      code: "NGP_LM_SCOPE_MISMATCH",
      message: "Every selected target must belong to the active LM.",
      errors: ["Every selected target must belong to the active LM."],
    };
  }

  const draftBatchKey = `NGP::${normalizedTbId}`;
  const creationGroupId = normalizedTbId.replace(/^TGB_/, "TBCG_");
  const salesAllMeterIds = selectedTargets.map((target) =>
    String(target.id || "").trim(),
  );

  const rows = selectedTargets.map((target, index) => {
    const sourceRow = target.row || {};
    const adr = sourceRow.adr || {};

    return {
      id: target.id,
      rowNo: String(index + 1),
      batchRowNo: String(index + 1),
      salesAllMeterId: target.id,
      sourceSalesAllMeterId: target.id,
      meterNo: target.meterNo,
      meterNoNormalized: sourceRow.meterNoNormalized || target.meterNo,
      accountNumber: target.accountNumber,
      customerName: sourceRow.customerName || "",
      addressLine1: target.canonicalAddress,
      town: target.town,
      lmPcode: normalizedLmPcode,
      actionReason: selectionReason,
      totalSalesC: sourceRow.totalSalesC || 0,
      latestMonthSalesC: sourceRow.latestMonthSalesC || 0,
      sales3MonthsC: sourceRow.sales3MonthsC || 0,
      sales6MonthsC: sourceRow.sales6MonthsC || 0,
      sales12MonthsC:
        sourceRow.sales12MonthsC || sourceRow.latest12MonthsSalesC || 0,
      monthlySalesC: sourceRow.monthlySalesC || {},
      monthlyUnits: sourceRow.monthlyUnits || {},
      monthsWithoutSales: sourceRow.monthsWithoutSales || 0,
      lastPositiveSalesMonth: sourceRow.lastPositiveSalesMonth || null,
      astId: sourceRow.astId || null,
      astMatchStatus: sourceRow.astMatchStatus || "NOT_CHECKED",
      proposedTrnType: sourceRow.proposedTrnType || null,
      proposedTbId: normalizedTbId,
      draftBatchKey,
      batchSequence: 1,
      wardPcode: "",
      wardNumber: "",
      wardName: "",
      planning: {
        mode: NGP_TARGETED_BATCH_PLANNING_MODE,
        townKey: target.townKey,
        streetKey: target.streetKey,
        streetNameKey: target.streetNameKey,
        strNo: String(adr.strNo ?? ""),
        strName: String(adr.strName ?? ""),
        strType: String(adr.strType ?? ""),
      },
    };
  });

  return {
    ok: true,
    code: "NGP_TB_DRAFT_READY",
    message: `${rows.length} batchable Sales meter${
      rows.length === 1 ? "" : "s"
    } prepared for one Targeted Batch.`,
    draft: {
      id: normalizedTbId,
      creationGroup: {
        id: creationGroupId,
        proposedBatchCount: 1,
      },
      source: {
        type: "PREPAID_SALES_NON_GPS",
        label: "Non-GPS Sales",
        sourceId: null,
        fileName: null,
      },
      scope: {
        lmPcode: normalizedLmPcode,
        lmName: String(lmName || "NAv"),
      },
      selection: {
        reason: selectionReason,
        salesPeriodFrom: getSelectionPeriod(
          selectedTargets,
          "salesPeriodFrom",
          "earliest",
        ),
        salesPeriodTo: getSelectionPeriod(
          selectedTargets,
          "salesPeriodTo",
          "latest",
        ),
        planningMode: NGP_TARGETED_BATCH_PLANNING_MODE,
      },
      authoritativeIds: {
        salesAllMeterIds,
        uploadRowIds: [],
      },
      proposedBatches: [
        {
          tbId: normalizedTbId,
          draftBatchKey,
          sequence: 1,
          scope: {
            lmPcode: normalizedLmPcode,
            lmName: String(lmName || "NAv"),
            wardPcode: "",
            wardNumber: "",
            wardName: "",
          },
          salesAllMeterIds,
          rows,
          validation: {
            status: "PASSED",
            oneWardOnly: false,
          },
        },
      ],
      displayRows: rows,
      validation: {
        status: "PASSED",
        passed: true,
        errors: [],
        warnings: [],
        duplicateRowNos: [],
        duplicateMeterNos: [],
        invalidRowDetails: [],
        proposedBatchCount: 1,
        wardGroupingApplied: false,
        planningMode: NGP_TARGETED_BATCH_PLANNING_MODE,
      },
    },
  };
}
