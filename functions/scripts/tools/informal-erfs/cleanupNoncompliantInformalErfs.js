import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  applicationDefault,
  cert,
  deleteApp,
  initializeApp,
} from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

import { recomputeGeoFenceCounts } from "../../../geofences/membership.js";
import { rebuildWardRegistryRow } from "../../../registry/wardBuilder.js";

const APPROVED_ID_PATTERN = /^IE-(ZA\d{7})-\d{8}-\d{6}-\d{4}$/;
const INFORMAL_ERF_NUMBER_PATTERN = /^IE(\d{6})$/;
const LM_PCODE_PATTERN = /^ZA\d{4}$/;
const WARD_PCODE_PATTERN = /^ZA\d{7}$/;
const DESTRUCTIVE_CONFIRMATION = "DELETE_NONCOMPLIANT_INFORMAL_ERFS";
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
const DELETE_BATCH_RECORDS = 200;

const COLLECTIONS = Object.freeze({
  erfs: "ireps_erfs",
  registryErfs: "registry_erfs",
  geoFences: "geo_fences",
  counters: "ireps_counters",
});

function cleanText(value) {
  return String(value ?? "").trim();
}

function hasFlag(flagName) {
  return process.argv.includes(flagName);
}

function getArgument(flagName) {
  const index = process.argv.indexOf(flagName);

  if (index < 0) return "";

  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? cleanText(value) : "";
}

function parsePageSize(value) {
  if (!value) return DEFAULT_PAGE_SIZE;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    throw new Error(
      `--page-size must be an integer from 1 to ${MAX_PAGE_SIZE}.`,
    );
  }

  return parsed;
}

function printUsage() {
  console.log(`
Dry run (default):
  node ./scripts/tools/informal-erfs/cleanupNoncompliantInformalErfs.js \\
    --project-id ireps2 \\
    --service-account "/path/to/service-account.json"

Confirmed destructive execution:
  node ./scripts/tools/informal-erfs/cleanupNoncompliantInformalErfs.js \\
    --project-id ireps2 \\
    --service-account "/path/to/service-account.json" \\
    --execute \\
    --confirm-delete ${DESTRUCTIVE_CONFIRMATION}

Options:
  --project-id       Required Firebase project ID.
  --service-account  Optional service-account JSON path. Uses ADC if omitted.
  --page-size        Scan page size from 1 to ${MAX_PAGE_SIZE} (default ${DEFAULT_PAGE_SIZE}).
  --execute          Enables destructive deletion and derived-count rebuilds.
  --confirm-delete   Required exact confirmation token with --execute.
  --help             Print this usage information.
`);
}

async function buildCredential(serviceAccountPath) {
  if (!serviceAccountPath) return applicationDefault();

  const absolutePath = path.resolve(serviceAccountPath);
  const raw = await readFile(absolutePath, "utf8");
  const serviceAccount = JSON.parse(raw);

  return cert(serviceAccount);
}

function matchApprovedId(value) {
  return cleanText(value).toUpperCase().match(APPROVED_ID_PATTERN);
}

function normalizeGeoFenceRefs(value) {
  if (!Array.isArray(value)) return [];

  const byId = new Map();

  for (const item of value) {
    const id = cleanText(item?.id);

    if (!id) continue;

    byId.set(id, {
      id,
      name: cleanText(item?.name) || null,
    });
  }

  return Array.from(byId.values());
}

