import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_COLLECTION = "registry_mread";
const DEFAULT_SERVICE_ACCOUNT_PATH = "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";
const DEFAULT_LM_PCODE = "ZA2157";
const DEFAULT_WARD_PCODE = "ZA2157008";
const DEFAULT_GEOFENCE_ID = "Mvtjb8Jlgd02CmfnGjTQ";
const DEFAULT_GEOFENCE_NAME = "Gf Maninjwa";
const DEFAULT_EXPECTED_BASELINE_COUNT = 22;
const DEFAULT_BILLING_PERIOD = "2025/26";
const DEFAULT_BASELINE_CYCLE_ID = "ZA2157_2025_2026_CYCLE_10";
const DEFAULT_BASELINE_CYCLE_LABEL = "Cycle 10 - 2025/26";
const DEFAULT_TARGET_CYCLE_ID = "ZA2157_2025_2026_CYCLE_11";
const DEFAULT_TARGET_CYCLE_LABEL = "Cycle 11 - 2025/26";
const DEFAULT_TARGET_READING_DATE = "2026-06-10";
const DEFAULT_TARGET_WINDOW_START = "2026-05-16";
const DEFAULT_TARGET_WINDOW_END = "2026-06-15";
const DEFAULT_LATER_START_DATE = "2026-06-16T00:00:00.000Z";
const DEFAULT_ROUTE_START_TIME = "08:00";
const DEFAULT_BATCH_LIMIT = 450;
const CONFIRM_TEXT = "SEED_FAKE_MREAD_CYCLE11";
const SCRIPT_NAME = "seed_fake_cycle11_registry_mread_from_cycle10.js";
const SCRIPT_VERSION = "1.0.0";
const FAKE_SEED_TYPE = "FAKE_MREAD_CYCLE11_MANINJWA_TEST_DATA";
const DEFAULT_REPORT_DIR = path.join(SCRIPT_DIR, "reports");
const NAv = "NAv";

