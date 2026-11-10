const text = (value) => String(value ?? "").trim();
const first = (...values) => values.map(text).find(Boolean) || "";
const upper = (value) => text(value).toUpperCase();

export function getMdBgoRowProgress(state) {
  const canonical = upper(state);
  if (canonical === "IN_PROGRESS") return "IN_PROGRESS";
  if (canonical === "COMPLETED") return "COMPLETED";
  if (["READY_FOR_ALLOCATION", "ISSUED", "ALLOCATED", "ACCEPTED", "REJECTED"].includes(canonical)) return "NOT_STARTED";
  return "UNAVAILABLE";
}

export function buildMdBgoRowsSummary(rows = []) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    const progress = getMdBgoRowProgress(row?.workflow?.state);
    if (progress === "IN_PROGRESS") summary.inProgress += 1;
    else if (progress === "COMPLETED") summary.completed += 1;
    else if (progress === "NOT_STARTED") summary.notStarted += 1;
    else summary.unavailable += 1;
    return summary;
  }, { total: 0, notStarted: 0, inProgress: 0, completed: 0, unavailable: 0 });
}

function getPremiseId(row) {
  return first(row?.refs?.premiseId, row?.premise?.id);
}

function getPremiseIdFromAst(ast) {
  return first(ast?.accessData?.premise?.id, ast?.premiseId, ast?.premise?.id);
}

function getMeterNo(ast) {
  return first(ast?.ast?.astData?.astNo, ast?.astData?.astNo, ast?.meterNo, ast?.master?.id);
}

function addressOf(premise) {
  const address = premise?.address || {};
  return first(premise?.premiseAddress, [address.strNo, address.strName, address.strType].filter(Boolean).join(" "));
}

export function enrichMdBgoRows({ rows = [], premises = [], meters = [] }) {
  const premiseById = new Map(premises.map((premise) => [text(premise?.id), premise]));
  const metersByPremise = new Map();
  meters.forEach((meter) => {
    const premiseId = getPremiseIdFromAst(meter);
    if (!premiseId) return;
    const items = metersByPremise.get(premiseId) || [];
    const number = getMeterNo(meter);
    items.push({ id: first(meter?.id, meter?.astId), number: number || "NAv" });
    metersByPremise.set(premiseId, items);
  });

  return rows.map((row) => {
    const premiseId = getPremiseId(row);
    const premise = premiseId ? premiseById.get(premiseId) || null : null;
    const rowMeters = premiseId ? metersByPremise.get(premiseId) || [] : [];
    return {
      ...row,
      rowKey: first(row?.id, row?.bgoRowId),
      rowNo: Number(row?.rowNo) || 0,
      erfId: first(row?.erf?.id, row?.erfId),
      erfNo: first(row?.erf?.erfNo, row?.erfNo) || "NAv",
      premiseId: premiseId || "",
      premiseNo: first(premise?.premiseNo, premise?.master?.premiseNo, row?.premise?.premiseNo) || "NAv",
      premiseAddress: premise ? addressOf(premise) || "NAv" : "NAv",
      propertyType: first(premise?.propertyType?.type, premise?.propertyTypeLabel) || "NAv",
      propertyName: first(premise?.propertyType?.name, premise?.propertyName) || "NAv",
      unitNo: first(premise?.propertyType?.unitNo, premise?.unitNo) || "NAv",
      meters: rowMeters,
      meterNumbers: rowMeters.map((meter) => meter.number).join(", ") || "NAv",
      workflowState: upper(row?.workflow?.state) || "NAv",
      progress: getMdBgoRowProgress(row?.workflow?.state),
      updatedAt: row?.metadata?.updatedAt || row?.metadata?.createdAt || null,
    };
  });
}

export function mdBgoRowSearchValue(row) {
  return [row?.rowNo, row?.erfNo, row?.erfId, row?.premiseNo, row?.premiseId,
    row?.premiseAddress, row?.propertyType, row?.propertyName, row?.unitNo,
    row?.meterNumbers, row?.workflowState].filter(Boolean).join(" ");
}
