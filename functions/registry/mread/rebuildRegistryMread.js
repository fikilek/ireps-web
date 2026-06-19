import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import {
  LEGACY_MREAD_OUTCOME_MAP,
  isCanonicalMreadOutcome,
} from "./constants.js";
import { writeRegistryMreadFromTrn } from "./writeRegistryMreadFromTrn.js";

function isMreadTrn(data = {}) {
  const trnType = String(data?.accessData?.trnType || data?.trnType || "")
    .trim()
    .toUpperCase();

  return trnType === "METER_READING" || trnType === "TRN_MREAD";
}

function isCompleted(data = {}) {
  return String(data?.workflow?.state || data?.workflowState || "")
    .trim()
    .toUpperCase() === "COMPLETED";
}

function requireAdminOrManager(request) {
  // Keep this conservative and easy to adapt to your existing custom claims.
  const token = request?.auth?.token || {};
  const role = String(token.role || token.userRole || "").trim().toUpperCase();
  const roles = Array.isArray(token.roles) ? token.roles.map((x) => String(x).toUpperCase()) : [];

  return Boolean(
    request?.auth?.uid &&
      (token.admin === true ||
        role === "MNG" ||
        role === "ADMIN" ||
        roles.includes("MNG") ||
        roles.includes("ADMIN")),
  );
}

export const rebuildRegistryMreadCallable = onCall(async (request) => {
  if (!requireAdminOrManager(request)) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: "Only authorised users may rebuild registry_mread.",
    };
  }

  const db = getFirestore();
  const dryRun = request?.data?.dryRun !== false;
  const limit = Number(request?.data?.limit || 100);
  const canonicalizeLegacyOutcomes = request?.data?.canonicalizeLegacyOutcomes === true;

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100;

  const snap = await db
    .collection("trns")
    .where("accessData.trnType", "==", "METER_READING")
    .where("workflow.state", "==", "COMPLETED")
    .limit(safeLimit)
    .get();

  const results = [];

  for (const docSnap of snap.docs) {
    const trnId = docSnap.id;
    const trn = docSnap.data() || {};

    if (!isMreadTrn(trn) || !isCompleted(trn)) {
      results.push({ trnId, skipped: true, reason: "NOT_COMPLETED_MREAD" });
      continue;
    }

    const oldOutcome = String(trn?.executionOutcome?.outcome || "").trim();
    const canonicalOutcome = isCanonicalMreadOutcome(oldOutcome)
      ? oldOutcome
      : LEGACY_MREAD_OUTCOME_MAP[oldOutcome];

    if (!canonicalOutcome) {
      results.push({
        trnId,
        ok: false,
        reason: "NON_CANONICAL_OUTCOME_NO_MIGRATION_MAP",
        outcome: oldOutcome || "MISSING",
      });
      continue;
    }

    try {
      if (!dryRun && oldOutcome !== canonicalOutcome) {
        if (!canonicalizeLegacyOutcomes) {
          results.push({
            trnId,
            ok: false,
            reason: "LEGACY_OUTCOME_REQUIRES_CANONICALIZE_FLAG",
            oldOutcome,
            canonicalOutcome,
          });
          continue;
        }

        await docSnap.ref.update({
          "executionOutcome.outcome": canonicalOutcome,
          "executionOutcome.success": canonicalOutcome === "SUCCESSFUL_READING",
        });
      }

      if (!dryRun) {
        await writeRegistryMreadFromTrn({
          db,
          trnId,
          source: "REGISTRY_MREAD_REBUILD",
        });
      }

      results.push({
        trnId,
        ok: true,
        dryRun,
        oldOutcome,
        canonicalOutcome,
        wouldCanonicalize: oldOutcome !== canonicalOutcome,
        wouldWriteRegistry: true,
      });
    } catch (error) {
      logger.error("rebuildRegistryMreadCallable row failed", {
        trnId,
        message: error?.message || String(error),
        stack: error?.stack || "NAv",
      });

      results.push({
        trnId,
        ok: false,
        reason: error?.message || String(error),
      });
    }
  }

  return {
    ok: true,
    dryRun,
    canonicalizeLegacyOutcomes,
    scanned: snap.size,
    results,
  };
});