function parseArgs(argv) {
  const args = {
    registryCollection: DEFAULT_REGISTRY_COLLECTION,
    serviceAccountPath: DEFAULT_SERVICE_ACCOUNT_PATH,
    registryExportPath: "",
    lmPcode: DEFAULT_LM_PCODE,
    wardPcode: DEFAULT_WARD_PCODE,
    geofenceId: DEFAULT_GEOFENCE_ID,
    geofenceName: DEFAULT_GEOFENCE_NAME,
    expectedBaselineCount: DEFAULT_EXPECTED_BASELINE_COUNT,
    billingPeriod: DEFAULT_BILLING_PERIOD,
    baselineCycleId: DEFAULT_BASELINE_CYCLE_ID,
    baselineCycleLabel: DEFAULT_BASELINE_CYCLE_LABEL,
    targetCycleId: DEFAULT_TARGET_CYCLE_ID,
    targetCycleLabel: DEFAULT_TARGET_CYCLE_LABEL,
    targetReadingDate: DEFAULT_TARGET_READING_DATE,
    targetWindowStart: DEFAULT_TARGET_WINDOW_START,
    targetWindowEnd: DEFAULT_TARGET_WINDOW_END,
    laterStartDate: DEFAULT_LATER_START_DATE,
    routeStartTime: DEFAULT_ROUTE_START_TIME,
    maxMeters: 0,
    execute: false,
    confirm: "",
    allowCountMismatch: false,
    allowUnanchored: false,
    allowFakeLaterAnchor: false,
    batchLimit: DEFAULT_BATCH_LIMIT,
    reportDir: DEFAULT_REPORT_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--service-account") {
      args.serviceAccountPath = argv[++i] || args.serviceAccountPath;
    } else if (arg === "--collection" || arg === "--registry-collection") {
      args.registryCollection = argv[++i] || args.registryCollection;
    } else if (arg === "--registry-export") {
      args.registryExportPath = argv[++i] || args.registryExportPath;
    } else if (arg === "--lm") {
      args.lmPcode = argv[++i] || args.lmPcode;
    } else if (arg === "--ward") {
      args.wardPcode = argv[++i] || args.wardPcode;
    } else if (arg === "--geofence-id") {
      args.geofenceId = argv[++i] || args.geofenceId;
    } else if (arg === "--geofence-name") {
      args.geofenceName = argv[++i] || args.geofenceName;
    } else if (arg === "--expected-baseline-count") {
      const parsed = Number(argv[++i]);
      args.expectedBaselineCount = Number.isFinite(parsed) && parsed >= 0
        ? Math.floor(parsed)
        : args.expectedBaselineCount;
    } else if (arg === "--allow-count-mismatch") {
      args.allowCountMismatch = true;
    } else if (arg === "--allow-unanchored") {
      args.allowUnanchored = true;
    } else if (arg === "--allow-fake-later-anchor") {
      args.allowFakeLaterAnchor = true;
    } else if (arg === "--target-date") {
      args.targetReadingDate = argv[++i] || args.targetReadingDate;
    } else if (arg === "--later-start-date") {
      args.laterStartDate = argv[++i] || args.laterStartDate;
    } else if (arg === "--route-start-time") {
      args.routeStartTime = argv[++i] || args.routeStartTime;
    } else if (arg === "--max-meters") {
      const parsed = Number(argv[++i]);
      args.maxMeters = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
    } else if (arg === "--batch-limit") {
      const parsed = Number(argv[++i]);
      args.batchLimit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : args.batchLimit;
    } else if (arg === "--confirm") {
      args.confirm = argv[++i] || "";
    } else if (arg === "--report-dir") {
      args.reportDir = argv[++i] || args.reportDir;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Seed fake MREAD Cycle 11 registry_mread rows from existing Cycle 10 baseline rows.

Default mode is DRY RUN. No Firestore writes are performed unless --execute and --confirm ${CONFIRM_TEXT} are both supplied.

Usage from functions folder:
  node ./scripts/seed_fake_cycle11_registry_mread_from_cycle10.js --lm ZA2157
  node ./scripts/seed_fake_cycle11_registry_mread_from_cycle10.js --registry-export "C:\\Users\\User\\OneDrive\\Desktop\\ireps2-registry_mread-20260619-2240.json"
  node ./scripts/seed_fake_cycle11_registry_mread_from_cycle10.js --lm ZA2157 --execute --confirm ${CONFIRM_TEXT}

What it does:
  1. Reads existing ${DEFAULT_BASELINE_CYCLE_LABEL} successful registry rows as the previous baseline.
  2. Reads later successful registry rows at or after ${DEFAULT_LATER_START_DATE} as the upper anchor.
  3. Creates one fake ${DEFAULT_TARGET_CYCLE_LABEL} row per meter when baseline < fake Cycle 11 < later anchor.
  4. Skips impossible rows by default, including missing later anchors or later readings below the baseline.
  5. Creates fake rows as create-only docs with fakeSeed.safeToDelete = true.

Options:
  --registry-export <path>       Optional local registry_mread export JSON for planning/dry-run.
  --service-account <path>       Defaults to ${DEFAULT_SERVICE_ACCOUNT_PATH}.
  --lm <lmPcode>                 LM guard. Defaults to ${DEFAULT_LM_PCODE}.
  --ward <wardPcode>             Ward guard. Defaults to ${DEFAULT_WARD_PCODE}.
  --geofence-id <id>             Defaults to ${DEFAULT_GEOFENCE_ID}.
  --geofence-name <name>         Defaults to ${DEFAULT_GEOFENCE_NAME}.
  --expected-baseline-count <n>  Defaults to ${DEFAULT_EXPECTED_BASELINE_COUNT}. Use 0 to disable.
  --allow-count-mismatch         Do not block if baseline count differs from expected count.
  --allow-unanchored             Create rows without a later upper anchor using previous + small delta.
  --allow-fake-later-anchor      Permit fake rows as later anchors. Defaults to real/non-fake only.
  --target-date <YYYY-MM-DD>     Defaults to ${DEFAULT_TARGET_READING_DATE}.
  --later-start-date <ISO>       Defaults to ${DEFAULT_LATER_START_DATE}.
  --route-start-time <HH:mm>     Defaults to ${DEFAULT_ROUTE_START_TIME} UTC.
  --max-meters <number>          Optional cap for controlled tests. Defaults to all eligible meters.
  --execute                      Actually create missing fake rows.
  --confirm <text>               Must equal ${CONFIRM_TEXT} when --execute is used.
  --help                         Show this help.
`);
}

function initAdmin(serviceAccountPath) {
  if (!admin.apps.length) {
    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
      process.env.GOOGLE_APPLICATION_CREDENTIALS =
        process.env.GOOGLE_APPLICATION_CREDENTIALS || serviceAccountPath;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
  }
  return admin.firestore();
}

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function getString(value, fallback = NAv) {
  return normalizeText(value, fallback);
}

function normalizeUpper(value, fallback = "") {
  return normalizeText(value, fallback).toUpperCase();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toDateOrNull(value) {
  if (!value || value === NAv) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value?.toMillis === "function") {
    const date = new Date(value.toMillis());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value?._seconds === "number") {
    const date = new Date(value._seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value?.__time__ === "string") {
    const date = new Date(value.__time__);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeDocId(value) {
  return normalizeText(value, "UNKNOWN")
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 900);
}

function stringHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeSeededRandom(seedText) {
  let state = stringHash(seedText) || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    state >>>= 0;
    return state / 4294967296;
  };
}

function randomInt(rng, min, max) {
  if (max <= min) return min;
  return Math.floor(rng() * (max - min + 1)) + min;
}

function parseRouteDateTime(dateText, timeText) {
  const [hourText = "08", minuteText = "00"] = String(timeText || DEFAULT_ROUTE_START_TIME).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const h = Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 8;
  const m = Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0;
  return new Date(`${dateText}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function daysBetween(startIso, endIso) {
  const start = toDateOrNull(startIso);
  const end = toDateOrNull(endIso);
  if (!start || !end) return null;
  const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  return Math.round(days * 100) / 100;
}

function makeSincePreviousReading(startIso, endIso) {
  const start = toDateOrNull(startIso);
  const end = toDateOrNull(endIso);
  if (!start || !end) return null;
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / (60 * 1000)));
  if (totalMinutes >= 1440) {
    const value = Math.floor(totalMinutes / 1440);
    return { display: `${value} day${value === 1 ? "" : "s"}`, totalMinutes, unit: "DAYS", value };
  }
  if (totalMinutes >= 60) {
    const value = Math.floor(totalMinutes / 60);
    return { display: `${value} hr${value === 1 ? "" : "s"}`, totalMinutes, unit: "HOURS", value };
  }
  return { display: `${totalMinutes} min`, totalMinutes, unit: "MINUTES", value: totalMinutes };
}

