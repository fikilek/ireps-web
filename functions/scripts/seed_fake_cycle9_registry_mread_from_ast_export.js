#!/usr/bin/env node
/*
 * iREPS MREAD Staging Test Data
 * Seed fake Cycle 9 registry_mread rows from an AST export.
 *
 * Purpose:
 * - Build previous-cycle MREAD evidence for Cycle 10 staging tests.
 * - Use AST export for meter/premise/geofence context.
 * - Generate fake Cycle 9 readings and same-day reading times.
 * - Write only to registry_mread.
 *
 * Safety:
 * - Dry-run by default.
 * - Firestore write only when --confirm is supplied.
 * - Existing fake docs are skipped unless --force is supplied.
 * - Every generated registry_mread row has root fake: true.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import admin from "firebase-admin";

import {
  MREAD_OUTCOMES,
  REGISTRY_MREAD_COLLECTION,
  mapTrnMreadToRegistryMread,
} from "../registry/mread/index.js";

const SCRIPT_NAME = "seed_fake_cycle9_registry_mread_from_ast_export.js";
const SCRIPT_VERSION = "2.1.0";
const NAv = "NAv";

const DEFAULTS = Object.freeze({
  input: "",
  lmPcode: "ZA2157",
  wardPcode: "ZA2157008",
  geofenceId: "Mvtjb8Jlgd02CmfnGjTQ",
  geofenceName: "Gf Maninjwa",
  cycleId: "ZA2157_2025_2026_CYCLE_09",
  cycleLabel: "Cycle 9 - 2025/26",
  billingPeriod: "2025/26",
  cycleNo: 9,
  windowStartDate: "2026-03-16",
  windowEndDate: "2026-04-15",
  readingDay: "2026-04-10",
  startTime: "08:00",
  minGapMinutes: 4,
  maxGapMinutes: 11,
  minBackConsumption: 20,
  maxBackConsumption: 250,
  fallbackMinReading: 10,
  fallbackMaxReading: 999,
  laterRealMinDelta: 20,
  laterRealMaxDelta: 120,
  registryExport: "",
  seed: "ireps-cycle9-gf-maninjwa-20260619-v2-1",
});

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;

    const key = item.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }

  return args;
}

function parseInteger(value, fallback) {
  const num = Number(value);
  return Number.isInteger(num) ? num : fallback;
}

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readString(value, fallback = NAv) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function readNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeIdSegment(value, fallback = "NAV") {
  const clean = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 140);

  return clean || fallback;
}

function cleanJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, itemValue) =>
      itemValue === undefined ? null : itemValue,
    ),
  );
}

function hashString(value) {
  let hash = 1779033703 ^ String(value || "").length;
  for (let i = 0; i < String(value || "").length; i += 1) {
    hash = Math.imul(hash ^ String(value || "").charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return hash >>> 0;
  };
}

function seededRandom(seed) {
  const seedFn = hashString(seed);
  let state = seedFn();
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, min, max) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.floor(rng() * (safeMax - safeMin + 1)) + safeMin;
}

function parseHourMinute(value) {
  const [hhRaw, mmRaw] = String(value || "08:00").split(":");
  const hour = Math.min(Math.max(parseInteger(hhRaw, 8), 0), 23);
  const minute = Math.min(Math.max(parseInteger(mmRaw, 0), 0), 59);
  return { hour, minute };
}

function toSastReadingAtIso({ readingDay, minutesFromMidnight }) {
  const [year, month, day] = String(readingDay).split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid --readingDay. Expected YYYY-MM-DD, got ${readingDay}`);
  }

  // Convert SAST local time to UTC ISO. SAST is UTC+02:00.
  const utcMillis = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 2 * 60 * 60000;
  return new Date(utcMillis + minutesFromMidnight * 60000).toISOString();
}

function formatSastDisplay(iso) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

function loadAstExport(inputPath) {
  if (!inputPath) {
    throw new Error("Missing required --input path to AST export JSON file.");
  }

  const resolved = path.resolve(inputPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);

  return Object.entries(parsed)
    .filter(([docPath, data]) => docPath.startsWith("asts/") && data?.__exists__ !== false)
    .map(([docPath, data]) => ({ docPath, astId: docPath.split("/").pop(), data }));
}

function loadRegistryExport(inputPath) {
  if (!inputPath) return [];

  const resolved = path.resolve(inputPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);

  return Object.entries(parsed)
    .filter(([docPath, data]) =>
      docPath.startsWith(`${REGISTRY_MREAD_COLLECTION}/`) && data?.__exists__ !== false,
    )
    .map(([docPath, data]) => ({ docPath, id: docPath.split("/").pop(), data }));
}

function toUtcEndOfSastDate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  if (!year || !month || !day) return 0;
  // SAST end of day converted to UTC.
  return Date.UTC(year, month - 1, day, 23, 59, 59, 999) - 2 * 60 * 60000;
}

function isSuccessfulMreadRegistryRow(row = {}) {
  return row?.outcome?.outcome === MREAD_OUTCOMES.SUCCESSFUL_READING;
}

function isFakeRegistryRow(row = {}) {
  return row?.fake === true || row?.fakeSeed?.seedType === "FAKE_MREAD_CYCLE_9_TEST_DATA";
}

function getFirstLaterRealReading({ item, registryRows, args }) {
  if (!Array.isArray(registryRows) || !registryRows.length) return null;

  const ast = item.data || {};
  const meterNo = getMeterNo(ast).toUpperCase();
  const astId = item.astId;
  const premiseId = readString(getPremise(ast)?.id, "");
  const afterMillis = toUtcEndOfSastDate(args.windowEndDate);

  const matches = registryRows
    .map((registryItem) => {
      const row = registryItem.data || {};
      const reading = readNumber(row?.reading?.currentReading);
      const readingAt = readString(row?.reading?.readingAt, "");
      const readingMillis = Date.parse(readingAt || "");
      const rowAstId = readString(row?.meter?.astId, "");
      const rowMeterNo = readString(row?.meter?.astNo, "").toUpperCase();
      const rowPremiseId = readString(row?.premise?.premiseId, "");

      return {
        id: registryItem.id,
        trnId: row?.source?.trnId || registryItem.id,
        astId: rowAstId,
        meterNo: rowMeterNo,
        premiseId: rowPremiseId,
        reading,
        readingAt,
        readingMillis,
        source: "REGISTRY_MREAD_REAL_LATER",
      };
    })
    .filter((candidate) => {
      if (candidate.reading === null) return false;
      if (!Number.isFinite(candidate.readingMillis)) return false;
      if (candidate.readingMillis <= afterMillis) return false;

      const sourceRow = registryRows.find((itemRow) => itemRow.id === candidate.id)?.data || {};
      if (isFakeRegistryRow(sourceRow)) return false;
      if (!isSuccessfulMreadRegistryRow(sourceRow)) return false;

      const sameAst = astId && candidate.astId === astId;
      const sameMeterAndPremise = meterNo && premiseId && candidate.meterNo === meterNo && candidate.premiseId === premiseId;
      const sameMeterOnly = meterNo && candidate.meterNo === meterNo;
      return sameAst || sameMeterAndPremise || sameMeterOnly;
    })
    .sort((a, b) => a.readingMillis - b.readingMillis);

  return matches[0] || null;
}

function getAstData(row = {}) {
  return row?.ast?.astData || {};
}

function getMeter(row = {}) {
  return getAstData(row)?.meter || {};
}

function getMeterNo(row = {}) {
  return readString(
    getAstData(row)?.astNo || row?.master?.id || row?.meterNo,
    NAv,
  );
}

function getMeterKind(row = {}) {
  return readString(getMeter(row)?.type || row?.meterKind, NAv).toLowerCase();
}

function getMeterType(row = {}) {
  return readString(row?.meterType || row?.ast?.meterType, NAv).toLowerCase();
}

function getPremise(row = {}) {
  return row?.accessData?.premise || {};
}

function getParents(row = {}) {
  return row?.accessData?.parents || {};
}

function hasTargetGeofence(row = {}, { geofenceId, geofenceName }) {
  const refs = Array.isArray(row?.geofenceRefs) ? row.geofenceRefs : [];
  const idNeedle = String(geofenceId || "").toLowerCase();
  const nameNeedle = String(geofenceName || "").toLowerCase();

  return refs.some((ref) => {
    const id = String(ref?.id || ref?.geofenceId || "").toLowerCase();
    const name = String(ref?.name || ref?.geofenceName || "").toLowerCase();
    return (idNeedle && id === idNeedle) || (nameNeedle && name === nameNeedle);
  });
}

function isExplicitInclude(item, includeAstIds, includeMeterNos) {
  const meterNo = getMeterNo(item.data);
  return (
    includeAstIds.includes(item.astId) ||
    includeAstIds.includes(item.docPath) ||
    includeMeterNos.map((value) => value.toUpperCase()).includes(meterNo.toUpperCase())
  );
}

function getLatestNumericReading(row = {}) {
  const mreadings = Array.isArray(row?.mreadings) ? row.mreadings : [];
  const candidates = mreadings
    .map((item) => ({
      reading: readNumber(item?.reading),
      readingAt: readString(item?.readingAt, ""),
      source: readString(item?.source, NAv),
      trnId: readString(item?.trnId, NAv),
    }))
    .filter((item) => item.reading !== null)
    .sort((a, b) => Date.parse(b.readingAt || 0) - Date.parse(a.readingAt || 0));

  if (candidates.length) return candidates[0];

  const astCreationReading = readNumber(row?.reading || row?.meterReading?.reading);
  if (astCreationReading !== null) {
    return {
      reading: astCreationReading,
      readingAt: readString(row?.metadata?.createdAt, ""),
      source: "AST_FALLBACK",
      trnId: readString(row?.trnId, NAv),
    };
  }

  return null;
}

function isZeroAstCreationAnchor(latest) {
  const source = String(latest?.source || "").toUpperCase();
  return latest?.reading === 0 && source.includes("AST_CREATION");
}

function buildZeroBaselineReading(latest) {
  return {
    currentReading: 0,
    baseReading: latest?.reading ?? 0,
    generatedDelta: 0,
    generationMethod: "NEW_METER_ZERO_BASELINE",
    anchorSource: latest,
    referenceLaterReading: null,
  };
}

function generateFakeReading({ row, rng, args, firstLaterRealReading }) {
  const latest = getLatestNumericReading(row);
  const anchor = latest?.reading ?? null;
  const minBackConsumption = parseInteger(args.minBackConsumption, DEFAULTS.minBackConsumption);
  const maxBackConsumption = parseInteger(args.maxBackConsumption, DEFAULTS.maxBackConsumption);
  const fallbackMinReading = parseInteger(args.fallbackMinReading, DEFAULTS.fallbackMinReading);
  const fallbackMaxReading = parseInteger(args.fallbackMaxReading, DEFAULTS.fallbackMaxReading);
  const laterRealMinDelta = parseInteger(args.laterRealMinDelta, DEFAULTS.laterRealMinDelta);
  const laterRealMaxDelta = parseInteger(args.laterRealMaxDelta, DEFAULTS.laterRealMaxDelta);

  // New-meter rule: if the only source baseline is an AST creation reading of 0,
  // keep the Cycle 9 seed at 0. A new meter starts at 0, so do not invent usage.
  if (isZeroAstCreationAnchor(latest)) {
    return buildZeroBaselineReading(latest);
  }

  // Preferred rule for reseeding: when a later real MREAD exists, the fake Cycle 9
  // reading must sit below the first later real reading. This prevents confusing
  // lower-reading or negative-consumption scenarios during Cycle 10 staging tests.
  if (firstLaterRealReading?.reading !== null && firstLaterRealReading?.reading !== undefined) {
    const delta = randomInt(rng, laterRealMinDelta, laterRealMaxDelta);
    const safeCurrent = Math.max(0, firstLaterRealReading.reading - delta);
    return {
      currentReading: safeCurrent,
      baseReading: firstLaterRealReading.reading,
      generatedDelta: delta,
      generationMethod: "REFERENCE_LATER_REAL_MINUS_RANDOM_DELTA",
      anchorSource: latest,
      referenceLaterReading: firstLaterRealReading,
    };
  }

  if (anchor !== null) {
    if (anchor <= 0) {
      return buildZeroBaselineReading(latest);
    }

    // If there is no later real MREAD reference, still keep the fake Cycle 9
    // reading at or below the latest known anchor from the AST export.
    // This avoids impossible timelines such as a fake April reading higher than
    // a real/AST reading captured later in June. For small anchor readings, use
    // a smaller safe delta instead of falling back to an uncapped random value.
    const maxSafeDelta = Math.max(1, Math.min(maxBackConsumption, anchor));
    const minSafeDelta = Math.min(minBackConsumption, maxSafeDelta);
    const delta = randomInt(rng, minSafeDelta, maxSafeDelta);

    return {
      currentReading: Math.max(0, anchor - delta),
      baseReading: anchor,
      generatedDelta: delta,
      generationMethod: "ANCHOR_CAPPED_MINUS_RANDOM_DELTA",
      anchorSource: latest,
      referenceLaterReading: null,
    };
  }

  return {
    currentReading: randomInt(rng, fallbackMinReading, fallbackMaxReading),
    baseReading: anchor,
    generatedDelta: null,
    generationMethod: "FALLBACK_RANDOM_READING_NO_ANCHOR",
    anchorSource: latest,
    referenceLaterReading: null,
  };
}

function buildFakeTrn({ item, readingAt, currentReading, trnId }) {
  const ast = item.data || {};
  const premise = getPremise(ast);
  const parents = getParents(ast);
  const meterNo = getMeterNo(ast);

  return cleanJson({
    id: trnId,
    trnId,
    trnType: "METER_READING",
    workflowState: "COMPLETED",
    workflow: {
      state: "COMPLETED",
      completedAt: readingAt,
      completedByUid: "SYSTEM_SCRIPT",
      completedByUser: SCRIPT_NAME,
    },
    executionOutcome: {
      outcome: MREAD_OUTCOMES.SUCCESSFUL_READING,
      completedAt: readingAt,
      currentReading,
      reading: currentReading,
      previousReading: null,
      previousReadingAt: null,
      previousReadingTrnId: NAv,
    },
    meterReading: {
      reading: String(currentReading),
      currentReading,
      readingAt,
      readingGps: ast?.ast?.location?.gps || null,
      executorNotes: "Fake Cycle 9 MREAD seed row generated for Cycle 10 staging test.",
    },
    accessData: ast.accessData || {
      parents,
      premise,
    },
    geofenceRefs: Array.isArray(ast.geofenceRefs) ? ast.geofenceRefs : [],
    ast: ast.ast || {},
    master: ast.master || {
      id: meterNo,
      visibility: NAv,
    },
    status: ast.status || {},
    meterType: ast.meterType || NAv,
    serviceProvider: ast.serviceProvider || {},
    stream: {
      streamType: "UNCONTROLLED",
    },
    actor: {
      role: "SYSTEM_SCRIPT",
      spId: ast?.serviceProvider?.id || NAv,
      spName: ast?.serviceProvider?.name || NAv,
    },
    team: {
      id: NAv,
      name: NAv,
    },
    media: [],
    metadata: {
      createdAt: readingAt,
      createdByUid: "SYSTEM_SCRIPT",
      createdByUser: SCRIPT_NAME,
      updatedAt: readingAt,
      updatedByUid: "SYSTEM_SCRIPT",
      updatedByUser: SCRIPT_NAME,
      createdByRole: "SYSTEM_SCRIPT",
    },
  });
}

function buildRegistryRow({ item, args, readingAt, currentReading, generatedReading, includedManually }) {
  const ast = item.data || {};
  const meterNo = getMeterNo(ast);
  const premise = getPremise(ast);
  const premiseId = readString(premise?.id, "UNKNOWN_PREMISE");
  const trnId = `FAKE_MREAD_CYCLE09_${sanitizeIdSegment(meterNo)}_${sanitizeIdSegment(premiseId)}`;
  const fakeTrn = buildFakeTrn({ item, readingAt, currentReading, trnId });
  const mapped = mapTrnMreadToRegistryMread({
    trn: fakeTrn,
    trnId,
    trnPath: `fake_trns/${trnId}`,
    now: new Date(readingAt),
    ast,
  });

  return cleanJson({
    ...mapped,
    fake: true,
    fakeReason: "Cycle 9 test seed for Cycle 10 MREAD staging processing",
    fakeSeed: {
      scriptName: SCRIPT_NAME,
      scriptVersion: SCRIPT_VERSION,
      seedType: "FAKE_MREAD_CYCLE_9_TEST_DATA",
      safeToDelete: true,
      source: "AST_EXPORT",
      astExportDocPath: item.docPath,
      sourceAstId: item.astId,
      includedManually: Boolean(includedManually),
      testArea: "Gf Maninjwa / Northcrest / KSD",
      targetGeofenceId: args.geofenceId,
      targetGeofenceName: args.geofenceName,
      cycleId: args.cycleId,
      cycleLabel: args.cycleLabel,
      billingPeriod: args.billingPeriod,
      readingDay: args.readingDay,
      generatedReading,
    },
    cycle: {
      cycleId: args.cycleId,
      cycleLabel: args.cycleLabel,
      cycleNo: parseInteger(args.cycleNo, DEFAULTS.cycleNo),
      billingPeriod: args.billingPeriod,
      window: {
        startDate: args.windowStartDate,
        endDate: args.windowEndDate,
        pattern: "MONTHLY_16_TO_15",
      },
    },
  });
}

function selectTargetAsts({ astItems, args }) {
  const includeAstIds = parseCsv(args.includeAstIds);
  const includeMeterNos = parseCsv(args.includeMeterNos);
  const selectedMap = new Map();
  const skipped = [];

  for (const item of astItems) {
    const ast = item.data;
    const selectedByGeofence = hasTargetGeofence(ast, args);
    const selectedExplicitly = isExplicitInclude(item, includeAstIds, includeMeterNos);

    if (!selectedByGeofence && !selectedExplicitly) continue;

    const meterKind = getMeterKind(ast);
    const meterType = getMeterType(ast);
    const meterNo = getMeterNo(ast);

    if (meterKind !== "conventional") {
      skipped.push({
        astId: item.astId,
        meterNo,
        reason: `Skipped non-conventional meter kind: ${meterKind}`,
      });
      continue;
    }

    if (!meterNo || meterNo === NAv) {
      skipped.push({
        astId: item.astId,
        meterNo,
        reason: "Skipped missing meter number",
      });
      continue;
    }

    selectedMap.set(item.docPath, {
      ...item,
      selectedByGeofence,
      selectedExplicitly,
      meterKind,
      meterType,
      meterNo,
    });
  }

  const selected = Array.from(selectedMap.values()).sort((a, b) => {
    const premiseA = getPremise(a.data);
    const premiseB = getPremise(b.data);
    return String(premiseA?.address || "").localeCompare(String(premiseB?.address || ""));
  });

  return { selected, skipped };
}

function buildRows({ selected, args, registryRows }) {
  const rng = seededRandom(args.seed);
  const { hour, minute } = parseHourMinute(args.startTime);
  const minGap = parseInteger(args.minGapMinutes, DEFAULTS.minGapMinutes);
  const maxGap = parseInteger(args.maxGapMinutes, DEFAULTS.maxGapMinutes);
  let minutesFromMidnight = hour * 60 + minute;

  return selected.map((item, index) => {
    if (index > 0) minutesFromMidnight += randomInt(rng, minGap, maxGap);

    const readingAt = toSastReadingAtIso({
      readingDay: args.readingDay,
      minutesFromMidnight,
    });
    const firstLaterRealReading = getFirstLaterRealReading({ item, registryRows, args });
    const generatedReading = generateFakeReading({
      row: item.data,
      rng,
      args,
      firstLaterRealReading,
    });
    const row = buildRegistryRow({
      item,
      args,
      readingAt,
      currentReading: generatedReading.currentReading,
      generatedReading,
      includedManually: item.selectedExplicitly && !item.selectedByGeofence,
    });

    return {
      docId: row.id,
      row,
      preview: {
        docId: row.id,
        meterNo: row?.meter?.astNo,
        astId: row?.meter?.astId,
        premiseId: row?.premise?.premiseId,
        premiseAddress: row?.premise?.address,
        geofenceName: row?.geography?.geofenceName,
        reading: row?.reading?.currentReading,
        method: generatedReading.generationMethod,
        laterReal: generatedReading.referenceLaterReading?.reading ?? NAv,
        laterRealAtSast: generatedReading.referenceLaterReading?.readingAt
          ? formatSastDisplay(generatedReading.referenceLaterReading.readingAt)
          : NAv,
        readingAtSast: formatSastDisplay(readingAt),
        fake: row.fake,
        manualInclude: row?.fakeSeed?.includedManually,
      },
    };
  });
}

async function writeRows({ rows, confirm, force }) {
  if (!confirm) return { created: 0, skippedExisting: 0, overwritten: 0 };

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  const db = admin.firestore();
  let created = 0;
  let skippedExisting = 0;
  let overwritten = 0;

  for (const item of rows) {
    const ref = db.collection(REGISTRY_MREAD_COLLECTION).doc(item.docId);
    const snap = await ref.get();

    if (snap.exists && !force) {
      skippedExisting += 1;
      continue;
    }

    await ref.set(item.row, { merge: false });

    if (snap.exists) overwritten += 1;
    else created += 1;
  }

  return { created, skippedExisting, overwritten };
}

function printSummary({ args, astItems, registryRows, selected, skipped, rows, mode }) {
  console.log("============================================================");
  console.log("iREPS — Seed Fake Cycle 9 registry_mread Rows");
  console.log("============================================================");
  console.log(`Mode: ${mode}`);
  console.log(`Input AST export: ${path.resolve(args.input)}`);
  console.log(`Registry export: ${args.registryExport ? path.resolve(args.registryExport) : NAv}`);
  console.log(`Collection: ${REGISTRY_MREAD_COLLECTION}`);
  console.log(`Cycle: ${args.cycleId} (${args.cycleLabel})`);
  console.log(`Cycle window: ${args.windowStartDate} to ${args.windowEndDate}`);
  console.log(`Fake reading day: ${args.readingDay}`);
  console.log(`Target geofence: ${args.geofenceName} (${args.geofenceId})`);
  console.log(`Total AST docs in export: ${astItems.length}`);
  console.log(`Registry rows loaded for later-real reference: ${registryRows.length}`);
  console.log(`Selected conventional target meters: ${selected.length}`);
  console.log(`Skipped candidates: ${skipped.length}`);
  console.log("------------------------------------------------------------");
  console.table(rows.map((item) => item.preview));

  if (skipped.length) {
    console.log("------------------------------------------------------------");
    console.log("Skipped:");
    console.table(skipped);
  }
}

async function main() {
  const rawArgs = parseArgs(process.argv);
  const args = {
    ...rawArgs,
    cycleNo: parseInteger(rawArgs.cycleNo, DEFAULTS.cycleNo),
    minGapMinutes: parseInteger(rawArgs.minGapMinutes, DEFAULTS.minGapMinutes),
    maxGapMinutes: parseInteger(rawArgs.maxGapMinutes, DEFAULTS.maxGapMinutes),
    minBackConsumption: parseInteger(rawArgs.minBackConsumption, DEFAULTS.minBackConsumption),
    maxBackConsumption: parseInteger(rawArgs.maxBackConsumption, DEFAULTS.maxBackConsumption),
    fallbackMinReading: parseInteger(rawArgs.fallbackMinReading, DEFAULTS.fallbackMinReading),
    fallbackMaxReading: parseInteger(rawArgs.fallbackMaxReading, DEFAULTS.fallbackMaxReading),
    laterRealMinDelta: parseInteger(rawArgs.laterRealMinDelta, DEFAULTS.laterRealMinDelta),
    laterRealMaxDelta: parseInteger(rawArgs.laterRealMaxDelta, DEFAULTS.laterRealMaxDelta),
  };
  const confirm = Boolean(args.confirm);
  const force = Boolean(args.force);
  const mode = confirm ? (force ? "CONFIRMED FORCE OVERWRITE" : "CONFIRMED CREATE-ONLY") : "DRY-RUN";

  const astItems = loadAstExport(args.input);
  const registryRows = loadRegistryExport(args.registryExport);
  const { selected, skipped } = selectTargetAsts({ astItems, args });
  const rows = buildRows({ selected, args, registryRows });

  printSummary({ args, astItems, registryRows, selected, skipped, rows, mode });

  if (!confirm) {
    console.log("------------------------------------------------------------");
    console.log("DRY-RUN only. Add --confirm to write fake registry_mread rows.");
    console.log("Every generated row will have root fake: true.");
    return;
  }

  const result = await writeRows({ rows, confirm, force });
  console.log("------------------------------------------------------------");
  console.log("Write summary:");
  console.log(JSON.stringify(result, null, 2));
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
