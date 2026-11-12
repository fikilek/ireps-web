import { getPremiseQaStatus } from "../../../utils/premiseQa.js";
import { reportingQaFinal } from "../../../utils/reportingQaFinal.js";

const id = value => {
  const text = String(value || "").trim();
  return text.toUpperCase() === "NAV" ? "" : text;
};

export function mdBgoRowTrnId(row) {
  // A displayed fan-out meter must never inherit a different meter's TRN.
  const explicitMeterId = row.refs?.meterId || row.meter?.id;
  if (row.meterId && explicitMeterId && row.meterId !== explicitMeterId) return id(row.meterId);
  return id(row.refs?.trnId || row.meter?.trnId || row.meterId);
}

export function mdBgoRowQaLinks(rows) {
  return {
    premiseIds: [...new Set(rows.map(row => id(row.premiseId)).filter(Boolean))].sort(),
    trnIds: [...new Set(rows.map(mdBgoRowTrnId).filter(Boolean))].sort(),
  };
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof (value.seconds ?? value._seconds) === "number") return (value.seconds ?? value._seconds) * 1000;
  const number = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(number) ? number : 0;
}

function activity(source) {
  return [source?.metadata?.createdAt, source?.metadata?.updatedAt, source?.metadata?.createdOnDevice, source?.execution?.startedAt, source?.execution?.completedAt, source?.workflow?.completedAt, source?.qa?.reviewedAt, source?.qa?.submittedAt, source?.qa?.lastAmendment?.at].map(millis);
}

export function enrichMdBgoRowQa(rows, source) {
  return rows.map(row => {
    const premiseId = id(row.premiseId), trnId = mdBgoRowTrnId(row);
    const premise = source?.ready ? source.premises[premiseId] : null;
    const trn = source?.ready ? source.trns[trnId] : null;
    const premiseQa = premise ? getPremiseQaStatus(premise) : "QA NAv";
    // Same lifecycle authority as TRN Registry, rather than AST QA copies.
    const state = String(trn?.workflow?.state || "").trim().toUpperCase();
    const meterQa = state === "COMPLETED" ? "QA PENDING" : ["QA PASS", "QA FAIL"].includes(state) ? state : "QA NAv";
    return { ...row, premiseQa, meterQa,
      premiseQaHref: premise ? `/registries/premises?premiseId=${encodeURIComponent(premiseId)}${premise.parents?.wardPcode ? `&wardPcode=${encodeURIComponent(premise.parents.wardPcode)}` : ""}` : "",
      meterQaHref: trn ? `/registries/trns?trnId=${encodeURIComponent(trnId)}` : "",
      qaFinal: reportingQaFinal({ completed: source?.ready && row.progress === "COMPLETED", premise: premiseQa, meter: meterQa }),
      lastActivity: source?.ready ? Math.max(0, ...activity(row), ...activity(premise), ...activity(trn)) || null : null,
    };
  });
}