function readReadingAt(row = {}) {
  return row?.reading?.readingAt ||
    row?.reading?.currentReadingDate ||
    row?.source?.completedAt ||
    row?.completedAt ||
    row?.metadata?.updatedAt ||
    null;
}

function readCurrentReading(row = {}) {
  return toNumberOrNull(row?.reading?.currentReading ?? row?.currentReading ?? row?.reading);
}

function readOutcome(row = {}) {
  return normalizeUpper(row?.outcome?.outcome || row?.outcome, NAv);
}

function readCycleId(row = {}) {
  return getString(row?.cycle?.cycleId, "");
}

function meterKey(row = {}) {
  return [
    row?.meter?.astId,
    row?.astId,
    row?.sourceAstId,
    row?.meter?.meterId,
    row?.meterId,
    row?.meter?.astNo,
    row?.meter?.meterNo,
    row?.meterNo,
    row?.astNo,
  ]
    .map((value) => normalizeText(value, "").toUpperCase())
    .find(Boolean) || "";
}

function meterNoKey(row = {}) {
  return normalizeText(
    row?.meter?.astNo ||
      row?.meter?.meterNo ||
      row?.meterNo ||
      row?.astNo,
    "",
  ).toUpperCase();
}

function readRowsFromExport(registryExportPath) {
  const resolved = path.resolve(registryExportPath);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Object.entries(parsed || {}).map(([key, value]) => ({
    docId: key.replace(/^registry_mread\//, ""),
    data: value || {},
  }));
}

async function loadRegistryRows(db, args) {
  if (args.registryExportPath) {
    return {
      source: `REGISTRY_EXPORT:${path.resolve(args.registryExportPath)}`,
      rows: readRowsFromExport(args.registryExportPath),
    };
  }

  const snap = await db
    .collection(args.registryCollection)
    .where("geography.lmPcode", "==", args.lmPcode)
    .get();

  return {
    source: `FIRESTORE:${args.registryCollection}`,
    rows: snap.docs.map((doc) => ({ docId: doc.id, data: doc.data() || {} })),
  };
}

function rowMatchesScope(row = {}, args = {}) {
  if (getString(row?.geography?.lmPcode, "") !== args.lmPcode) return false;
  if (args.wardPcode && getString(row?.geography?.wardPcode, "") !== args.wardPcode) return false;
  if (args.geofenceId && getString(row?.geography?.geofenceId, "") !== args.geofenceId) return false;
  return true;
}

function rowMatchesLaterAnchorScope(row = {}, args = {}) {
  if (getString(row?.geography?.lmPcode, "") !== args.lmPcode) return false;
  if (args.wardPcode && getString(row?.geography?.wardPcode, "") !== args.wardPcode) return false;

  const geofenceId = getString(row?.geography?.geofenceId, "");
  if (args.geofenceId && geofenceId && geofenceId !== NAv && geofenceId !== args.geofenceId) {
    return false;
  }

  return true;
}

function isSuccessfulWithReading(row = {}) {
  return readOutcome(row) === "SUCCESSFUL_READING" && readCurrentReading(row) !== null;
}

function summarizeRow(row = {}, docId = "") {
  return {
    docId: docId || row?.id || NAv,
    cycleId: getString(row?.cycle?.cycleId),
    readingAt: getString(row?.reading?.readingAt),
    currentReading: readCurrentReading(row),
    meterNo: getString(row?.meter?.astNo || row?.meter?.meterNo),
    astId: getString(row?.meter?.astId),
    premiseId: getString(row?.premise?.premiseId),
    fake: row?.fake === true,
  };
}

function chooseBaselineRows(rows = [], args = {}) {
  const candidates = rows
    .filter(({ data }) => rowMatchesScope(data, args))
    .filter(({ data }) => readCycleId(data) === args.baselineCycleId)
    .filter(({ data }) => isSuccessfulWithReading(data))
    .sort((left, right) => {
      const leftNo = meterNoKey(left.data);
      const rightNo = meterNoKey(right.data);
      return leftNo.localeCompare(rightNo, undefined, { numeric: true });
    });

  const seen = new Set();
  const unique = [];
  const duplicates = [];

  for (const item of candidates) {
    const key = meterKey(item.data);
    if (seen.has(key)) {
      duplicates.push({ ...summarizeRow(item.data, item.docId), reason: "DUPLICATE_BASELINE_METER_KEY" });
      continue;
    }
    seen.add(key);
    unique.push(item);
  }

  return { baselineRows: unique, duplicateBaselineRows: duplicates };
}

function chooseLaterRows(rows = [], args = {}) {
  const laterStart = toDateOrNull(args.laterStartDate);
  return rows
    .filter(({ data }) => rowMatchesLaterAnchorScope(data, args))
    .filter(({ data }) => isSuccessfulWithReading(data))
    .filter(({ data }) => args.allowFakeLaterAnchor || data?.fake !== true)
    .map((item) => ({
      ...item,
      readingAtDate: toDateOrNull(readReadingAt(item.data)),
    }))
    .filter((item) => item.readingAtDate && item.readingAtDate.getTime() >= laterStart.getTime())
    .sort((left, right) => left.readingAtDate.getTime() - right.readingAtDate.getTime());
}

function findLaterAnchor(baseline = {}, laterRows = []) {
  const key = meterKey(baseline);
  const noKey = meterNoKey(baseline);
  const matches = laterRows.filter(({ data }) =>
    meterKey(data) === key || (noKey && meterNoKey(data) === noKey),
  );
  return matches[0] || null;
}

function calculateCycle11Reading({ baseline, laterAnchor, args, index }) {
  const previousReading = readCurrentReading(baseline);
  const laterReading = laterAnchor ? readCurrentReading(laterAnchor.data) : null;
  const rng = makeSeededRandom(`${baseline?.id || meterKey(baseline)}:${previousReading}:${index}:cycle11`);

  if (previousReading === null || previousReading < 0) {
    return { valid: false, reason: "BASELINE_READING_MISSING_OR_INVALID" };
  }

  if (laterAnchor && laterReading !== null) {
    if (laterReading <= previousReading) {
      return {
        valid: false,
        reason: "LATER_READING_NOT_ABOVE_BASELINE",
        laterReading,
      };
    }

    const gap = laterReading - previousReading;
    const sharePercent = randomInt(rng, 35, 70) / 100;
    const consumption = Math.max(1, Math.floor(gap * sharePercent));
    return {
      valid: true,
      scenario: "NORMAL_CONTINUATION_WITH_LATER_REGISTRY_ANCHOR",
      currentReading: Math.min(laterReading - 1, previousReading + consumption),
      previousReading,
      laterReading,
      generationMethod: "CYCLE10_BASELINE_PLUS_PARTIAL_GAP_TO_LATER_REGISTRY_READING",
    };
  }

  if (!args.allowUnanchored) {
    return { valid: false, reason: "NO_LATER_REGISTRY_ANCHOR_FOUND" };
  }

  const consumption = randomInt(rng, 15, 180);
  return {
    valid: true,
    scenario: "UNANCHORED_TEST_CONTINUATION",
    currentReading: previousReading + consumption,
    previousReading,
    laterReading: null,
    generationMethod: "CYCLE10_BASELINE_PLUS_RANDOM_TEST_DELTA_NO_LATER_ANCHOR",
  };
}

function makeCycle(args) {
  return {
    billingPeriod: args.billingPeriod,
    cycleId: args.targetCycleId,
    cycleLabel: args.targetCycleLabel,
    cycleNo: 11,
    window: {
      startDate: args.targetWindowStart,
      endDate: args.targetWindowEnd,
      pattern: "MONTHLY_16_TO_15",
    },
  };
}

function mediaRefsFromRows(...rows) {
  for (const row of rows) {
    const refs = row?.evidence?.mediaRefs;
    if (Array.isArray(refs) && refs.length > 0) {
      return refs.map((item) => ({
        ...item,
        createdAt: item?.createdAt || item?.created?.at || null,
        updatedAt: item?.updatedAt || item?.updated?.at || null,
      }));
    }
  }
  return null;
}

function buildFakeCycle11Row({
  baseline,
  baselineDocId,
  laterAnchor,
  args,
  docId,
  readingAt,
  calculated,
}) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const readingAtIso = readingAt.toISOString();
  const previousReadingAt = getString(baseline?.reading?.readingAt, null);
  const previousReadingSourceId = baselineDocId || baseline?.id || NAv;
  const consumption = calculated.currentReading - calculated.previousReading;
  const sincePreviousReading = previousReadingAt
    ? makeSincePreviousReading(previousReadingAt, readingAtIso)
    : null;
  const daysSinceLastReading = previousReadingAt
    ? daysBetween(previousReadingAt, readingAtIso)
    : null;
  const laterRow = laterAnchor?.data || null;
  const mediaRefs = mediaRefsFromRows(laterRow, baseline);
  const unanchored = calculated.scenario === "UNANCHORED_TEST_CONTINUATION";

  return {
    id: docId,
    fake: true,
    fakeReason: `Controlled ${args.targetCycleLabel} test seed for Gf Maninjwa MREAD staging`,
    actor: {
      capturedByName: SCRIPT_NAME,
      capturedByRole: "SYSTEM_SCRIPT",
      capturedByUid: "SYSTEM_SCRIPT",
      spId: getString(baseline?.actor?.spId),
      spName: getString(baseline?.actor?.spName),
      teamId: NAv,
      teamName: NAv,
    },
    assignment: {
      acceptedAt: null,
      assignedToId: NAv,
      assignedToName: NAv,
      assignedToType: NAv,
      issuedByName: SCRIPT_NAME,
      issuedByUid: "SYSTEM_SCRIPT",
    },
    billingReadiness: unanchored
      ? {
          reasonCode: "MREAD_FAKE_CYCLE11_UNANCHORED",
          reasonText: "Fake Cycle 11 row has no later registry anchor and is for staging tests only.",
          status: "BILLING_REVIEW_REQUIRED",
        }
      : { reasonCode: NAv, reasonText: NAv, status: "BILLING_READY_CANDIDATE" },
    cycle: makeCycle(args),
    dataQuality: {
      hasRequiredSourceRefs: true,
      missingFields: null,
      requiresDataFix: false,
      warnings: unanchored ? ["fake_cycle11_unanchored_no_later_registry_reading"] : null,
    },
    evidence: {
      gps: laterRow?.evidence?.gps || baseline?.evidence?.gps || null,
      hasMeterReadingEvidence: Array.isArray(mediaRefs) && mediaRefs.length > 0,
      hasNoAccessPhoto: false,
      hasPhoto: Array.isArray(mediaRefs) && mediaRefs.length > 0,
      hasUnsuccessfulReadingEvidence: false,
      mediaRefs,
      mediaTags: Array.isArray(mediaRefs) ? mediaRefs.map((item) => item.tag).filter(Boolean) : null,
      notes: `Fake ${args.targetCycleLabel} MREAD seed row generated for Gf Maninjwa staging test.`,
      photoCount: Array.isArray(mediaRefs) ? mediaRefs.length : 0,
    },
    fakeSeed: {
      billingPeriod: args.billingPeriod,
      cycleId: args.targetCycleId,
      cycleLabel: args.targetCycleLabel,
      scenario: calculated.scenario,
      generatedReading: {
        currentReading: calculated.currentReading,
        previousReading: calculated.previousReading,
        previousReadingAt,
        previousReadingSourceId,
        consumption,
        daysSinceLastReading,
        generationMethod: calculated.generationMethod,
        referenceBaselineReading: {
          registryMreadId: baselineDocId,
          meterNo: getString(baseline?.meter?.astNo || baseline?.meter?.meterNo),
          premiseId: getString(baseline?.premise?.premiseId),
          reading: calculated.previousReading,
          readingAt: previousReadingAt,
          cycleId: getString(baseline?.cycle?.cycleId),
        },
        referenceLaterReading: laterRow
          ? {
              registryMreadId: laterAnchor.docId,
              trnId: getString(laterRow?.source?.trnId),
              source: getString(laterRow?.source?.sourceSystem),
              meterNo: getString(laterRow?.meter?.astNo || laterRow?.meter?.meterNo),
              premiseId: getString(laterRow?.premise?.premiseId),
              reading: readCurrentReading(laterRow),
              readingAt: getString(laterRow?.reading?.readingAt),
            }
          : null,
      },
      readingDay: args.targetReadingDate,
      safeToDelete: true,
      scriptName: SCRIPT_NAME,
      scriptVersion: SCRIPT_VERSION,
      seedType: FAKE_SEED_TYPE,
      source: laterRow ? "REGISTRY_MREAD_CYCLE10_BASELINE_AND_LATER_REAL_ANCHOR" : "REGISTRY_MREAD_CYCLE10_BASELINE_ONLY",
      sourceBaselineRegistryMreadId: baselineDocId,
      sourceLaterRegistryMreadId: laterAnchor?.docId || NAv,
      sourceAstId: getString(baseline?.meter?.astId),
      targetGeofenceId: args.geofenceId,
      targetGeofenceName: args.geofenceName,
      testArea: `${args.geofenceName} / Ward 8 / KSD`,
    },
    geography: {
      ...(baseline?.geography || {}),
      geofenceId: args.geofenceId,
      geofenceName: args.geofenceName,
      lmPcode: args.lmPcode,
      wardPcode: args.wardPcode,
    },
    metadata: {
      createdAt: now,
      createdByUid: SCRIPT_NAME,
      createdByUser: "MREAD fake seed script",
      updatedAt: now,
      updatedByUid: SCRIPT_NAME,
      updatedByUser: "MREAD fake seed script",
    },
    meter: {
      ...(baseline?.meter || {}),
    },
    outcome: {
      access: "YES",
      noAccessReason: NAv,
      outcome: "SUCCESSFUL_READING",
      readingObtained: "YES",
      reasonCode: NAv,
      reasonText: NAv,
      unsuccessfulReason: NAv,
      validationMessages: null,
      validationStatus: "PASSED",
    },
    premise: {
      ...(baseline?.premise || {}),
    },
    reading: {
      consumption,
      currentReading: calculated.currentReading,
      daysSinceLastReading,
      previousReading: calculated.previousReading,
      previousReadingAt,
      previousReadingTrnId: previousReadingSourceId,
      previousReadingSourceId,
      readingAt: readingAtIso,
      sincePreviousReading,
    },
    review: {
      actionRequired: unanchored,
      actionType: unanchored ? "UNANCHORED_FAKE_TEST_ROW_REVIEW" : NAv,
      reviewNotes: unanchored ? "Fake Cycle 11 row has no later registry anchor." : NAv,
      reviewedAt: null,
      reviewedByName: NAv,
      reviewedByUid: NAv,
      status: unanchored ? "REVIEW_REQUIRED" : NAv,
    },
    source: {
      completedAt: readingAtIso,
      sourceSystem: "iREPS_TEST_SEED",
      sourceVersion: "v1",
      trnId: docId,
      trnPath: `fake_trns/${docId}`,
      trnType: "MREAD",
      workflowState: "COMPLETED",
    },
    stream: {
      batchId: NAv,
      bgoId: NAv,
      bgoRowId: NAv,
      streamType: "UNCONTROLLED",
    },
  };
}

