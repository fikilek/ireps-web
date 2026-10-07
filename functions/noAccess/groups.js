const iso = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const date = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
export const noAccessCaptureTime = (trn) => iso(trn?.metadata?.createdOnDevice);

// One definition for the report, its export and monthly reporting. Undated visits
// remain visible but cannot be placed in a sequence or used as closing proof.
export function deriveNoAccessGroups(transactions, { cutoff = new Date().toISOString() } = {}) {
  const groups = [], undated = [], byPremise = new Map();
  for (const trn of transactions) {
    const access = trn.accessData?.access?.hasAccess;
    if (!["yes", "no"].includes(access)) continue;
    if (trn.workflow?.state && trn.workflow.state !== "COMPLETED") continue;
    const at = noAccessCaptureTime(trn);
    const premiseId = trn.accessData?.premise?.id;
    if (!at || !premiseId || premiseId === "NAv") {
      if (access === "no") undated.push({ trnId: trn.id, premiseId: premiseId || null, reason: !at ? "Capture date unknown" : "Premise unknown" });
      continue;
    }
    if (at > cutoff) continue;
    if (!byPremise.has(premiseId)) byPremise.set(premiseId, []);
    byPremise.get(premiseId).push({ trn, at });
  }
  for (const [premiseId, visits] of byPremise) {
    visits.sort((a, b) => a.at.localeCompare(b.at) ||
      Number(a.trn.accessData.access.hasAccess === "yes") - Number(b.trn.accessData.access.hasAccess === "yes") ||
      String(a.trn.id).localeCompare(String(b.trn.id)));
    let current = null;
    for (const { trn, at } of visits) {
      if (trn.accessData.access.hasAccess === "no") {
        if (!current) {
          current = { id: trn.id, premiseId, status: "OPEN", openedAt: at, lastVisitAt: at, visitIds: [], closingProof: null };
          groups.push(current);
        }
        current.visitIds.push(trn.id);
        current.lastVisitAt = at;
      } else if (current && at > current.lastVisitAt) {
        current.status = "CLOSED";
        current.closingProof = { trnId: trn.id, trnType: trn.accessData.trnType, at,
          worker: trn.metadata?.createdOnDeviceByUser || trn.workflow?.completedByUser || trn.metadata?.createdByUser || "NAv" };
        current = null;
      }
    }
  }
  return { groups, undated, cutoff };
}
