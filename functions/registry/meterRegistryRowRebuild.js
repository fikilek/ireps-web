/* eslint-disable no-undef */

import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

function normalizeMeterNo(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

function getStandardMetadata(sourceMeta = {}) {
  const now = new Date().toISOString();

  const createdAt = sourceMeta?.createdAt || now;
  const createdByUid = sourceMeta?.createdByUid || "SYSTEM";
  const createdByUser = sourceMeta?.createdByUser || "SYSTEM";

  const updatedAt = sourceMeta?.updatedAt || createdAt;
  const updatedByUid = sourceMeta?.updatedByUid || createdByUid;
  const updatedByUser = sourceMeta?.updatedByUser || createdByUser;

  return {
    createdAt,
    createdByUid,
    createdByUser,
    updatedAt,
    updatedByUid,
    updatedByUser,
  };
}

function resolveMeterKind(data = {}) {
  return (
    data?.ast?.astData?.meter?.type ||
    data?.astData?.meter?.type ||
    data?.meterKind ||
    "NAv"
  );
}

function resolveMeterPhase(data = {}) {
  return (
    data?.ast?.astData?.meter?.phase ||
    data?.astData?.meter?.phase ||
    data?.meterPhase ||
    "NAv"
  );
}

function resolveMeterVisibility(data = {}) {
  return data?.master?.visibility || data?.visibility || "NAv";
}

function buildMeterRegistryRow(astId, data = {}) {
  const sourceMetadata = getStandardMetadata(data?.metadata || {});

  const meterNoRaw = data?.ast?.astData?.astNo || data?.master?.id || "NAv";
  const meterNo = normalizeMeterNo(meterNoRaw) || "NAv";
  const meterKind = resolveMeterKind(data);
  const meterPhase = resolveMeterPhase(data);
  const visibility = resolveMeterVisibility(data);

  return {
    id: astId,
    meterId: astId,

    meterNo,
    meterType: data?.meterType || "NAv",
    meterKind,
    meterPhase,

    visibility,

    premiseId: data?.accessData?.premise?.id || "NAv",
    premiseAddress: data?.accessData?.premise?.address || "NAv",
    premisePropertyType: data?.accessData?.premise?.propertyType || "NAv",

    erfId: data?.accessData?.erfId || "NAv",
    erfNo: data?.accessData?.erfNo || "NAv",

    parents: {
      countryPcode: data?.accessData?.parents?.countryPcode || "NAv",
      provincePcode: data?.accessData?.parents?.provincePcode || "NAv",
      dmPcode: data?.accessData?.parents?.dmPcode || "NAv",
      lmPcode: data?.accessData?.parents?.lmPcode || "NAv",
      wardPcode: data?.accessData?.parents?.wardPcode || "NAv",
    },

    metadata: {
      createdAt: sourceMetadata.createdAt,
      createdByUid: sourceMetadata.createdByUid,
      createdByUser: sourceMetadata.createdByUser,
      updatedAt: new Date().toISOString(),
      updatedByUid: "SYSTEM",
      updatedByUser: "Meter Registry Sync",
    },
  };
}

export async function rebuildMeterRegistryRow(astId) {
  const db = getFirestore();

  try {
    if (!astId) {
      throw new Error("astId is required");
    }

    logger.info("rebuildMeterRegistryRow ---- START", { astId });

    const astRef = db.collection("asts").doc(astId);
    const astSnap = await astRef.get();

    if (!astSnap.exists) {
      logger.warn("rebuildMeterRegistryRow ---- AST NOT FOUND", { astId });
      return null;
    }

    const data = astSnap.data() || {};
    const meterType = data?.meterType || "NAv";
    const hasAccess = data?.accessData?.access?.hasAccess || "no";

    if (meterType === "NA" || hasAccess !== "yes") {
      logger.info("rebuildMeterRegistryRow ---- SKIP NON-METER AST", {
        astId,
        meterType,
        hasAccess,
      });
      return null;
    }

    const row = buildMeterRegistryRow(astId, data);

    const registryRef = db.collection("registry_meters").doc(astId);

    await registryRef.set(row, { merge: true });

    logger.info("rebuildMeterRegistryRow ---- SUCCESS", {
      astId,
      meterNo: row.meterNo,
      meterType: row.meterType,
      meterKind: row.meterKind,
      meterPhase: row.meterPhase,
      visibility: row.visibility,
      lmPcode: row?.parents?.lmPcode || "NAv",
      wardPcode: row?.parents?.wardPcode || "NAv",
    });

    return row;
  } catch (error) {
    logger.error("rebuildMeterRegistryRow ---- ERROR", {
      astId,
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    throw error;
  }
}