function makeDocId(baseline = {}) {
  return `FAKE_MREAD_CYCLE11_${safeDocId(baseline?.meter?.astNo || baseline?.meter?.meterNo)}_${safeDocId(baseline?.premise?.premiseId)}_${safeDocId(baseline?.wardPcode || baseline?.geography?.wardPcode)}_${safeDocId(baseline?.premise?.erfNo || baseline?.premise?.erfId)}`.slice(0, 900);
}

async function loadExistingTargetDocs(db, registryCollection, plannedRows) {
  if (!plannedRows.length) return new Set();
  const checks = plannedRows.map((row) =>
    db.collection(registryCollection).doc(row.docId).get(),
  );
  const snaps = await Promise.all(checks);
  const existing = new Set();
  snaps.forEach((snap, index) => {
    if (snap.exists) existing.add(plannedRows[index].docId);
  });
  return existing;
}

function loadExistingTargetDocsFromRows(rows = [], plannedRows = []) {
  const existingIds = new Set(rows.map((row) => row.docId));
  return new Set(plannedRows.filter((row) => existingIds.has(row.docId)).map((row) => row.docId));
}

async function commitCreates(db, args, rowsToCreate) {
  let createdCount = 0;
  for (let start = 0; start < rowsToCreate.length; start += args.batchLimit) {
    const chunk = rowsToCreate.slice(start, start + args.batchLimit);
    const batch = db.batch();
    for (const item of chunk) {
      batch.create(db.collection(args.registryCollection).doc(item.docId), item.data);
    }
    await batch.commit();
    createdCount += chunk.length;
    console.log(`Created ${createdCount}/${rowsToCreate.length} fake Cycle 11 registry rows...`);
  }
  return createdCount;
}

