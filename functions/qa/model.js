// QA-R001: shared, side-effect-free readings used by the server and registry.
export const QA_LABELS = Object.freeze({ DRAFT: "Draft", PASS: "Pass", FAIL: "Fail", UPDATED: "Updated" });
export const qaText = value => {
  const text = String(value ?? "").trim();
  return text.toUpperCase() === "NAV" ? "" : text;
};

export function fieldSubmitter(trn = {}) {
  const completedUid = qaText(trn.workflow?.completedByUid);
  if (completedUid) return { uid: completedUid, name: qaText(trn.workflow?.completedByUser) || "NAv" };
  const deviceUid = qaText(trn.metadata?.createdOnDeviceByUid);
  if (deviceUid) return { uid: deviceUid, name: qaText(trn.metadata?.createdOnDeviceByUser) || "NAv" };
  if (qaText(trn.origin?.channel || trn.workflow?.createdMode).toUpperCase() === "OFFICE") {
    return { uid: "", name: "NAv" };
  }
  return { uid: qaText(trn.metadata?.createdByUid), name: qaText(trn.metadata?.createdByUser) || "NAv" };
}

export function qaEligibility(trn = {}) {
  const stage = qaText(trn.workflow?.state).toUpperCase();
  const access = qaText(trn.accessData?.access?.hasAccess).toLowerCase();
  if (stage === "DELETED") return { eligible: false, label: "Deleted" };
  if (stage && stage !== "COMPLETED") return { eligible: false, label: "Awaiting submission" };
  if (!qaText(trn.accessData?.trnType)) return { eligible: false, label: "Transaction type unavailable" };
  if (stage === "COMPLETED" && ["yes", "no"].includes(access)) return { eligible: true, label: "Submitted" };
  const office = qaText(trn.origin?.channel || trn.workflow?.createdMode).toUpperCase() === "OFFICE";
  if (!office && ["yes", "no"].includes(access)) return { eligible: true, label: "Submitted" };
  return { eligible: false, label: "Submission needs checking" };
}

export function qaState(trn = {}) {
  if (!qaEligibility(trn).eligible) return "";
  const state = qaText(trn.qa?.state).toUpperCase();
  if (!state) return "DRAFT";
  return Object.hasOwn(QA_LABELS, state) ? state : "UNKNOWN";
}

export function fieldCapturedAt(trn = {}) {
  const captured = trn.metadata?.createdOnDevice;
  if (!captured) return null;
  const value = typeof captured?.toDate === "function" ? captured.toDate() : new Date(captured);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}