function validateInformalErfDocument(documentSnapshot) {
  const data = documentSnapshot.data() || {};
  const documentId = cleanText(documentSnapshot.id);
  const rootErfId = cleanText(data?.erfId);
  const sgPrclKey = cleanText(data?.sg?.prclKey);
  const lmPcode = cleanText(data?.admin?.localMunicipality?.pcode).toUpperCase();
  const wardPcode = cleanText(data?.admin?.ward?.pcode).toUpperCase();
  const parcelNo = cleanText(data?.sg?.parcelNo) || null;
  const parcelNumberMatch = parcelNo?.match(INFORMAL_ERF_NUMBER_PATTERN);
  const parcelNumber = parcelNumberMatch
    ? Number(parcelNumberMatch[1])
    : null;
  const geofenceRefs = normalizeGeoFenceRefs(data?.geofenceRefs);
  const violations = [];
  const blockers = [];

  const documentIdMatch = matchApprovedId(documentId);
  const rootErfIdMatch = matchApprovedId(rootErfId);
  const sgPrclKeyMatch = matchApprovedId(sgPrclKey);

  if (!documentIdMatch) {
    violations.push("DOCUMENT_ID_FORMAT_INVALID");
  }

  if (!rootErfIdMatch) {
    violations.push("ROOT_ERF_ID_FORMAT_INVALID");
  }

  if (!sgPrclKeyMatch) {
    violations.push("SG_PRCL_KEY_FORMAT_INVALID");
  }

  if (rootErfId !== documentId) {
    violations.push("ROOT_ERF_ID_DOES_NOT_MATCH_DOCUMENT_ID");
  }

  if (sgPrclKey !== documentId) {
    violations.push("SG_PRCL_KEY_DOES_NOT_MATCH_DOCUMENT_ID");
  }

  if (!LM_PCODE_PATTERN.test(lmPcode)) {
    violations.push("CANONICAL_LM_PCODE_INVALID");
    blockers.push("Cannot rebuild Ward Registry without a valid canonical LM pCode.");
  }

  if (!WARD_PCODE_PATTERN.test(wardPcode)) {
    violations.push("CANONICAL_WARD_PCODE_INVALID");
    blockers.push(
      "Cannot rebuild Ward Registry without a valid canonical ward pCode.",
    );
  }

  if (
    LM_PCODE_PATTERN.test(lmPcode) &&
    WARD_PCODE_PATTERN.test(wardPcode) &&
    !wardPcode.startsWith(lmPcode)
  ) {
    violations.push("CANONICAL_WARD_NOT_IN_CANONICAL_LM");
    blockers.push("Canonical ward pCode does not belong to the canonical LM.");
  }

  for (const [fieldName, match] of [
    ["DOCUMENT_ID", documentIdMatch],
    ["ROOT_ERF_ID", rootErfIdMatch],
    ["SG_PRCL_KEY", sgPrclKeyMatch],
  ]) {
    if (match && WARD_PCODE_PATTERN.test(wardPcode) && match[1] !== wardPcode) {
      violations.push(`${fieldName}_EMBEDDED_WARD_MISMATCH`);
    }
  }

  const rawGeoFenceRefs = data?.geofenceRefs;

  if (
    Array.isArray(rawGeoFenceRefs) &&
    rawGeoFenceRefs.some((item) => !cleanText(item?.id))
  ) {
    blockers.push(
      "At least one geofenceRefs item has no id, so all affected geofences cannot be recomputed safely.",
    );
  }

  return {
    documentId,
    rootErfId: rootErfId || null,
    sgPrclKey: sgPrclKey || null,
    parcelNo,
    parcelNumber,
    lmPcode: lmPcode || null,
    wardPcode: wardPcode || null,
    embeddedWards: {
      documentId: documentIdMatch?.[1] || null,
      rootErfId: rootErfIdMatch?.[1] || null,
      sgPrclKey: sgPrclKeyMatch?.[1] || null,
    },
    geofenceRefs,
    violations,
    blockers,
    compliant: violations.length === 0,
  };
}

function buildRegistryReport(registrySnapshot) {
  if (!registrySnapshot.exists) {
    return {
      exists: false,
      id: registrySnapshot.id,
    };
  }

  const data = registrySnapshot.data() || {};

  return {
    exists: true,
    id: registrySnapshot.id,
    sourceId: cleanText(data?.source?.sourceId) || null,
    erfId: cleanText(data?.erf?.id) || null,
    erfNo: cleanText(data?.erf?.erfNo) || null,
    type: cleanText(data?.erf?.type || data?.registry?.type) || null,
    lmPcode:
      cleanText(data?.registry?.lmPcode || data?.geography?.lmPcode) || null,
    wardPcode:
      cleanText(data?.registry?.wardPcode || data?.geography?.wardPcode) || null,
  };
}

