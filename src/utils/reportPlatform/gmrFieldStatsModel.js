// Field Stats (GMR 1.1.0 section 10, schema 1.0.1 section 5): the same groups
// per field worker and per team, one payable total, then the control lines.
// Counts come only from Field Data rows, so both blocks add up to the same total.

export const GMR_NAV = "NAv";

const TRN_TYPE_ORDER = [
  "Meter Discovery",
  "Meter Inspection",
  "Meter Disconnection",
  "Meter Reconnection",
  "Meter Reading",
  "Meter Removal",
  "Meter Installation",
  "Meter Commissioning",
];

const FINDING_ORDER = [
  "Meter Ok · Operationally Ok",
  "Meter Ok · Suspicion",
  "Meter Faulty",
  "Meter Damaged",
  "Illegally Connected",
  "No Access",
];

// MN-R001 section 3.
const ACTION_ORDER = [
  "Disconnect meter",
  "Meter replaced",
  "Tamper removed",
  "Keypad normalised",
  "Service point completed",
  "Meter registered",
];

const FINDING_TRN_TYPES = new Set(["METER_DISCOVERY", "METER_INSPECTION"]);

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function orderedLabels(order, observed) {
  const extra = [...observed]
    .filter((label) => label && !order.includes(label))
    .sort((left, right) => left.localeCompare(right));
  return [...order, ...extra];
}

function isNoneOnly(actions = []) {
  return actions.length === 1 && text(actions[0]).toLowerCase() === "none";
}

// Workers are told apart by user, not by display name: two people with the
// same name stay apart, and one person is one column.
function workerOf(row) {
  const uid = text(row?.fieldWorkerUid);
  if (uid) return `uid:${uid}`;
  const name = text(row?.fieldWorkerName);
  return name ? `name:${name}` : GMR_NAV;
}

function buildWorkerLabels(rows, workers) {
  const nameByKey = new Map();
  rows.forEach((row) => {
    const key = workerOf(row);
    if (!nameByKey.has(key) || nameByKey.get(key) === GMR_NAV) {
      nameByKey.set(key, text(row?.fieldWorkerName) || GMR_NAV);
    }
  });
  const count = new Map();
  workers.forEach((key) => count.set(nameByKey.get(key), (count.get(nameByKey.get(key)) || 0) + 1));
  return new Map(
    workers.map((key) => {
      const name = nameByKey.get(key) || GMR_NAV;
      const clash = count.get(name) > 1 && key.startsWith("uid:");
      return [key, clash ? `${name} (${key.slice(4, 10)})` : name];
    }),
  );
}

function teamOf(row) {
  return text(row?.team) || "Unassigned";
}

function countRow(label, rows, workers, teams, weight) {
  const byWorker = new Map(workers.map((worker) => [worker, 0]));
  const byTeam = new Map(teams.map((team) => [team, 0]));
  let total = 0;

  rows.forEach((row) => {
    const amount = weight(row);
    if (!amount) return;
    byWorker.set(workerOf(row), (byWorker.get(workerOf(row)) || 0) + amount);
    byTeam.set(teamOf(row), (byTeam.get(teamOf(row)) || 0) + amount);
    total += amount;
  });

  return { label, byWorker, byTeam, total };
}

