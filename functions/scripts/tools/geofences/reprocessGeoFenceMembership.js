#!/usr/bin/env node

/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import {
  FieldPath,
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";

import {
  doesEntityBelongToGeoFence,
  extractAstPoint,
  extractErfPoint,
  extractPremisePoint,
  normalizeGeoFenceRefs,
} from "../../../geofences/helpers.js";

const SCRIPT_NAME = "reprocessGeoFenceMembership.js";
const DEV_PROJECT_ID = "ireps2";
const DEFAULT_PAGE_SIZE = 400;
const DEFAULT_BATCH_SIZE = 200;
const MAX_PAGE_SIZE = 1000;
const MAX_BATCH_SIZE = 400;

function parseArgs(argv = []) {
  const parsed = {
    execute: false,
    projectId: "",
    serviceAccount: "",
    geoFenceId: "",
    expectedLmPcode: "",
    expectedWardPcode: "",
    pageSize: DEFAULT_PAGE_SIZE,
    batchSize: DEFAULT_BATCH_SIZE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--execute") {
      parsed.execute = true;
      continue;
    }

    const nextValue = argv[index + 1];

    if (!nextValue || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    switch (token) {
      case "--project-id":
        parsed.projectId = nextValue;
        break;
      case "--service-account":
        parsed.serviceAccount = nextValue;
        break;
      case "--geofence-id":
        parsed.geoFenceId = nextValue;
        break;
      case "--expected-lm":
        parsed.expectedLmPcode = nextValue;
        break;
      case "--expected-ward":
        parsed.expectedWardPcode = nextValue;
        break;
      case "--page-size":
        parsed.pageSize = Number(nextValue);
        break;
      case "--batch-size":
        parsed.batchSize = Number(nextValue);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }

    index += 1;
  }

  return parsed;
}

function requireText(value, label) {
  const text = String(value || "").trim();

  if (!text) {
    throw new Error(`${label} is required.`);
  }

  return text;
}

function normalizeScope(value) {
  return String(value || "").trim().toUpperCase();
}

function validatePositiveInteger(value, label, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`);
  }

  return value;
}

function readServiceAccount(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Service-account file not found: ${resolvedPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

  if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) {
    throw new Error("Service-account JSON is missing required fields.");
  }

  return {
    resolvedPath,
    value: parsed,
  };
}

function normalizePolygonPoints(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((point, index) => ({
      latitude: Number(point?.latitude ?? point?.lat),
      longitude: Number(point?.longitude ?? point?.lng),
      order: Number.isFinite(Number(point?.order))
        ? Number(point.order)
        : index,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude),
    )
    .sort((left, right) => left.order - right.order);
}

function hasGeoFenceRef(data = {}, geoFenceId = "") {
  return normalizeGeoFenceRefs(data?.geofenceRefs || []).some(
    (ref) => ref?.id === geoFenceId,
  );
}

function buildMembershipPatch(geoFenceId, geoFenceName) {
  return {
    geofenceRefs: FieldValue.arrayUnion({
      id: geoFenceId,
      name: geoFenceName,
    }),
  };
}

async function commitPatches({
  db,
  patches = [],
  batchSize,
}) {
  let batchesCommitted = 0;
  let docsUpdated = 0;

  for (let index = 0; index < patches.length; index += batchSize) {
    const chunk = patches.slice(index, index + batchSize);
    const batch = db.batch();

    for (const patch of chunk) {
      batch.update(patch.ref, patch.data);
    }

    await batch.commit();

    batchesCommitted += 1;
    docsUpdated += chunk.length;
  }

  return {
    batchesCommitted,
    docsUpdated,
  };
}

async function processPagedQuery({
  db,
  label,
  query,
  pageSize,
  batchSize,
  execute,
  assessDoc,
}) {
  const summary = {
    label,
    pagesRead: 0,
    docsRead: 0,
    pointsChecked: 0,
    memberCount: 0,
    alreadyLinked: 0,
    updatesRequired: 0,
    docsUpdated: 0,
    batchesCommitted: 0,
  };

  let lastDoc = null;

  while (true) {
    let pageQuery = query
      .orderBy(FieldPath.documentId())
      .limit(pageSize);

    if (lastDoc) {
      pageQuery = pageQuery.startAfter(lastDoc);
    }

    const snapshot = await pageQuery.get();

    if (snapshot.empty) {
      break;
    }

    summary.pagesRead += 1;
    summary.docsRead += snapshot.size;

    const patches = [];

    for (const doc of snapshot.docs) {
      const result = assessDoc(doc);

      summary.pointsChecked += result.pointsChecked || 0;

      if (!result.belongs) {
        continue;
      }

      summary.memberCount += 1;

      if (result.alreadyLinked) {
        summary.alreadyLinked += 1;
        continue;
      }

      summary.updatesRequired += 1;

      if (result.patch) {
        patches.push({
          ref: doc.ref,
          data: result.patch,
        });
      }
    }

    if (execute && patches.length > 0) {
      const commit = await commitPatches({
        db,
        patches,
        batchSize,
      });

      summary.docsUpdated += commit.docsUpdated;
      summary.batchesCommitted += commit.batchesCommitted;
    }

    console.log(
      `[${label}] page ${summary.pagesRead}: ` +
        `read=${snapshot.size}, totalRead=${summary.docsRead}, ` +
        `members=${summary.memberCount}, ` +
        `plannedUpdates=${summary.updatesRequired}, ` +
        `written=${summary.docsUpdated}`,
    );

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < pageSize) {
      break;
    }
  }

  return summary;
}

function assessSinglePointEntity({
  doc,
  pointExtractor,
  geoFenceId,
  geoFenceName,
  bbox,
  polygonPoints,
}) {
  const data = doc.data() || {};
  const point = pointExtractor(data);

  if (!point) {
    return {
      belongs: false,
      pointsChecked: 0,
      alreadyLinked: false,
      patch: null,
    };
  }

  const belongs = doesEntityBelongToGeoFence({
    point,
    bbox,
    polygonPoints,
  });

  if (!belongs) {
    return {
      belongs: false,
      pointsChecked: 1,
      alreadyLinked: false,
      patch: null,
    };
  }

  const alreadyLinked = hasGeoFenceRef(data, geoFenceId);

  return {
    belongs: true,
    pointsChecked: 1,
    alreadyLinked,
    patch: alreadyLinked
      ? null
      : buildMembershipPatch(geoFenceId, geoFenceName),
  };
}

function getSalesCandidates(sales = {}) {
  const candidates = sales?.ErfCandidates ?? sales?.erfCandidates;
  return Array.isArray(candidates) ? candidates : [];
}

function getSalesCandidatePoint(candidate = {}) {
  const latitude = Number(candidate?.Latitude ?? candidate?.latitude);
  const longitude = Number(candidate?.Longitude ?? candidate?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function salesCandidateMatchesScope(candidate, lmPcode, wardPcode) {
  return (
    normalizeScope(candidate?.LmPcode ?? candidate?.lmPcode) ===
      normalizeScope(lmPcode) &&
    normalizeScope(candidate?.WardPcode ?? candidate?.wardPcode) ===
      normalizeScope(wardPcode)
  );
}

function assessSalesDoc({
  doc,
  geoFenceId,
  geoFenceName,
  lmPcode,
  wardPcode,
  bbox,
  polygonPoints,
}) {
  const sales = doc.data() || {};

  if (sales?.HasUsableGps !== true && sales?.hasUsableGps !== true) {
    return {
      belongs: false,
      pointsChecked: 0,
      alreadyLinked: false,
      patch: null,
    };
  }

  let pointsChecked = 0;
  let belongs = false;

  for (const candidate of getSalesCandidates(sales)) {
    if (!salesCandidateMatchesScope(candidate, lmPcode, wardPcode)) {
      continue;
    }

    const point = getSalesCandidatePoint(candidate);

    if (!point) {
      continue;
    }

    pointsChecked += 1;

    if (
      doesEntityBelongToGeoFence({
        point,
        bbox,
        polygonPoints,
      })
    ) {
      belongs = true;
      break;
    }
  }

  if (!belongs) {
    return {
      belongs: false,
      pointsChecked,
      alreadyLinked: false,
      patch: null,
    };
  }

  const alreadyLinked = hasGeoFenceRef(sales, geoFenceId);

  return {
    belongs: true,
    pointsChecked,
    alreadyLinked,
    patch: alreadyLinked
      ? null
      : buildMembershipPatch(geoFenceId, geoFenceName),
  };
}

async function countRefsInPagedQuery({
  label,
  query,
  pageSize,
  geoFenceId,
}) {
  let pagesRead = 0;
  let docsRead = 0;
  let refCount = 0;
  let lastDoc = null;

  while (true) {
    let pageQuery = query
      .orderBy(FieldPath.documentId())
      .limit(pageSize);

    if (lastDoc) {
      pageQuery = pageQuery.startAfter(lastDoc);
    }

    const snapshot = await pageQuery.get();

    if (snapshot.empty) {
      break;
    }

    pagesRead += 1;
    docsRead += snapshot.size;

    for (const doc of snapshot.docs) {
      if (hasGeoFenceRef(doc.data() || {}, geoFenceId)) {
        refCount += 1;
      }
    }

    console.log(
      `[VERIFY ${label}] page ${pagesRead}: ` +
        `read=${snapshot.size}, totalRead=${docsRead}, refs=${refCount}`,
    );

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < pageSize) {
      break;
    }
  }

  return {
    pagesRead,
    docsRead,
    refCount,
  };
}

function buildQueries(db, lmPcode, wardPcode) {
  return {
    erfs: db
      .collection("ireps_erfs")
      .where("admin.localMunicipality.pcode", "==", lmPcode)
      .where("admin.ward.pcode", "==", wardPcode),
    premises: db
      .collection("premises")
      .where("parents.lmPcode", "==", lmPcode)
      .where("parents.wardPcode", "==", wardPcode),
    asts: db
      .collection("asts")
      .where("accessData.parents.lmPcode", "==", lmPcode)
      .where("accessData.parents.wardPcode", "==", wardPcode),
    sales: db
      .collection("demo_sales_meters")
      .where("HasUsableGps", "==", true),
  };
}

function buildReportPath(geoFenceId, mode) {
  const currentFile = fileURLToPath(import.meta.url);
  const reportDir = path.join(path.dirname(currentFile), "reports");
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");

  fs.mkdirSync(reportDir, { recursive: true });

  return path.join(
    reportDir,
    `reprocess_geofence_${geoFenceId}_${mode}_${timestamp}.json`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const projectId = requireText(options.projectId, "--project-id");
  const serviceAccountPath = requireText(
    options.serviceAccount,
    "--service-account",
  );
  const geoFenceId = requireText(options.geoFenceId, "--geofence-id");
  const expectedLmPcode = requireText(
    options.expectedLmPcode,
    "--expected-lm",
  );
  const expectedWardPcode = requireText(
    options.expectedWardPcode,
    "--expected-ward",
  );
  const pageSize = validatePositiveInteger(
    options.pageSize,
    "--page-size",
    MAX_PAGE_SIZE,
  );
  const batchSize = validatePositiveInteger(
    options.batchSize,
    "--batch-size",
    MAX_BATCH_SIZE,
  );

  const mode = options.execute ? "EXECUTE" : "DRY_RUN";

  if (projectId !== DEV_PROJECT_ID) {
    throw new Error(
      `DEV-only project guard failed: this utility may run only against ` +
        `${DEV_PROJECT_ID}, received ${projectId}.`,
    );
  }

  const serviceAccount = readServiceAccount(serviceAccountPath);

  if (serviceAccount.value.project_id !== projectId) {
    throw new Error(
      `Project guard failed: service account is for ` +
        `${serviceAccount.value.project_id}, expected ${projectId}.`,
    );
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount.value),
      projectId,
    });
  }

  const db = getFirestore();
  const geoFenceRef = db.collection("geo_fences").doc(geoFenceId);
  const geoFenceSnapshot = await geoFenceRef.get();

  if (!geoFenceSnapshot.exists) {
    throw new Error(`Geofence not found: ${geoFenceId}`);
  }

  const geoFence = geoFenceSnapshot.data() || {};
  const storedId = String(geoFence?.id || "").trim();
  const geoFenceName = String(
    geoFence?.name || geoFence?.description || storedId || geoFenceId,
  ).trim();
  const lmPcode = String(geoFence?.parents?.lmPcode || "").trim();
  const wardPcode = String(geoFence?.parents?.wardPcode || "").trim();
  const bbox = geoFence?.geometry?.bbox || null;
  const polygonPoints = normalizePolygonPoints(
    geoFence?.geometry?.points || [],
  );

  if (storedId !== geoFenceId) {
    throw new Error(
      `Geofence ID guard failed: document ID=${geoFenceId}, stored id=${storedId}.`,
    );
  }

  if (geoFence?.status !== "ACTIVE") {
    throw new Error(`Geofence is not ACTIVE: ${geoFence?.status}`);
  }

  if (normalizeScope(lmPcode) !== normalizeScope(expectedLmPcode)) {
    throw new Error(
      `LM guard failed: geofence=${lmPcode}, expected=${expectedLmPcode}.`,
    );
  }

  if (normalizeScope(wardPcode) !== normalizeScope(expectedWardPcode)) {
    throw new Error(
      `Ward guard failed: geofence=${wardPcode}, expected=${expectedWardPcode}.`,
    );
  }

  if (!bbox || polygonPoints.length < 3) {
    throw new Error("Geofence geometry is invalid.");
  }

  console.log("");
  console.log("==============================================");
  console.log("GEOFENCE MEMBERSHIP RECOVERY");
  console.log("==============================================");
  console.log(`Mode:            ${mode}`);
  console.log(`Project:         ${projectId}`);
  console.log(`Geofence ID:     ${geoFenceId}`);
  console.log(`Geofence name:   ${geoFenceName}`);
  console.log(`LM:              ${lmPcode}`);
  console.log(`Ward:            ${wardPcode}`);
  console.log(`Polygon points:  ${polygonPoints.length}`);
  console.log(`Page size:       ${pageSize}`);
  console.log(`Batch size:      ${batchSize}`);
  console.log(`Existing counts: ${JSON.stringify(geoFence?.counts || {})}`);
  console.log("");

  const queries = buildQueries(db, lmPcode, wardPcode);

  const phaseSummaries = {};

  phaseSummaries.erfs = await processPagedQuery({
    db,
    label: "ERFS",
    query: queries.erfs,
    pageSize,
    batchSize,
    execute: options.execute,
    assessDoc: (doc) =>
      assessSinglePointEntity({
        doc,
        pointExtractor: extractErfPoint,
        geoFenceId,
        geoFenceName,
        bbox,
        polygonPoints,
      }),
  });

  phaseSummaries.premises = await processPagedQuery({
    db,
    label: "PREMISES",
    query: queries.premises,
    pageSize,
    batchSize,
    execute: options.execute,
    assessDoc: (doc) =>
      assessSinglePointEntity({
        doc,
        pointExtractor: extractPremisePoint,
        geoFenceId,
        geoFenceName,
        bbox,
        polygonPoints,
      }),
  });

  phaseSummaries.asts = await processPagedQuery({
    db,
    label: "ASTS",
    query: queries.asts,
    pageSize,
    batchSize,
    execute: options.execute,
    assessDoc: (doc) =>
      assessSinglePointEntity({
        doc,
        pointExtractor: extractAstPoint,
        geoFenceId,
        geoFenceName,
        bbox,
        polygonPoints,
      }),
  });

  phaseSummaries.sales = await processPagedQuery({
    db,
    label: "DEMO SALES",
    query: queries.sales,
    pageSize,
    batchSize,
    execute: options.execute,
    assessDoc: (doc) =>
      assessSalesDoc({
        doc,
        geoFenceId,
        geoFenceName,
        lmPcode,
        wardPcode,
        bbox,
        polygonPoints,
      }),
  });

  const plannedCounts = {
    erfs: phaseSummaries.erfs.memberCount,
    premises: phaseSummaries.premises.memberCount,
    meters: phaseSummaries.asts.memberCount,
    salesMeters: phaseSummaries.sales.memberCount,
  };

  let verification = null;
  let geoFenceCountsUpdated = false;

  if (options.execute) {
    console.log("");
    console.log("==============================================");
    console.log("POST-WRITE VERIFICATION");
    console.log("==============================================");

    verification = {
      erfs: await countRefsInPagedQuery({
        label: "ERFS",
        query: queries.erfs,
        pageSize,
        geoFenceId,
      }),
      premises: await countRefsInPagedQuery({
        label: "PREMISES",
        query: queries.premises,
        pageSize,
        geoFenceId,
      }),
      asts: await countRefsInPagedQuery({
        label: "ASTS",
        query: queries.asts,
        pageSize,
        geoFenceId,
      }),
      sales: await countRefsInPagedQuery({
        label: "DEMO SALES",
        query: queries.sales,
        pageSize,
        geoFenceId,
      }),
    };

    const verifiedCounts = {
      erfs: verification.erfs.refCount,
      premises: verification.premises.refCount,
      meters: verification.asts.refCount,
      salesMeters: verification.sales.refCount,
    };

    if (JSON.stringify(verifiedCounts) !== JSON.stringify(plannedCounts)) {
      throw new Error(
        `Verification count mismatch. Planned=${JSON.stringify(plannedCounts)} ` +
          `Verified=${JSON.stringify(verifiedCounts)}. ` +
          "Geofence counts were not updated.",
      );
    }

    await geoFenceRef.update({
      counts: verifiedCounts,
      "metadata.updatedAt": new Date().toISOString(),
      "metadata.updatedByUid": "SYSTEM_SCRIPT",
      "metadata.updatedByUser": SCRIPT_NAME,
    });

    geoFenceCountsUpdated = true;
  }

  const totalUpdatesRequired = Object.values(phaseSummaries).reduce(
    (sum, phase) => sum + phase.updatesRequired,
    0,
  );
  const totalDocsUpdated = Object.values(phaseSummaries).reduce(
    (sum, phase) => sum + phase.docsUpdated,
    0,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    script: SCRIPT_NAME,
    mode,
    projectId,
    serviceAccountProjectId: serviceAccount.value.project_id,
    geoFence: {
      id: geoFenceId,
      name: geoFenceName,
      status: geoFence?.status,
      lmPcode,
      wardPcode,
      polygonPointCount: polygonPoints.length,
      originalCounts: geoFence?.counts || {},
    },
    safety: {
      removesMembershipRefs: false,
      writesAllowed: options.execute,
      geofenceCountsUpdated: geoFenceCountsUpdated,
    },
    phaseSummaries,
    plannedCounts,
    totalUpdatesRequired,
    totalDocsUpdated,
    verification,
  };

  const reportPath = buildReportPath(geoFenceId, mode);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("");
  console.log("==============================================");
  console.log("RECOVERY SUMMARY");
  console.log("==============================================");
  console.log(`Mode:                    ${mode}`);
  console.log(`Planned counts:          ${JSON.stringify(plannedCounts)}`);
  console.log(`Updates required:        ${totalUpdatesRequired}`);
  console.log(`Documents updated:       ${totalDocsUpdated}`);
  console.log(`Geofence counts updated: ${geoFenceCountsUpdated ? "YES" : "NO"}`);
  console.log(`Report:                  ${reportPath}`);

  if (!options.execute) {
    console.log("");
    console.log("DRY RUN ONLY - NO FIRESTORE WRITES WERE PERFORMED.");
  }
}

main().catch((error) => {
  console.error("");
  console.error("==============================================");
  console.error("RECOVERY FAILED");
  console.error("==============================================");
  console.error(error);
  process.exitCode = 1;
});