async function scanNoncompliantInformalErfs({ db, pageSize }) {
  const startedAtMs = Date.now();
  const records = [];
  const affectedWards = new Map();
  const affectedGeoFences = new Map();
  let lastDocument = null;
  let page = 0;
  let scanned = 0;
  let compliant = 0;

  console.log("[INFORMAL ERF CLEANUP] SCAN START", { pageSize });

  while (true) {
    page += 1;

    let query = db
      .collection(COLLECTIONS.erfs)
      .where("erf.type", "==", "INFORMAL")
      .orderBy(FieldPath.documentId())
      .limit(pageSize);

    if (lastDocument) {
      query = query.startAfter(lastDocument);
    }

    console.log("[INFORMAL ERF CLEANUP] PAGE READ START", {
      page,
      pageSize,
      afterDocumentId: lastDocument?.id || null,
    });

    const snapshot = await query.get();

    console.log("[INFORMAL ERF CLEANUP] PAGE READ COMPLETE", {
      page,
      rows: snapshot.size,
    });

    if (snapshot.empty) break;

    for (const documentSnapshot of snapshot.docs) {
      scanned += 1;
      const validation = validateInformalErfDocument(documentSnapshot);

      if (validation.compliant) {
        compliant += 1;
        continue;
      }

      const registrySnapshot = await db
        .collection(COLLECTIONS.registryErfs)
        .doc(validation.documentId)
        .get();
      const registry = buildRegistryReport(registrySnapshot);
      const record = {
        ...validation,
        registry,
      };

      records.push(record);

      if (
        LM_PCODE_PATTERN.test(validation.lmPcode || "") &&
        WARD_PCODE_PATTERN.test(validation.wardPcode || "") &&
        validation.wardPcode.startsWith(validation.lmPcode)
      ) {
        const wardKey = `${validation.lmPcode}__${validation.wardPcode}`;
        affectedWards.set(wardKey, {
          lmPcode: validation.lmPcode,
          wardPcode: validation.wardPcode,
        });
      }

      for (const geofenceRef of validation.geofenceRefs) {
        const current = affectedGeoFences.get(geofenceRef.id) || {
          id: geofenceRef.id,
          name: geofenceRef.name,
          sourceErfIds: [],
          sourceScopes: [],
        };

        current.sourceErfIds.push(validation.documentId);
        current.sourceScopes.push({
          lmPcode: validation.lmPcode,
          wardPcode: validation.wardPcode,
        });
        affectedGeoFences.set(geofenceRef.id, current);
      }

      console.log("[INFORMAL ERF CLEANUP] NONCOMPLIANT RECORD", record);
    }

    console.log("[INFORMAL ERF CLEANUP] SCAN PROGRESS", {
      pagesRead: page,
      scanned,
      compliant,
      noncompliant: records.length,
    });

    lastDocument = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < pageSize) break;
  }

  const geofenceReports = [];

  for (const geofence of affectedGeoFences.values()) {
    const snapshot = await db
      .collection(COLLECTIONS.geoFences)
      .doc(geofence.id)
      .get();
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const authoritativeLmPcode = cleanText(data?.parents?.lmPcode).toUpperCase();
    const authoritativeWardPcode = cleanText(
      data?.parents?.wardPcode,
    ).toUpperCase();
    const blockers = [];

    if (snapshot.exists && !LM_PCODE_PATTERN.test(authoritativeLmPcode)) {
      blockers.push(
        "Existing geofence has no valid parents.lmPcode for authoritative count recomputation.",
      );
    }

    if (snapshot.exists && !WARD_PCODE_PATTERN.test(authoritativeWardPcode)) {
      blockers.push(
        "Existing geofence has no valid parents.wardPcode for authoritative count recomputation.",
      );
    }

    if (
      snapshot.exists &&
      LM_PCODE_PATTERN.test(authoritativeLmPcode) &&
      WARD_PCODE_PATTERN.test(authoritativeWardPcode) &&
      !authoritativeWardPcode.startsWith(authoritativeLmPcode)
    ) {
      blockers.push(
        "Existing geofence parent ward pCode does not belong to its parent LM.",
      );
    }

    const uniqueSourceScopes = Array.from(
      new Map(
        geofence.sourceScopes.map((scope) => [
          `${scope.lmPcode || "NAv"}__${scope.wardPcode || "NAv"}`,
          scope,
        ]),
      ).values(),
    );
    const sourceScopeMismatch =
      snapshot.exists &&
      uniqueSourceScopes.some(
        (scope) =>
          scope.lmPcode !== authoritativeLmPcode ||
          scope.wardPcode !== authoritativeWardPcode,
      );

    geofenceReports.push({
      ...geofence,
      sourceScopes: uniqueSourceScopes,
      exists: snapshot.exists,
      lmPcode: snapshot.exists ? authoritativeLmPcode || null : null,
      wardPcode: snapshot.exists ? authoritativeWardPcode || null : null,
      sourceScopeMismatch,
      currentCounts: snapshot.exists ? data?.counts || null : null,
      blockers,
    });
  }

  return {
    pagesRead: page,
    scanned,
    compliant,
    records,
    affectedWards: Array.from(affectedWards.values()),
    affectedGeoFences: geofenceReports,
    elapsedMs: Date.now() - startedAtMs,
  };
}

