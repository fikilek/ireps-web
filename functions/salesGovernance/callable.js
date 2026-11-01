import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getApp } from "firebase-admin/app";
import { createHash } from "node:crypto";
import {
  validatePublicationEnvelope,
  validateSnapshot,
  validateVerificationReport,
  hasScopeAccess,
  hasProviderAccess,
  isMonthVerificationClaimed,
  classifyStorageError,
  buildMonthTimeline,
  calendarMonthInZone,
  GOVERNANCE_TIME_ZONE,
} from "./artifacts.js";

// Dependency-injected core so the governed-evidence contract is testable without
// an initialised Admin app. Every dependency is resolved through a thunk at the
// point the deployed callable resolves it. Mirrors the existing
// functions/targetedBatches/recordTargetedBatchNoAccessCallable.js convention.
export async function readSalesGovernedMonths({ getDb, getBucket, getProjectId, getNow = () => new Date(), request }) {
  // --- 1. Authentication -----------------------------------------------------
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Authentication required");

  // --- 2. Request validity ---------------------------------------------------
  const { lmPcode, provider = "contour" } = request.data || {};
  if (!/^ZA\d{4}$/.test(lmPcode || "") || !/^[a-z][a-z0-9_-]{0,39}$/.test(provider)) {
    throw new HttpsError("invalid-argument", "Invalid Sales scope");
  }

  // --- 3. Provider authorization --------------------------------------------
  // A caller may not address an arbitrary provider partition under an LM they
  // happen to be assigned to. Endumeni v1 governs "contour" only.
  if (!hasProviderAccess(provider)) {
    throw new HttpsError("permission-denied", "Provider is not governed for this release", { reasonCode: "PROVIDER_NOT_GOVERNED" });
  }

  // --- 4. Workbase authorization --------------------------------------------
  let user;
  try {
    user = await getDb().collection("users").doc(request.auth.uid).get();
  } catch {
    throw new HttpsError("unavailable", "Governed Sales evidence is temporarily unavailable", { reasonCode: "USER_LOOKUP_FAILED" });
  }
  if (!hasScopeAccess(user.data(), lmPcode)) {
    throw new HttpsError("permission-denied", "Workbase access required", { reasonCode: "WORKBASE_ACCESS_REQUIRED" });
  }

  const bucket = getBucket();
  const prefix = `governed-sales/${lmPcode}/${provider}`;
  const now = getNow();
  const evaluation = {
    evaluatedAt: now.toISOString(),
    timeZone: GOVERNANCE_TIME_ZONE,
    calendarMonth: calendarMonthInZone(now, GOVERNANCE_TIME_ZONE),
  };
  const base = { lmPcode, provider, evaluation };

  // --- 5. Publication --------------------------------------------------------
  let bytes;
  try {
    [bytes] = await bucket.file(`${prefix}/publication.json`).download();
  } catch (error) {
    const kind = classifyStorageError(error);
    if (kind === "ABSENT") {
      return { ...base, status: "PUBLICATION_ABSENT", schemaVersion: null, latestMonth: null, months: {}, snapshots: [], timeline: [], diagnostics: null, publicationRevision: null, baselineMonth: null, latestVerifiedMonth: null };
    }
    if (kind === "UNAVAILABLE") {
      throw new HttpsError("unavailable", "Governed Sales evidence is temporarily unavailable", { reasonCode: "PUBLICATION_READ_FAILED" });
    }
    throw new HttpsError("failed-precondition", "Governed Sales evidence is invalid or incomplete", { reasonCode: "PUBLICATION_READ_REJECTED" });
  }

  const publicationRevision = createHash("sha256").update(bytes).digest("hex");

  // --- 6. Publication envelope (structural; all-or-nothing) ------------------
  let publication;
  let publishedMonths;
  try {
    publication = JSON.parse(bytes.toString("utf8"));
    publishedMonths = validatePublicationEnvelope(publication, lmPcode, provider, getProjectId());
  } catch (error) {
    throw new HttpsError("failed-precondition", "Governed Sales evidence is invalid or incomplete", {
      reasonCode: "PUBLICATION_ENVELOPE_INVALID",
      detail: error?.message || "Publication envelope could not be validated",
    });
  }

  // --- 7. Per-month evidence, building the verified prefix -------------------
  const projectId = getProjectId();
  const snapshots = [];
  const verifiedMonths = [];
  let failure = null;
  let previousHash = null;

  for (const month of publishedMonths) {
    const entry = publication.months[month];
    try {
      if (!isMonthVerificationClaimed(entry)) throw new Error("Month is not verified");
      const hash = entry.snapshotSha256;
      const reportHash = entry.verification.reportSha256;

      const [reportBytes] = await downloadEvidence(bucket, `${prefix}/reports/${reportHash}.json`);
      const [content] = await downloadEvidence(bucket, `${prefix}/snapshots/${hash}.json`);

      const snapshot = validateSnapshot(content, hash, lmPcode, provider, month, previousHash);
      const previousMembers = new Set(snapshots.at(-1)?.members || []);
      const knownMembers = new Set(snapshots.flatMap(item => item.members));
      if (snapshot.replacements.some(pair => !previousMembers.has(pair.predecessor) || knownMembers.has(pair.successor))) {
        throw new Error("Replacement does not reconcile with previous membership");
      }
      validateVerificationReport(reportBytes, reportHash, projectId, month, hash, snapshot);

      snapshots.push(snapshot);
      verifiedMonths.push(month);
      previousHash = hash;
    } catch (error) {
      // A transient backend fault says nothing about integrity: never record it
      // as invalid evidence.
      if (error?.transient) {
        throw new HttpsError("unavailable", "Governed Sales evidence is temporarily unavailable", { reasonCode: "EVIDENCE_READ_FAILED", month });
      }
      failure = { month, reasonCode: "MONTH_EVIDENCE_INVALID", message: error?.message || "Month evidence could not be verified" };
      break;
    }
  }

  const timeline = buildMonthTimeline({ publishedMonths, verifiedMonths, failure, evaluationMonth: evaluation.calendarMonth });

  return {
    ...base,
    status: "OK",
    schemaVersion: publication.schemaVersion,
    latestMonth: publication.latestMonth,
    months: publication.months,
    publicationRevision,
    baselineMonth: publishedMonths[0] ?? null,
    latestVerifiedMonth: verifiedMonths.at(-1) ?? null,
    snapshots,
    timeline,
    diagnostics: failure,
  };
}

// Marks transient faults so the month loop can tell availability from integrity.
async function downloadEvidence(bucket, path) {
  try {
    return await bucket.file(path).download();
  } catch (error) {
    if (classifyStorageError(error) === "UNAVAILABLE") {
      const transient = new Error(`Evidence read failed: ${path}`);
      transient.transient = true;
      throw transient;
    }
    throw new Error(`Governed evidence object is missing or unreadable: ${path}`);
  }
}

export const getSalesGovernedMonths = onCall({ timeoutSeconds: 60, memory: "256MiB" }, request => readSalesGovernedMonths({
  getDb: () => getFirestore(),
  getBucket: () => getStorage().bucket(),
  getProjectId: () => getApp().options.projectId || process.env.GCLOUD_PROJECT,
  request,
}));