export function buildGmrFieldStatsModel(dataset = {}) {
  const rows = Array.isArray(dataset?.fieldRows) ? dataset.fieldRows : [];
  const unplaced = Array.isArray(dataset?.unplaced) ? dataset.unplaced : [];
  const workerKeys = [...new Set(rows.map(workerOf))];
  const provisional = buildWorkerLabels(rows, workerKeys);
  const workers = workerKeys.sort(
    (left, right) => provisional.get(left).localeCompare(provisional.get(right)) || left.localeCompare(right),
  );
  const workerLabels = buildWorkerLabels(rows, workers);
  const teams = [...new Set(rows.map(teamOf))].sort((left, right) => left.localeCompare(right));
  const row = (label, weight) => countRow(label, rows, workers, teams, weight);

  const findingRows = rows.filter((item) => FINDING_TRN_TYPES.has(item?.trnType));
  const actedRows = findingRows.filter((item) => item?.hasAccess);

  const typeLabels = orderedLabels(TRN_TYPE_ORDER, rows.map((item) => text(item?.trnTypeLabel)));
  const findingLabels = orderedLabels(FINDING_ORDER, findingRows.map((item) => text(item?.findingGroup)));
  const actionLabels = orderedLabels(
    ACTION_ORDER,
    actedRows.flatMap((item) => item?.normalisationActions || []).filter((action) => text(action).toLowerCase() !== "none"),
  );
  const reasons = [...new Set(actedRows.map((item) => text(item?.noActionReason)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  const groups = [
    {
      name: "Transactions",
      rows: [
        ...typeLabels.map((label) => row(label, (item) => (text(item?.trnTypeLabel) === label ? 1 : 0))),
        row("Payable total", () => 1),
      ],
    },
    {
      name: "Findings",
      rows: findingLabels.map((label) =>
        row(label, (item) => (FINDING_TRN_TYPES.has(item?.trnType) && text(item?.findingGroup) === label ? 1 : 0)),
      ),
    },
    {
      name: "Normalisation",
      rows: [
        ...actionLabels.map((label) =>
          row(label, (item) =>
            FINDING_TRN_TYPES.has(item?.trnType) && item?.hasAccess && (item?.normalisationActions || []).includes(label) ? 1 : 0),
        ),
        // GMR-R031: None belongs to Meter Ok only.
        row("None", (item) =>
          FINDING_TRN_TYPES.has(item?.trnType) &&
          item?.hasAccess &&
          text(item?.findingGroup).startsWith("Meter Ok") &&
          isNoneOnly(item?.normalisationActions) &&
          !text(item?.noActionReason) ? 1 : 0),
        ...reasons.map((reason) =>
          row(`No action taken — ${reason}`, (item) =>
            FINDING_TRN_TYPES.has(item?.trnType) && item?.hasAccess && text(item?.noActionReason) === reason ? 1 : 0),
        ),
      ],
    },
    {
      name: "Disconnections called for",
      rows: [
        row("Called for", (item) => (text(item?.followUpRequired) ? 1 : 0)),
        row("Completed", (item) => (text(item?.followUpStatus) === "Completed" ? 1 : 0)),
        row("Not Started", (item) => (text(item?.followUpStatus) === "Not Started" ? 1 : 0)),
        row("No disconnection record", (item) => (text(item?.followUpStatus) === "No disconnection record" ? 1 : 0)),
      ],
    },
    {
      name: "Outside batches (AD HOC)",
      rows: typeLabels.map((label) =>
        row(label, (item) => (text(item?.trnTypeLabel) === label && text(item?.batchId) === "AD HOC" ? 1 : 0)),
      ),
    },
  ];

  // Only rows judged against the vending list carry Yes or No (electricity, a
  // real meter number).
  const judged = rows.filter((item) => item?.hasAccess && ["Yes", "No"].includes(item?.onVendingList));
  const electricityFound = judged.filter((item) => item?.trnType === "METER_DISCOVERY");
  const distinctMeters = (items) => new Set(items.map((item) => text(item?.fieldFoundMeterNo))).size;
  const unresolvedWorkers = new Set(
    rows.filter((item) => ["Unassigned", "Multiple"].includes(teamOf(item))).map(workerOf),
  );

  const controlLines = [
    { label: "Submitted this month but not on Field Data (must be 0)", count: unplaced.length },
    { label: "Transactions without a batch (AD HOC)", count: rows.filter((item) => text(item?.batchId) === "AD HOC").length },
    { label: "Meters found that are not on the vending list", count: distinctMeters(electricityFound.filter((item) => item?.onVendingList === "No")) },
    {
      label: "Visibility mark that disagrees with Sales",
      count: distinctMeters(
        judged.filter(
          (item) =>
            (item?.visibility === "Invisible" && item?.onVendingList === "Yes") ||
            (item?.visibility === "Visible" && item?.onVendingList === "No"),
        ),
      ),
    },
    {
      label: "Transactions with no Sales Category",
      count: actedRows.filter((item) => item?.meterType === "ELECTRICITY" && !text(item?.salesCategory)).length,
    },
    {
      label: "Missing GPS, photograph or normalisation answer",
      count: rows.filter(
        (item) =>
          item?.hasAccess &&
          (!text(item?.gpsCoordinates) ||
            !(item?.photoUrls || []).length ||
            (FINDING_TRN_TYPES.has(item?.trnType) && item?.meterType === "ELECTRICITY" && !(item?.normalisationActions || []).length)),
      ).length,
    },
    { label: "Workers whose team could not be resolved", count: unresolvedWorkers.size },
  ];

  return {
    workers,
    workerLabels,
    teams,
    groups,
    controlLines,
    payableTotal: rows.length,
  };
}