function collectBlockers(scanResult) {
  const blockers = [];

  for (const record of scanResult.records) {
    for (const message of record.blockers) {
      blockers.push({
        documentId: record.documentId,
        message,
      });
    }
  }

  for (const geofence of scanResult.affectedGeoFences) {
    for (const message of geofence.blockers) {
      blockers.push({
        geofenceId: geofence.id,
        message,
      });
    }
  }

  return blockers;
}

function getMaximumDeletedParcelNumber(records = []) {
  return records.reduce((maximum, record) => {
    const parcelNumber = Number(record?.parcelNumber);

    return Number.isInteger(parcelNumber) && parcelNumber >= 0
      ? Math.max(maximum, parcelNumber)
      : maximum;
  }, 0);
}

function assertValidCounterNumber(value) {
  const parsed = Number(value ?? 0);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      "ireps_counters/informal_erfs.lastNumber must be a non-negative integer.",
    );
  }

  return parsed;
}

async function readCounterState(db) {
  const snapshot = await db
    .collection(COLLECTIONS.counters)
    .doc("informal_erfs")
    .get();

  return {
    exists: snapshot.exists,
    lastNumber: assertValidCounterNumber(snapshot.data()?.lastNumber),
  };
}

async function ensureCounterFloor({ db, requiredFloor }) {
  const counterRef = db
    .collection(COLLECTIONS.counters)
    .doc("informal_erfs");

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const before = assertValidCounterNumber(snapshot.data()?.lastNumber);
    const after = Math.max(before, requiredFloor);
    const increased = after > before;

    if (increased) {
      transaction.set(counterRef, { lastNumber: after }, { merge: true });
    }

    return {
      existedBefore: snapshot.exists,
      before,
      after,
      increased,
    };
  });
}

async function deleteNoncompliantRecords({ db, records }) {
  let deletedErfs = 0;
  let deletedRegistryRows = 0;
  let batchesCommitted = 0;

  for (let start = 0; start < records.length; start += DELETE_BATCH_RECORDS) {
    const chunk = records.slice(start, start + DELETE_BATCH_RECORDS);
    const batch = db.batch();

    for (const record of chunk) {
      batch.delete(db.collection(COLLECTIONS.erfs).doc(record.documentId));
      batch.delete(
        db.collection(COLLECTIONS.registryErfs).doc(record.documentId),
      );
    }

    await batch.commit();
    batchesCommitted += 1;
    deletedErfs += chunk.length;
    deletedRegistryRows += chunk.filter(
      (record) => record.registry.exists,
    ).length;

    console.log("[INFORMAL ERF CLEANUP] DELETE PROGRESS", {
      batchesCommitted,
      deletedErfs,
      totalErfs: records.length,
      deletedRegistryRows,
    });
  }

  return {
    deletedErfs,
    deletedRegistryRows,
    batchesCommitted,
  };
}

