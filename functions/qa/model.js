import { currentState, TRN_STATES } from "../meterLifecycle/trnStateMachine.js";
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
  if (stage && !["COMPLETED", "QA FAIL", "QA UPDATED", "QA PASS"].includes(stage)) return { eligible: false, label: "Awaiting submission" };
  if (!qaText(trn.accessData?.trnType)) return { eligible: false, label: "Transaction type unavailable" };
  if (["COMPLETED", "QA FAIL", "QA UPDATED", "QA PASS"].includes(stage) && ["yes", "no"].includes(access)) return { eligible: true, label: "Submitted" };
  const office = qaText(trn.origin?.channel || trn.workflow?.createdMode).toUpperCase() === "OFFICE";
  if (!office && ["yes", "no"].includes(access)) return { eligible: true, label: "Submitted" };
  return { eligible: false, label: "Submission needs checking" };
}

export function qaState(trn = {}) {
  if (!qaEligibility(trn).eligible) return "";
  const canonical = qaAlias(trn.workflow?.state);
  if (canonical && canonical !== "DRAFT") return canonical;
  // Compatibility display only. Fresh mutations must resolve lifecycle authority.
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

// Legacy response/UI aliases are derived values, never an independent writer.
export function qaAlias(state) {
  return ({ COMPLETED: "DRAFT", "QA FAIL": "FAIL", "QA UPDATED": "UPDATED", "QA PASS": "PASS" })[state] || "";
}

export function workflowState(trn = {}) {
  const state = currentState(trn.workflow?.state);
  const legacy = qaText(trn.qa?.state).toUpperCase();
  // A legacy dual-field record cannot be silently downgraded to awaiting QA.
  // Its conversion/verified compatibility policy requires owner approval.
  if (state === TRN_STATES.COMPLETED && legacy && legacy !== "DRAFT") return "";
  // Canonical writers remove the legacy state. A leftover PASS must never be
  // bypassed by a conflicting workflow value; surface the contradiction.
  if (legacy === "PASS" && state !== TRN_STATES.QA_PASS) return "";
  if (legacy && !Object.hasOwn(QA_LABELS, legacy)) return "";
  if (legacy && qaAlias(state) && legacy !== qaAlias(state)) return "";
  return state;
}

export function isQaPassLocked(trn = {}) {
  // Conservative legacy lock remains even when lifecycle evidence needs resolution.
  return trn.workflow?.state === TRN_STATES.QA_PASS || trn.qa?.state === "PASS";
}