function writeReport(reportDir, report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").replace("Z", "Z");
  const filename = `seed_fake_cycle11_registry_mread_report_${stamp}.json`;
  const reportPath = path.join(reportDir, filename);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.execute && args.confirm !== CONFIRM_TEXT) {
    throw new Error(`Execution blocked. To create rows, pass: --execute --confirm ${CONFIRM_TEXT}`);
  }

  const db = args.execute || !args.registryExportPath
    ? initAdmin(args.serviceAccountPath)
    : null;
  const startedAt = new Date().toISOString();

  console.log("============================================================");
  console.log("Seed Fake MREAD Cycle 11 Registry Rows");
  console.log("============================================================");
  console.log(`Mode: ${args.execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`Registry collection: ${args.registryCollection}`);
  console.log(`Registry source: ${args.registryExportPath || "Firestore query"}`);
  console.log(`Service account: ${args.serviceAccountPath || "application default"}`);
  console.log(`LM guard: ${args.lmPcode}`);
  console.log(`Ward guard: ${args.wardPcode}`);
  console.log(`Geofence guard: ${args.geofenceName} (${args.geofenceId})`);
  console.log(`Baseline cycle: ${args.baselineCycleId}`);
  console.log(`Target cycle: ${args.targetCycleId}`);
  console.log(`Target reading date: ${args.targetReadingDate}`);
  console.log(`Later registry anchor starts at: ${args.laterStartDate}`);
  console.log("Create mode: create-only; existing target docs are skipped");
  console.log("============================================================");

  const { source, rows } = await loadRegistryRows(db, args);
  const { baselineRows, duplicateBaselineRows } = chooseBaselineRows(rows, args);
  const laterRows = chooseLaterRows(rows, args);

  if (
    args.expectedBaselineCount > 0 &&
    !args.allowCountMismatch &&
    baselineRows.length !== args.expectedBaselineCount
  ) {
    throw new Error(
      `Baseline count mismatch. Expected ${args.expectedBaselineCount}, found ${baselineRows.length}. Pass --allow-count-mismatch intentionally if this is expected.`,
    );
  }

  const selectedBaselineRows = args.maxMeters > 0
    ? baselineRows.slice(0, args.maxMeters)
    : baselineRows;
  let routeCursor = parseRouteDateTime(args.targetReadingDate, args.routeStartTime);
  const plannedRows = [];
  const plannedChains = [];
  const skippedRows = [];

  selectedBaselineRows.forEach((item, index) => {
    const baseline = item.data;
    const rng = makeSeededRandom(`cycle11-route:${item.docId}:${index}`);
    if (index > 0) routeCursor = addMinutes(routeCursor, randomInt(rng, 5, 20));

    const laterAnchor = findLaterAnchor(baseline, laterRows);
    const calculated = calculateCycle11Reading({
      baseline,
      laterAnchor,
      args,
      index,
    });

    if (!calculated.valid) {
      skippedRows.push({
        ...summarizeRow(baseline, item.docId),
        reason: calculated.reason,
        laterAnchor: laterAnchor ? summarizeRow(laterAnchor.data, laterAnchor.docId) : null,
        laterReading: calculated.laterReading ?? null,
      });
      return;
    }

    const docId = makeDocId(baseline);
    const data = buildFakeCycle11Row({
      baseline,
      baselineDocId: item.docId,
      laterAnchor,
      args,
      docId,
      readingAt: routeCursor,
      calculated,
    });

    plannedRows.push({ docId, cycleId: args.targetCycleId, data });
    plannedChains.push({
      scenario: calculated.scenario,
      meterNo: getString(baseline?.meter?.astNo || baseline?.meter?.meterNo),
      astId: getString(baseline?.meter?.astId),
      premiseId: getString(baseline?.premise?.premiseId),
      cycle10: {
        docId: item.docId,
        readingAt: getString(baseline?.reading?.readingAt),
        currentReading: calculated.previousReading,
      },
      cycle11: {
        docId,
        readingAt: routeCursor.toISOString(),
        previousReading: calculated.previousReading,
        currentReading: calculated.currentReading,
        consumption: calculated.currentReading - calculated.previousReading,
      },
      laterReal: laterAnchor
        ? {
            docId: laterAnchor.docId,
            readingAt: getString(laterAnchor.data?.reading?.readingAt),
            currentReading: readCurrentReading(laterAnchor.data),
          }
        : null,
      consistency: {
        cycle10LessThanCycle11: calculated.previousReading < calculated.currentReading,
        cycle11LessThanLaterReal: laterAnchor
          ? calculated.currentReading < readCurrentReading(laterAnchor.data)
          : "N/A_UNANCHORED",
      },
    });
  });

  const existingTargetDocs = args.registryExportPath && !args.execute
    ? loadExistingTargetDocsFromRows(rows, plannedRows)
    : await loadExistingTargetDocs(db, args.registryCollection, plannedRows);
  const rowsToCreate = plannedRows.filter((row) => !existingTargetDocs.has(row.docId));
  const existingRows = plannedRows.filter((row) => existingTargetDocs.has(row.docId));

  console.log(`Registry source: ${source}`);
  console.log(`Scanned registry rows: ${rows.length}`);
  console.log(`Baseline rows selected: ${baselineRows.length}`);
  console.log(`Duplicate baseline rows skipped: ${duplicateBaselineRows.length}`);
  console.log(`Later anchor rows available: ${laterRows.length}`);
  console.log(`Selected baseline rows after cap: ${selectedBaselineRows.length}`);
  console.log(`Planned fake Cycle 11 rows: ${plannedRows.length}`);
  console.log(`Skipped baseline rows: ${skippedRows.length}`);
  console.log(`Existing target rows skipped: ${existingRows.length}`);
  console.log(`Rows to create: ${rowsToCreate.length}`);

  if (plannedChains.length > 0) {
    console.log("Sample planned Cycle 10 -> Cycle 11 -> later chains:");
    console.log(JSON.stringify(plannedChains.slice(0, 5), null, 2));
  }

  if (skippedRows.length > 0) {
    console.log("Skipped sample:");
    console.log(JSON.stringify(skippedRows.slice(0, 5), null, 2));
  }

  let createdCount = 0;
  if (args.execute && rowsToCreate.length > 0) {
    createdCount = await commitCreates(db, args, rowsToCreate);
  }

  const completedAt = new Date().toISOString();
  const report = {
    scriptName: SCRIPT_NAME,
    scriptVersion: SCRIPT_VERSION,
    startedAt,
    completedAt,
    mode: args.execute ? "EXECUTE" : "DRY_RUN",
    registrySource: source,
    registryCollection: args.registryCollection,
    registryExportPath: args.registryExportPath || null,
    serviceAccountPath: args.serviceAccountPath || null,
    scope: {
      lmPcode: args.lmPcode,
      wardPcode: args.wardPcode,
      geofenceId: args.geofenceId,
      geofenceName: args.geofenceName,
      expectedBaselineCount: args.expectedBaselineCount,
      allowCountMismatch: args.allowCountMismatch,
      allowUnanchored: args.allowUnanchored,
      allowFakeLaterAnchor: args.allowFakeLaterAnchor,
    },
    cycles: {
      baseline: {
        cycleId: args.baselineCycleId,
        cycleLabel: args.baselineCycleLabel,
      },
      target: {
        cycleId: args.targetCycleId,
        cycleLabel: args.targetCycleLabel,
        readingDate: args.targetReadingDate,
        windowStart: args.targetWindowStart,
        windowEnd: args.targetWindowEnd,
      },
      laterAnchorStartDate: args.laterStartDate,
    },
    counts: {
      scannedRegistryRows: rows.length,
      baselineRowsSelected: baselineRows.length,
      duplicateBaselineRowsSkipped: duplicateBaselineRows.length,
      laterAnchorRowsAvailable: laterRows.length,
      selectedBaselineRowsAfterCap: selectedBaselineRows.length,
      plannedFakeCycle11Rows: plannedRows.length,
      skippedBaselineRows: skippedRows.length,
      existingTargetRowsSkipped: existingRows.length,
      rowsToCreate: rowsToCreate.length,
      createdRows: createdCount,
    },
    plannedChains,
    skippedRows,
    duplicateBaselineRows,
    existingRows: existingRows.map((row) => ({ docId: row.docId, cycleId: row.cycleId })),
  };

  const reportPath = writeReport(args.reportDir, report);
  console.log("============================================================");
  console.log(`Report written: ${reportPath}`);
  console.log(`Result: ${args.execute ? `CREATED ${createdCount}` : "DRY RUN ONLY"}`);
  console.log("============================================================");
}

main().catch((error) => {
  console.error("ERROR:", error);
  process.exitCode = 1;
});