async function rebuildAffectedWardCounts(affectedWards) {
  let rebuilt = 0;

  for (const [index, ward] of affectedWards.entries()) {
    console.log("[INFORMAL ERF CLEANUP] WARD REBUILD PROGRESS", {
      current: index + 1,
      total: affectedWards.length,
      ...ward,
    });

    const row = await rebuildWardRegistryRow({
      ...ward,
      reason: "NONCOMPLIANT_INFORMAL_ERF_REMOVED",
    });

    rebuilt += 1;

    console.log("[INFORMAL ERF CLEANUP] WARD REBUILD COMPLETE", {
      ...ward,
      rowId: row?.id || null,
      counts: row?.counts || null,
    });
  }

  return rebuilt;
}

async function recomputeAffectedGeoFenceCounts({ db, affectedGeoFences }) {
  let recomputed = 0;
  let missing = 0;

  for (const [index, geofence] of affectedGeoFences.entries()) {
    console.log("[INFORMAL ERF CLEANUP] GEOFENCE REBUILD PROGRESS", {
      current: index + 1,
      total: affectedGeoFences.length,
      geofenceId: geofence.id,
      lmPcode: geofence.lmPcode,
      wardPcode: geofence.wardPcode,
    });

    if (!geofence.exists) {
      missing += 1;
      console.warn("[INFORMAL ERF CLEANUP] GEOFENCE MISSING", {
        geofenceId: geofence.id,
        sourceErfIds: geofence.sourceErfIds,
      });
      continue;
    }

    const counts = await recomputeGeoFenceCounts({
      db,
      geoFenceId: geofence.id,
      lmPcode: geofence.lmPcode,
      wardPcode: geofence.wardPcode,
    });

    await db.collection(COLLECTIONS.geoFences).doc(geofence.id).update({
      counts,
      "metadata.updatedAt": new Date().toISOString(),
      "metadata.updatedByUid": "SYSTEM",
      "metadata.updatedByUser": "cleanupNoncompliantInformalErfs",
    });

    recomputed += 1;

    console.log("[INFORMAL ERF CLEANUP] GEOFENCE REBUILD COMPLETE", {
      geofenceId: geofence.id,
      counts,
    });
  }

  return { recomputed, missing };
}

