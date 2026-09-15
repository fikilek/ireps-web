import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { TEAM_MEMBER_HISTORY } from "./member-history.js";
import { summarizeFieldWork } from "./field-work-summary.js";

// Targeted Batch rules TB-R045 (1.3.25): the Allocation Matrix's normal-path totals, worked out
// here so the page receives only the per-team totals, never every field work record.
const MANAGEMENT_ROLES = new Set(["SPU", "ADM", "MNG", "SPV"]);
const TRN_FIELDS = ["sourceModule", "targetedBatchContext.tbId", "derived.targetedBatch.tbId", "accessData.tbId", "accessData.trnType", "accessData.access.hasAccess",
  "metadata.createdByUid", "metadata.createdByUser", "metadata.createdAt", "metadata.createdAtDatetime", "serviceProvider.id", "serviceProvider.name"];
const HISTORY_FIELDS = ["teamId", "teamName", "userUid", "joinedAt", "leftAt"];
const workbaseId = value => (typeof value === "string" ? value : value?.id || value?.pcode || value?.lmPcode || "");

export async function getFieldWorkSummary({ db, request }) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const lmPcode = String(request.data?.lmPcode || "").trim();
  if (!/^ZA[0-9]+$/.test(lmPcode)) throw new HttpsError("invalid-argument", "A valid LM is required.");
  const profileSnapshot = await db.doc(`users/${uid}`).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  const role = profile?.employment?.role || profile?.profile?.employment?.role || profile?.role;
  if (!MANAGEMENT_ROLES.has(role)) throw new HttpsError("permission-denied", "Only management users can see the Allocation Matrix.");
  const workbases = [profile?.access?.activeWorkbase, ...(Array.isArray(profile?.access?.workbases) ? profile.access.workbases : [])].map(workbaseId);
  if (!workbases.includes(lmPcode)) throw new HttpsError("permission-denied", "The LM must be one of your workbases.");
  const [trns, history] = await Promise.all([
    db.collection("trns").where("accessData.parents.lmPcode", "==", lmPcode).select(...TRN_FIELDS).get(),
    db.collection(TEAM_MEMBER_HISTORY).select(...HISTORY_FIELDS).get(),
  ]);
  return { success: true, lmPcode, generatedAt: new Date().toISOString(),
    ...summarizeFieldWork({ trns: trns.docs.map(doc => doc.data()), periods: history.docs.map(doc => doc.data()) }) };
}

export const getFieldWorkSummaryCallable = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async request => getFieldWorkSummary({ db: getFirestore(), request }));