async function main() {
  if (hasFlag("--help")) {
    printUsage();
    return;
  }

  const startedAtMs = Date.now();
  const projectId = cleanText(getArgument("--project-id"));
  const serviceAccountPath = getArgument("--service-account");
  const pageSize = parsePageSize(getArgument("--page-size"));
  const execute = hasFlag("--execute");
  const confirmation = getArgument("--confirm-delete");

  if (!projectId) {
    printUsage();
    throw new Error("--project-id is required.");
  }

  if (execute && confirmation !== DESTRUCTIVE_CONFIRMATION) {
    throw new Error(
      `Destructive execution requires --confirm-delete ${DESTRUCTIVE_CONFIRMATION}.`,
    );
  }

  if (!execute && confirmation) {
    throw new Error("--confirm-delete may be used only with --execute.");
  }

  const credential = await buildCredential(serviceAccountPath);
  const app = initializeApp({
    credential,
    projectId,
  });

  try {
    const db = getFirestore(app);
    const mode = execute ? "EXECUTE" : "DRY_RUN";

    console.log("[INFORMAL ERF CLEANUP] START", {
      projectId,
      mode,
      pageSize,
      serviceAccountPath: serviceAccountPath
        ? path.resolve(serviceAccountPath)
        : "APPLICATION_DEFAULT_CREDENTIALS",
      approvedIdFormat: "IE-{wardPcode}-YYYYMMDD-hhmmss-XXXX",
    });

    const counterBefore = await readCounterState(db);
    const scanResult = await scanNoncompliantInformalErfs({ db, pageSize });
    const blockers = collectBlockers(scanResult);
    const maximumDeletedParcelNumber = getMaximumDeletedParcelNumber(
      scanResult.records,
    );
    const counterFloorRequired = Math.max(
      counterBefore.lastNumber,
      maximumDeletedParcelNumber,
    );
    const registryRowsFound = scanResult.records.filter(
      (record) => record.registry.exists,
    ).length;

    console.log("[INFORMAL ERF CLEANUP] PLAN SUMMARY", {
      projectId,
      mode,
      pagesRead: scanResult.pagesRead,
      scanned: scanResult.scanned,
      compliant: scanResult.compliant,
      noncompliant: scanResult.records.length,
      registryRowsFound,
      affectedWards: scanResult.affectedWards,
      affectedGeoFences: scanResult.affectedGeoFences,
      blockers,
      counterBefore,
      maximumDeletedParcelNumber,
      counterFloorRequired,
      counterIncreaseRequired:
        counterFloorRequired > counterBefore.lastNumber,
      storagePhotographsPlannedForDeletion: 0,
      wardRegistryDocumentsPlannedForDeletion: 0,
      globalCounterReductionPlanned: false,
    });

    if (!execute) {
      console.log("[INFORMAL ERF CLEANUP] COMPLETE", {
        projectId,
        mode,
        pagesRead: scanResult.pagesRead,
        scanned: scanResult.scanned,
        compliant: scanResult.compliant,
        noncompliant: scanResult.records.length,
        registryRowsFound,
        affectedWardCount: scanResult.affectedWards.length,
        affectedGeoFenceCount: scanResult.affectedGeoFences.length,
        blockers: blockers.length,
        writesPerformed: 0,
        elapsedMs: Date.now() - startedAtMs,
      });
      return;
    }

    if (blockers.length > 0) {
      throw new Error(
        `Destructive execution blocked by ${blockers.length} unresolved cleanup preflight issue(s).`,
      );
    }

    const counterFloorResult = await ensureCounterFloor({
      db,
      requiredFloor: counterFloorRequired,
    });

    console.log("[INFORMAL ERF CLEANUP] COUNTER FLOOR COMPLETE", {
      ...counterFloorResult,
      maximumDeletedParcelNumber,
      deletedParcelNumbersWillNotBeReused: true,
    });

    const deletionResult = await deleteNoncompliantRecords({
      db,
      records: scanResult.records,
    });
    const wardRowsRebuilt = await rebuildAffectedWardCounts(
      scanResult.affectedWards,
    );
    const geofenceResult = await recomputeAffectedGeoFenceCounts({
      db,
      affectedGeoFences: scanResult.affectedGeoFences,
    });
    const counterAfter = await readCounterState(db);

    if (
      Number.isFinite(counterBefore.lastNumber) &&
      Number.isFinite(counterAfter.lastNumber) &&
      counterAfter.lastNumber < counterBefore.lastNumber
    ) {
      throw new Error(
        "The global Informal ERF counter decreased unexpectedly. Immediate investigation is required.",
      );
    }

    if (counterAfter.lastNumber < maximumDeletedParcelNumber) {
      throw new Error(
        "The global Informal ERF counter is below a deleted parcel number. Deleted parcel numbers could be reused.",
      );
    }

    console.log("[INFORMAL ERF CLEANUP] COMPLETE", {
      projectId,
      mode,
      pagesRead: scanResult.pagesRead,
      scanned: scanResult.scanned,
      compliant: scanResult.compliant,
      noncompliant: scanResult.records.length,
      deletedErfs: deletionResult.deletedErfs,
      deletedRegistryRows: deletionResult.deletedRegistryRows,
      deleteBatchesCommitted: deletionResult.batchesCommitted,
      wardRowsRebuilt,
      geofenceCountsRecomputed: geofenceResult.recomputed,
      missingGeoFences: geofenceResult.missing,
      counterBefore,
      counterFloorResult,
      counterAfter,
      maximumDeletedParcelNumber,
      globalCounterReduced: false,
      deletedParcelNumbersWillNotBeReused: true,
      storagePhotographsDeleted: 0,
      wardRegistryDocumentsDeleted: 0,
      elapsedMs: Date.now() - startedAtMs,
    });
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error("[INFORMAL ERF CLEANUP] FAILED", {
    code: error?.code || "INFORMAL_ERF_CLEANUP_FAILED",
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
  process.exitCode = 1;
});
