import fs from "fs";
import path from "path";
import admin from "firebase-admin";

const DEFAULT_REGISTRY_COLLECTION = "registry_mread";
const DEFAULT_ASTS_COLLECTION = "asts";
const DEFAULT_LM_PCODE = "ZA2157";
const DEFAULT_WARD_PCODE = "ZA2157008";
const DEFAULT_GEOFENCE_ID = "Mvtjb8Jlgd02CmfnGjTQ";
const DEFAULT_GEOFENCE_NAME = "Gf Maninjwa";
const DEFAULT_EXPECTED_COUNT = 22;
const DEFAULT_CYCLE_9_ID = "ZA2157_2025_2026_CYCLE_09";
const DEFAULT_CYCLE_10_ID = "ZA2157_2025_2026_CYCLE_10";
const DEFAULT_CYCLE_9_LABEL = "Cycle 9 - 2025/26";
const DEFAULT_CYCLE_10_LABEL = "Cycle 10 - 2025/26";
const DEFAULT_BILLING_PERIOD = "2025/26";
const DEFAULT_CYCLE_9_READING_DATE = "2026-04-10";
const DEFAULT_CYCLE_10_READING_DATE = "2026-05-10";
const DEFAULT_CYCLE_9_WINDOW_START = "2026-03-16";
const DEFAULT_CYCLE_9_WINDOW_END = "2026-04-15";
const DEFAULT_CYCLE_10_WINDOW_START = "2026-04-16";
const DEFAULT_CYCLE_10_WINDOW_END = "2026-05-15";
const DEFAULT_LATER_START_DATE = "2026-05-16T00:00:00.000Z";
const DEFAULT_ROUTE_START_TIME = "08:00";
const DEFAULT_BATCH_LIMIT = 450;
const CONFIRM_TEXT = "SEED_FAKE_MREAD_CYCLE9_CYCLE10";
const SCRIPT_NAME = "seed_fake_cycle9_cycle10_registry_mread_from_real_later_readings.js";
const SCRIPT_VERSION = "1.2.0";
const FAKE_SEED_TYPE = "FAKE_MREAD_CYCLE9_CYCLE10_MANINJWA_TEST_DATA";
const NAv = "NAv";

function parseArgs(argv) {
  const args = {
    registryCollection: DEFAULT_REGISTRY_COLLECTION,
    astsCollection: DEFAULT_ASTS_COLLECTION,
    astExportPath: "",
    lmPcode: DEFAULT_LM_PCODE,
    wardPcode: DEFAULT_WARD_PCODE,
    geofenceId: DEFAULT_GEOFENCE_ID,
    geofenceName: DEFAULT_GEOFENCE_NAME,
    expectedCount: DEFAULT_EXPECTED_COUNT,
    billingPeriod: DEFAULT_BILLING_PERIOD,
    cycle9Id: DEFAULT_CYCLE_9_ID,
    cycle10Id: DEFAULT_CYCLE_10_ID,
    cycle9Label: DEFAULT_CYCLE_9_LABEL,
    cycle10Label: DEFAULT_CYCLE_10_LABEL,
    cycle9ReadingDate: DEFAULT_CYCLE_9_READING_DATE,
    cycle10ReadingDate: DEFAULT_CYCLE_10_READING_DATE,
    cycle9WindowStart: DEFAULT_CYCLE_9_WINDOW_START,
    cycle9WindowEnd: DEFAULT_CYCLE_9_WINDOW_END,
    cycle10WindowStart: DEFAULT_CYCLE_10_WINDOW_START,
    cycle10WindowEnd: DEFAULT_CYCLE_10_WINDOW_END,
    laterStartDate: DEFAULT_LATER_START_DATE,
    routeStartTime: DEFAULT_ROUTE_START_TIME,
    maxMeters: 0,
    execute: false,
    confirm: "",
    allowCountMismatch: false,
    batchLimit: DEFAULT_BATCH_LIMIT,
    reportDir: path.join(process.cwd(), "scripts", "reports"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--collection" || arg === "--registry-collection") {
      args.registryCollection = argv[++i] || args.registryCollection;
    } else if (arg === "--asts-collection") {
      args.astsCollection = argv[++i] || args.astsCollection;
    } else if (arg === "--ast-export") {
      args.astExportPath = argv[++i] || args.astExportPath;
    } else if (arg === "--lm") {
      args.lmPcode = argv[++i] || args.lmPcode;
    } else if (arg === "--ward") {
      args.wardPcode = argv[++i] || args.wardPcode;
    } else if (arg === "--geofence-id") {
      args.geofenceId = argv[++i] || args.geofenceId;
    } else if (arg === "--geofence-name") {
      args.geofenceName = argv[++i] || args.geofenceName;
    } else if (arg === "--expected-count") {
      const parsed = Number(argv[++i]);
      args.expectedCount = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : args.expectedCount;
    } else if (arg === "--allow-count-mismatch") {
      args.allowCountMismatch = true;
    } else if (arg === "--cycle9-date") {
      args.cycle9ReadingDate = argv[++i] || args.cycle9ReadingDate;
    } else if (arg === "--cycle10-date") {
      args.cycle10ReadingDate = argv[++i] || args.cycle10ReadingDate;
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
Seed clean fake MREAD Cycle 9 and Cycle 10 registry rows for the locked Gf Maninjwa test scope.

Default mode is DRY RUN. No Firestore writes are performed unless --execute and --confirm ${CONFIRM_TEXT} are both supplied.

Usage from functions folder:
  node ./scripts/seed_fake_cycle9_cycle10_registry_mread_from_real_later_readings.js --lm ZA2157
  node ./scripts/seed_fake_cycle9_cycle10_registry_mread_from_real_later_readings.js --lm ZA2157 --execute --confirm ${CONFIRM_TEXT}

Locked default scope:
  LM:          ${DEFAULT_LM_PCODE}
  Ward:        ${DEFAULT_WARD_PCODE}
  Geofence:    ${DEFAULT_GEOFENCE_NAME} (${DEFAULT_GEOFENCE_ID})
  Expected:    ${DEFAULT_EXPECTED_COUNT} ASTs / premises / meters

What it does:
  1. Reads the Gf Maninjwa AST scope, not all ZA2157 registry rows.
  2. Requires the scope count to match the expected count unless --allow-count-mismatch is passed.
  3. Uses the first later AST mreading at or after ${DEFAULT_LATER_START_DATE} as the real upper anchor.
  4. Generates fake Cycle 10 below that later real anchor.
  5. Generates fake Cycle 9 below fake Cycle 10.
  6. Sets Cycle 10 previousReading equal to Cycle 9 currentReading.
  7. Calculates Cycle 10 daysSinceLastReading and consumption.
  8. For new zero-baseline installed meters, writes Cycle 9/10 fake history against a fake old removed meter.
  9. Creates fake rows as create-only docs with fakeSeed.safeToDelete = true.

Options:
  --lm <lmPcode>              LM guard. Defaults to ${DEFAULT_LM_PCODE}.
  --ward <wardPcode>          Ward guard. Defaults to ${DEFAULT_WARD_PCODE}.
  --geofence-id <id>          Defaults to ${DEFAULT_GEOFENCE_ID}.
  --geofence-name <name>      Defaults to ${DEFAULT_GEOFENCE_NAME}.
  --expected-count <number>   Defaults to ${DEFAULT_EXPECTED_COUNT}. Use 0 to disable.
  --allow-count-mismatch      Do not block if scope count differs from expected-count.
  --ast-export <path>         Optional local AST export JSON instead of Firestore asts query.
  --cycle9-date <YYYY-MM-DD>  Defaults to ${DEFAULT_CYCLE_9_READING_DATE}.
  --cycle10-date <YYYY-MM-DD> Defaults to ${DEFAULT_CYCLE_10_READING_DATE}.
  --later-start-date <ISO>    Defaults to ${DEFAULT_LATER_START_DATE}.
  --route-start-time <HH:mm>  Defaults to ${DEFAULT_ROUTE_START_TIME} UTC.
  --max-meters <number>       Optional cap for controlled tests. Defaults to all scoped meters.
  --registry-collection <n>   Defaults to ${DEFAULT_REGISTRY_COLLECTION}.
  --asts-collection <n>       Defaults to ${DEFAULT_ASTS_COLLECTION}.
  --execute                   Actually create missing fake rows.
  --confirm <text>            Must equal ${CONFIRM_TEXT} when --execute is used.
  --help                      Show this help.
`);
}

function initAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp();
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

function makeCycle({ cycleId, cycleNo, cycleLabel, billingPeriod, windowStart, windowEnd }) {
  return {
    billingPeriod,
    cycleId,
    cycleLabel,
    cycleNo,
    window: {
      startDate: windowStart,
      endDate: windowEnd,
      pattern: "MONTHLY_16_TO_15",
    },
  };
}

function hasGeofence(astData = {}, args) {
  const refs = Array.isArray(astData?.geofenceRefs) ? astData.geofenceRefs : [];
  return refs.some((ref) => {
    const refId = normalizeText(ref?.id, "");
    const refName = normalizeText(ref?.name, "");
    return (args.geofenceId && refId === args.geofenceId) || (args.geofenceName && refName === args.geofenceName);
  });
}

function getAstId(astData = {}, docId = "") {
  return getString(astData?.ast?.astData?.astId || astData?.trnId || astData?.id || docId.replace(/^asts\//, ""));
}

function getAstMeterNo(astData = {}) {
  return getString(astData?.ast?.astData?.astNo || astData?.master?.id || astData?.astNo);
}

function getAstMeterType(astData = {}) {
  return normalizeText(astData?.meterType || astData?.ast?.astData?.meter?.serviceType || "water", "water").toLowerCase();
}

function isConventionalAst(astData = {}) {
  return normalizeUpper(astData?.ast?.astData?.meter?.type || astData?.meterKind || "CONVENTIONAL") === "CONVENTIONAL";
}

function getPremiseId(astData = {}) {
  return getString(astData?.accessData?.premise?.id || astData?.premise?.premiseId);
}

function getPremiseAddress(astData = {}) {
  return getString(astData?.accessData?.premise?.address || astData?.premise?.address);
}

function getErfNo(astData = {}) {
  return getString(astData?.accessData?.erfNo || astData?.premise?.erfNo);
}

function getErfId(astData = {}) {
  return getString(astData?.accessData?.erfId || astData?.premise?.erfId);
}

function getWardNo(wardPcode) {
  const tail = String(wardPcode || "").slice(-3);
  const parsed = Number(tail);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAstReadingValue(reading = {}) {
  return toNumberOrNull(reading?.reading ?? reading?.currentReading ?? reading?.tokenReading);
}

function getAstReadingAt(reading = {}) {
  return reading?.readingAt || reading?.completedAt || null;
}

function buildLaterAnchorFromAst(astData = {}, docId = "", args = {}) {
  const laterStart = toDateOrNull(args.laterStartDate);
  const mreadings = Array.isArray(astData?.mreadings) ? astData.mreadings : [];

  const candidates = mreadings
    .map((reading, index) => ({ reading, index, date: toDateOrNull(getAstReadingAt(reading)), value: getAstReadingValue(reading) }))
    .filter((item) => item.date && item.value !== null && item.date.getTime() >= laterStart.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.index - b.index);

  const first = candidates[0] || null;

  return {
    astDocId: docId.replace(/^asts\//, ""),
    astPath: docId.startsWith("asts/") ? docId : `asts/${docId}`,
    ast: astData,
    astId: getAstId(astData, docId),
    meterNo: getAstMeterNo(astData),
    meterType: getAstMeterType(astData),
    premiseId: getPremiseId(astData),
    premiseAddress: getPremiseAddress(astData),
    erfNo: getErfNo(astData),
    erfId: getErfId(astData),
    lmPcode: getString(astData?.accessData?.parents?.lmPcode),
    dmPcode: getString(astData?.accessData?.parents?.dmPcode),
    provincePcode: getString(astData?.accessData?.parents?.provincePcode),
    countryPcode: getString(astData?.accessData?.parents?.countryPcode, "ZA"),
    wardPcode: getString(astData?.accessData?.parents?.wardPcode),
    statusState: getString(astData?.status?.state),
    visibility: getString(astData?.master?.visibility),
    gps: astData?.ast?.location?.gps || null,
    serviceProvider: astData?.serviceProvider || {},
    media: Array.isArray(astData?.media) ? astData.media : [],
    laterReading: first?.reading || null,
    laterReadingIndex: first?.index ?? null,
    laterReadingValue: first?.value ?? null,
    laterReadingAt: first?.date?.toISOString() || null,
  };
}

function summarizeAnchor(anchor) {
  return {
    astId: anchor.astId,
    meterNo: anchor.meterNo,
    premiseId: anchor.premiseId,
    address: anchor.premiseAddress,
    erfNo: anchor.erfNo,
    wardPcode: anchor.wardPcode,
    geofenceId: DEFAULT_GEOFENCE_ID,
    laterReadingAt: anchor.laterReadingAt,
    laterReading: anchor.laterReadingValue,
    laterReadingSource: getString(anchor?.laterReading?.source),
    laterReadingTrnId: getString(anchor?.laterReading?.trnId),
  };
}

function isNewMeterZeroBaselineAnchor(anchor) {
  const source = normalizeUpper(anchor?.laterReading?.source, "");
  return anchor?.laterReadingValue === 0 && source === "AST_CREATION";
}

function makeFakeOldMeterNo(anchor) {
  const newNo = safeDocId(anchor?.meterNo || "UNKNOWN");
  return `OLD_${newNo}`.slice(0, 60);
}

function makeFakeOldAstId(anchor) {
  return `FAKE_REMOVED_AST_${safeDocId(anchor?.premiseId)}_${safeDocId(anchor?.erfNo || anchor?.meterNo)}`.slice(0, 120);
}

function makeReplacementInfo(anchor) {
  return {
    scenario: "METER_REPLACEMENT_OLD_REMOVED_METER",
    oldMeterWasFaked: true,
    oldMeter: {
      astId: makeFakeOldAstId(anchor),
      astNo: makeFakeOldMeterNo(anchor),
      meterKind: "CONVENTIONAL",
      meterType: anchor.meterType,
      statusState: "REMOVED",
      visibility: "INVISIBLE",
    },
    newMeter: {
      astId: anchor.astId,
      astNo: anchor.meterNo,
      meterKind: "CONVENTIONAL",
      meterType: anchor.meterType,
      statusState: anchor.statusState,
      visibility: anchor.visibility,
      openingReading: anchor.laterReadingValue,
      openingReadingAt: anchor.laterReadingAt,
      openingReadingSource: getString(anchor?.laterReading?.source),
      openingReadingTrnId: getString(anchor?.laterReading?.trnId),
    },
  };
}

function calculateReadings(anchor, index) {
  const realReading = anchor.laterReadingValue;
  const rng = makeSeededRandom(`${anchor.astId}:${anchor.meterNo}:${realReading}:${index}`);

  if (realReading === null || realReading < 0) {
    return { valid: false, reason: "ANCHOR_READING_MISSING_OR_INVALID" };
  }

  if (isNewMeterZeroBaselineAnchor(anchor)) {
    const baseReading = randomInt(rng, 850, 14500);
    const consumption = randomInt(rng, 35, 220);
    return {
      valid: true,
      scenario: "METER_REPLACEMENT_OLD_REMOVED_METER",
      cycle9Reading: baseReading,
      cycle10Reading: baseReading + consumption,
      cycle10ToLaterDelta: null,
      cycle9ToCycle10Delta: consumption,
      replacementInfo: makeReplacementInfo(anchor),
    };
  }

  if (realReading === 0) {
    return {
      valid: true,
      scenario: "ZERO_BASELINE_NO_REPLACEMENT_HISTORY",
      cycle9Reading: 0,
      cycle10Reading: 0,
      cycle10ToLaterDelta: 0,
      cycle9ToCycle10Delta: 0,
    };
  }

  const maxTotalGap = Math.max(1, Math.floor(realReading * 0.35));
  const preferredGapToLater = randomInt(rng, 5, 140);
  const preferredCycleConsumption = randomInt(rng, 5, 180);

  let gapToLater = Math.min(preferredGapToLater, Math.max(1, Math.floor(maxTotalGap / 2)));
  let cycle10Reading = Math.max(0, realReading - gapToLater);

  let cycleConsumption = Math.min(
    preferredCycleConsumption,
    Math.max(0, cycle10Reading),
    Math.max(1, Math.floor(maxTotalGap / 2)),
  );

  let cycle9Reading = Math.max(0, cycle10Reading - cycleConsumption);

  if (cycle9Reading > cycle10Reading) cycle9Reading = cycle10Reading;
  if (cycle10Reading > realReading) cycle10Reading = realReading;

  return {
    valid: true,
    scenario: "NORMAL_CONTINUATION",
    cycle9Reading,
    cycle10Reading,
    cycle10ToLaterDelta: realReading - cycle10Reading,
    cycle9ToCycle10Delta: cycle10Reading - cycle9Reading,
  };
}

function makeDocId(prefix, anchor, calculated = {}) {
  const meterNo = calculated?.scenario === "METER_REPLACEMENT_OLD_REMOVED_METER"
    ? makeFakeOldMeterNo(anchor)
    : anchor.meterNo;
  return `${prefix}_${safeDocId(meterNo)}_${safeDocId(anchor.premiseId)}_${safeDocId(anchor.wardPcode)}_${safeDocId(anchor.erfNo || anchor.erfId)}`.slice(0, 900);
}

function buildFakeCycleRow({ anchor, args, cycleNo, docId, readingAt, currentReading, previous, calculated }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const isCycle10 = cycleNo === 10;
  const scenario = calculated?.scenario || "NORMAL_CONTINUATION";
  const replacementInfo = calculated?.replacementInfo || null;
  const isReplacement = scenario === "METER_REPLACEMENT_OLD_REMOVED_METER";
  const rowMeter = isReplacement ? replacementInfo.oldMeter : {
    astId: anchor.astId,
    astNo: anchor.meterNo,
    meterKind: "CONVENTIONAL",
    meterType: anchor.meterType,
    statusState: anchor.statusState,
    visibility: anchor.visibility,
  };
  const readingAtIso = readingAt.toISOString();
  const previousReading = previous?.currentReading ?? null;
  const previousReadingAt = previous?.readingAt ?? null;
  const previousReadingSourceId = previous?.docId || NAv;
  const consumption = previousReading !== null ? currentReading - previousReading : null;
  const sincePreviousReading = previousReadingAt ? makeSincePreviousReading(previousReadingAt, readingAtIso) : null;
  const daysSinceLastReading = previousReadingAt ? daysBetween(previousReadingAt, readingAtIso) : null;
  const cycle = isCycle10
    ? makeCycle({
        cycleId: args.cycle10Id,
        cycleNo: 10,
        cycleLabel: args.cycle10Label,
        billingPeriod: args.billingPeriod,
        windowStart: args.cycle10WindowStart,
        windowEnd: args.cycle10WindowEnd,
      })
    : makeCycle({
        cycleId: args.cycle9Id,
        cycleNo: 9,
        cycleLabel: args.cycle9Label,
        billingPeriod: args.billingPeriod,
        windowStart: args.cycle9WindowStart,
        windowEnd: args.cycle9WindowEnd,
      });

  const mediaRefs = anchor.media
    .filter((item) => item?.tag === "meterReadingPhoto" || item?.tag === "meterReadingEvidence")
    .map((item) => ({
      ...item,
      createdAt: item?.createdAt || item?.created?.at || null,
      updatedAt: item?.updatedAt || item?.updated?.at || null,
    }));

  return {
    id: docId,
    fake: true,
    fakeReason: isReplacement
      ? `Controlled ${cycle.cycleLabel} fake old removed meter seed for Gf Maninjwa replacement MREAD staging`
      : `Controlled ${cycle.cycleLabel} test seed for Gf Maninjwa MREAD staging`,
    actor: {
      capturedByName: SCRIPT_NAME,
      capturedByRole: "SYSTEM_SCRIPT",
      capturedByUid: "SYSTEM_SCRIPT",
      spId: getString(anchor?.serviceProvider?.id),
      spName: getString(anchor?.serviceProvider?.name),
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
    billingReadiness: isReplacement
      ? {
          reasonCode: "METER_REPLACEMENT_REVIEW_REQUIRED",
          reasonText: "Fake historical reading belongs to a fake old removed meter; new installed meter starts at AST_CREATION reading 0.",
          status: "BILLING_REVIEW_REQUIRED",
        }
      : isCycle10
        ? { reasonCode: NAv, reasonText: NAv, status: "BILLING_READY_CANDIDATE" }
        : {
            reasonCode: "MREAD_PREVIOUS_READING_MISSING",
            reasonText: "Previous reading is missing; this fake Cycle 9 row is the baseline for Cycle 10 staging tests.",
            status: "BILLING_REVIEW_REQUIRED",
          },
    cycle,
    dataQuality: {
      hasRequiredSourceRefs: true,
      missingFields: null,
      requiresDataFix: false,
      warnings: isReplacement
        ? ["fake_meter_replacement_old_removed_meter", "new_meter_ast_creation_opening_reading_zero"]
        : isCycle10 ? null : ["fake_cycle9_baseline_previous_reading_missing"],
    },
    evidence: {
      gps: {
        accuracy: null,
        lat: anchor?.gps?.lat ?? null,
        lng: anchor?.gps?.lng ?? null,
        source: "ast.location.gps",
      },
      hasMeterReadingEvidence: mediaRefs.length > 0,
      hasNoAccessPhoto: false,
      hasPhoto: mediaRefs.length > 0,
      hasUnsuccessfulReadingEvidence: false,
      mediaRefs: mediaRefs.length > 0 ? mediaRefs : null,
      mediaTags: mediaRefs.length > 0 ? mediaRefs.map((item) => item.tag).filter(Boolean) : null,
      notes: isReplacement
        ? `Fake ${cycle.cycleLabel} old removed meter MREAD row generated for Gf Maninjwa replacement staging test.`
        : `Fake ${cycle.cycleLabel} MREAD seed row generated for Gf Maninjwa staging test.`,
      photoCount: mediaRefs.length,
    },
    fakeSeed: {
      billingPeriod: args.billingPeriod,
      cycleId: cycle.cycleId,
      cycleLabel: cycle.cycleLabel,
      scenario,
      replacement: replacementInfo,
      generatedReading: {
        currentReading,
        previousReading,
        previousReadingAt,
        previousReadingSourceId,
        consumption,
        daysSinceLastReading,
        generationMethod: isReplacement
          ? "FAKE_OLD_REMOVED_METER_HISTORICAL_READINGS_FOR_NEW_ZERO_BASELINE_METER"
          : isCycle10
            ? "MANINJWA_AST_LATER_READING_MINUS_RANDOM_DELTA_WITH_CYCLE9_BASELINE"
            : "MANINJWA_CYCLE10_FAKE_MINUS_RANDOM_DELTA",
        referenceLaterReading: {
          astId: anchor.astId,
          astPath: anchor.astPath,
          trnId: getString(anchor?.laterReading?.trnId),
          source: getString(anchor?.laterReading?.source),
          meterNo: anchor.meterNo,
          premiseId: anchor.premiseId,
          reading: anchor.laterReadingValue,
          readingAt: anchor.laterReadingAt,
        },
      },
      readingDay: isCycle10 ? args.cycle10ReadingDate : args.cycle9ReadingDate,
      safeToDelete: true,
      scriptName: SCRIPT_NAME,
      scriptVersion: SCRIPT_VERSION,
      seedType: FAKE_SEED_TYPE,
      source: isReplacement ? "AST_MREADINGS_MANINJWA_SCOPE_REPLACEMENT_FAKE_OLD_METER" : "AST_MREADINGS_MANINJWA_SCOPE",
      sourceAstId: anchor.astId,
      sourceAstPath: anchor.astPath,
      targetGeofenceId: args.geofenceId,
      targetGeofenceName: args.geofenceName,
      testArea: `${args.geofenceName} / Ward 8 / KSD`,
    },
    geography: {
      countryPcode: anchor.countryPcode,
      dmName: NAv,
      dmPcode: anchor.dmPcode,
      geofenceId: args.geofenceId,
      geofenceName: args.geofenceName,
      lmName: NAv,
      lmPcode: anchor.lmPcode,
      provincePcode: anchor.provincePcode,
      wardNo: getWardNo(anchor.wardPcode),
      wardPcode: anchor.wardPcode,
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
      astId: rowMeter.astId,
      astNo: rowMeter.astNo,
      meterKind: rowMeter.meterKind,
      meterType: rowMeter.meterType,
      statusState: rowMeter.statusState,
      visibility: rowMeter.visibility,
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
      address: anchor.premiseAddress,
      erfId: anchor.erfId,
      erfNo: anchor.erfNo,
      premiseId: anchor.premiseId,
      propertyType: getString(anchor?.ast?.accessData?.premise?.propertyType, "Residential"),
      suburbName: NAv,
    },
    reading: {
      consumption,
      currentReading,
      daysSinceLastReading,
      previousReading,
      previousReadingAt,
      previousReadingTrnId: previousReadingSourceId,
      previousReadingSourceId,
      readingAt: readingAtIso,
      sincePreviousReading,
    },
    review: {
      actionRequired: isReplacement || !isCycle10,
      actionType: isReplacement ? "METER_REPLACEMENT_REVIEW" : isCycle10 ? NAv : "BASELINE_ONLY_FAKE_TEST_ROW",
      reviewNotes: isReplacement
        ? "Fake old removed meter historical reading; new installed meter opens at 0 from AST_CREATION."
        : isCycle10 ? NAv : "Fake Cycle 9 row is used as the previous baseline for Cycle 10 staging tests.",
      reviewedAt: null,
      reviewedByName: NAv,
      reviewedByUid: NAv,
      status: isReplacement || !isCycle10 ? "REVIEW_REQUIRED" : NAv,
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

function readAstExport(astExportPath) {
  const resolved = path.resolve(astExportPath);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Object.entries(parsed || {}).map(([key, value]) => ({ docId: key.replace(/^asts\//, ""), data: value || {} }));
}

async function loadAstScope(db, args) {
  let rawRows = [];
  let source = "FIRESTORE_ASTS_QUERY";

  if (args.astExportPath) {
    rawRows = readAstExport(args.astExportPath);
    source = `AST_EXPORT:${path.resolve(args.astExportPath)}`;
  } else {
    const snap = await db
      .collection(args.astsCollection)
      .where("accessData.parents.lmPcode", "==", args.lmPcode)
      .get();
    rawRows = snap.docs.map((doc) => ({ docId: doc.id, data: doc.data() || {} }));
  }

  const scopedRows = rawRows.filter(({ data }) => {
    const lm = getString(data?.accessData?.parents?.lmPcode, "");
    const ward = getString(data?.accessData?.parents?.wardPcode, "");
    if (lm !== args.lmPcode) return false;
    if (args.wardPcode && ward !== args.wardPcode) return false;
    if (!hasGeofence(data, args)) return false;
    if (getAstMeterType(data) !== "water") return false;
    if (!isConventionalAst(data)) return false;
    return true;
  });

  const anchors = scopedRows.map(({ docId, data }) => buildLaterAnchorFromAst(data, docId, args));
  const validAnchors = [];
  const skippedAnchors = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const key = anchor.astId || `${anchor.meterNo}:${anchor.premiseId}`;
    if (seen.has(key)) {
      skippedAnchors.push({ ...summarizeAnchor(anchor), reason: "DUPLICATE_AST_SCOPE_KEY" });
      continue;
    }
    seen.add(key);

    if (!anchor.meterNo || anchor.meterNo === NAv || !anchor.premiseId || anchor.premiseId === NAv) {
      skippedAnchors.push({ ...summarizeAnchor(anchor), reason: "MISSING_METER_OR_PREMISE" });
      continue;
    }

    if (anchor.laterReadingValue === null || !anchor.laterReadingAt) {
      skippedAnchors.push({ ...summarizeAnchor(anchor), reason: "NO_LATER_AST_MREADING_FOUND" });
      continue;
    }

    validAnchors.push(anchor);
  }

  validAnchors.sort((a, b) => {
    const addressCompare = getString(a.premiseAddress, "").localeCompare(getString(b.premiseAddress, ""), undefined, { numeric: true });
    if (addressCompare !== 0) return addressCompare;
    return getString(a.meterNo, "").localeCompare(getString(b.meterNo, ""));
  });

  if (args.maxMeters > 0) {
    return {
      source,
      scannedAstRows: rawRows.length,
      scopedAstRows: scopedRows.length,
      uniqueAnchors: validAnchors.slice(0, args.maxMeters),
      skippedAnchors,
      cappedFrom: validAnchors.length,
    };
  }

  return { source, scannedAstRows: rawRows.length, scopedAstRows: scopedRows.length, uniqueAnchors: validAnchors, skippedAnchors, cappedFrom: null };
}

async function loadExistingTargetDocs(db, registryCollection, plannedRows) {
  const checks = [];
  for (const row of plannedRows) {
    checks.push(db.collection(registryCollection).doc(row.docId).get());
  }
  const snaps = await Promise.all(checks);
  const existing = new Set();
  snaps.forEach((snap, index) => {
    if (snap.exists) existing.add(plannedRows[index].docId);
  });
  return existing;
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
    console.log(`Created ${createdCount}/${rowsToCreate.length} fake MREAD registry rows...`);
  }
  return createdCount;
}

function writeReport(reportDir, report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").replace("Z", "Z");
  const filename = `seed_fake_cycle9_cycle10_registry_mread_report_${stamp}.json`;
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

  const db = initAdmin();
  const startedAt = new Date().toISOString();

  console.log("============================================================");
  console.log("Seed Fake MREAD Cycle 9 + Cycle 10 Registry Rows");
  console.log("============================================================");
  console.log(`Mode: ${args.execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`Registry collection: ${args.registryCollection}`);
  console.log(`AST scope source: ${args.astExportPath ? args.astExportPath : args.astsCollection}`);
  console.log(`LM guard: ${args.lmPcode}`);
  console.log(`Ward guard: ${args.wardPcode}`);
  console.log(`Geofence guard: ${args.geofenceName} (${args.geofenceId})`);
  console.log(`Expected scoped meters: ${args.expectedCount || "not enforced"}`);
  console.log(`Cycle 9 reading date: ${args.cycle9ReadingDate}`);
  console.log(`Cycle 10 reading date: ${args.cycle10ReadingDate}`);
  console.log(`Later AST mreading anchor starts at: ${args.laterStartDate}`);
  console.log("Reading chain rule: normal = Cycle 9 fake <= Cycle 10 fake <= first later AST mreading; replacement = old fake meter history + new meter starts at 0");
  console.log("Create mode: create-only; existing target docs are skipped");
  console.log("============================================================");

  const { source, scannedAstRows, scopedAstRows, uniqueAnchors, skippedAnchors, cappedFrom } = await loadAstScope(db, args);

  if (args.expectedCount > 0 && !args.allowCountMismatch && scopedAstRows !== args.expectedCount) {
    throw new Error(
      `Scoped AST count mismatch. Expected ${args.expectedCount}, found ${scopedAstRows}. This script is locked to Gf Maninjwa; fix the scope or pass --allow-count-mismatch intentionally.`,
    );
  }

  const cycle9BaseTime = parseRouteDateTime(args.cycle9ReadingDate, args.routeStartTime);
  const cycle10BaseTime = parseRouteDateTime(args.cycle10ReadingDate, args.routeStartTime);
  let cycle9Cursor = cycle9BaseTime;
  let cycle10Cursor = cycle10BaseTime;
  const plannedRows = [];
  const plannedChains = [];
  const calculationSkips = [];

  uniqueAnchors.forEach((anchor, index) => {
    const rng = makeSeededRandom(`route:${anchor.astId}:${anchor.meterNo}:${index}`);
    if (index > 0) {
      cycle9Cursor = addMinutes(cycle9Cursor, randomInt(rng, 5, 20));
      cycle10Cursor = addMinutes(cycle10Cursor, randomInt(rng, 5, 20));
    }

    const calculated = calculateReadings(anchor, index);
    if (!calculated.valid) {
      calculationSkips.push({ ...summarizeAnchor(anchor), reason: calculated.reason });
      return;
    }

    const cycle9DocId = makeDocId("FAKE_MREAD_CYCLE09", anchor, calculated);
    const cycle10DocId = makeDocId("FAKE_MREAD_CYCLE10", anchor, calculated);
    const cycle9ReadingAt = cycle9Cursor.toISOString();
    const cycle10ReadingAt = cycle10Cursor.toISOString();

    const cycle9Data = buildFakeCycleRow({
      anchor,
      args,
      cycleNo: 9,
      docId: cycle9DocId,
      readingAt: cycle9Cursor,
      currentReading: calculated.cycle9Reading,
      previous: null,
      calculated,
    });

    const cycle10Data = buildFakeCycleRow({
      anchor,
      args,
      cycleNo: 10,
      docId: cycle10DocId,
      readingAt: cycle10Cursor,
      currentReading: calculated.cycle10Reading,
      previous: {
        docId: cycle9DocId,
        currentReading: calculated.cycle9Reading,
        readingAt: cycle9ReadingAt,
      },
      calculated,
    });

    plannedRows.push({ docId: cycle9DocId, cycleId: args.cycle9Id, data: cycle9Data });
    plannedRows.push({ docId: cycle10DocId, cycleId: args.cycle10Id, data: cycle10Data });

    plannedChains.push({
      scenario: calculated.scenario || "NORMAL_CONTINUATION",
      replacement: calculated.replacementInfo || null,
      astId: anchor.astId,
      meterNo: anchor.meterNo,
      premiseId: anchor.premiseId,
      address: anchor.premiseAddress,
      wardPcode: anchor.wardPcode,
      geofenceId: args.geofenceId,
      geofenceName: args.geofenceName,
      cycle9: {
        docId: cycle9DocId,
        readingAt: cycle9ReadingAt,
        currentReading: calculated.cycle9Reading,
      },
      cycle10: {
        docId: cycle10DocId,
        readingAt: cycle10ReadingAt,
        previousReading: calculated.cycle9Reading,
        currentReading: calculated.cycle10Reading,
        consumption: calculated.cycle9ToCycle10Delta,
        daysSinceLastReading: daysBetween(cycle9ReadingAt, cycle10ReadingAt),
      },
      laterReal: {
        source: getString(anchor?.laterReading?.source),
        trnId: getString(anchor?.laterReading?.trnId),
        readingAt: anchor.laterReadingAt,
        currentReading: anchor.laterReadingValue,
      },
      consistency: {
        cycle9LessThanOrEqualCycle10: calculated.cycle9Reading <= calculated.cycle10Reading,
        cycle10LessThanOrEqualLaterReal: calculated.scenario === "METER_REPLACEMENT_OLD_REMOVED_METER"
          ? "N/A_REPLACEMENT_NEW_METER_STARTS_AT_ZERO"
          : calculated.cycle10Reading <= anchor.laterReadingValue,
      },
    });
  });

  const existingTargetDocs = await loadExistingTargetDocs(db, args.registryCollection, plannedRows);
  const rowsToCreate = plannedRows.filter((row) => !existingTargetDocs.has(row.docId));
  const existingRows = plannedRows.filter((row) => existingTargetDocs.has(row.docId));

  const byCyclePlanned = plannedRows.reduce((acc, row) => {
    acc[row.cycleId] = (acc[row.cycleId] || 0) + 1;
    return acc;
  }, {});
  const byCycleToCreate = rowsToCreate.reduce((acc, row) => {
    acc[row.cycleId] = (acc[row.cycleId] || 0) + 1;
    return acc;
  }, {});
  const chainsByScenario = plannedChains.reduce((acc, chain) => {
    acc[chain.scenario] = (acc[chain.scenario] || 0) + 1;
    return acc;
  }, {});
  const rowsToCreateByScenario = rowsToCreate.reduce((acc, row) => {
    const scenario = row?.data?.fakeSeed?.scenario || "NORMAL_CONTINUATION";
    acc[scenario] = (acc[scenario] || 0) + 1;
    return acc;
  }, {});

  console.log(`AST source: ${source}`);
  console.log(`Scanned AST rows: ${scannedAstRows}`);
  console.log(`Scoped ${args.geofenceName} AST rows: ${scopedAstRows}`);
  console.log(`Unique meter anchors selected: ${uniqueAnchors.length}${cappedFrom ? ` (capped from ${cappedFrom})` : ""}`);
  console.log(`Skipped scope anchors: ${skippedAnchors.length}`);
  console.log(`Skipped calculation anchors: ${calculationSkips.length}`);
  console.log(`Planned fake rows: ${plannedRows.length}`);
  console.log(`Existing target rows skipped: ${existingRows.length}`);
  console.log(`Rows to create: ${rowsToCreate.length}`);
  console.log("Rows to create by cycle:");
  console.log(JSON.stringify(byCycleToCreate, null, 2));
  console.log("Planned meter chains by scenario:");
  console.log(JSON.stringify(chainsByScenario, null, 2));
  console.log("Rows to create by scenario:");
  console.log(JSON.stringify(rowsToCreateByScenario, null, 2));

  if (plannedChains.length > 0) {
    console.log("Sample planned reading chains:");
    console.log(JSON.stringify(plannedChains.slice(0, 5), null, 2));
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
    registryCollection: args.registryCollection,
    astsCollection: args.astsCollection,
    astExportPath: args.astExportPath || null,
    scope: {
      lmPcode: args.lmPcode,
      wardPcode: args.wardPcode,
      geofenceId: args.geofenceId,
      geofenceName: args.geofenceName,
      expectedCount: args.expectedCount,
      allowCountMismatch: args.allowCountMismatch,
    },
    cycles: {
      cycle9: {
        cycleId: args.cycle9Id,
        cycleLabel: args.cycle9Label,
        readingDate: args.cycle9ReadingDate,
        windowStart: args.cycle9WindowStart,
        windowEnd: args.cycle9WindowEnd,
      },
      cycle10: {
        cycleId: args.cycle10Id,
        cycleLabel: args.cycle10Label,
        readingDate: args.cycle10ReadingDate,
        windowStart: args.cycle10WindowStart,
        windowEnd: args.cycle10WindowEnd,
      },
      laterAnchorStartDate: args.laterStartDate,
    },
    counts: {
      scannedAstRows,
      scopedAstRows,
      uniqueMeterAnchorsSelected: uniqueAnchors.length,
      skippedScopeAnchors: skippedAnchors.length,
      skippedCalculationAnchors: calculationSkips.length,
      plannedFakeRows: plannedRows.length,
      existingTargetRowsSkipped: existingRows.length,
      rowsToCreate: rowsToCreate.length,
      createdRows: createdCount,
    },
    plannedRowsByCycle: byCyclePlanned,
    rowsToCreateByCycle: byCycleToCreate,
    plannedMeterChainsByScenario: chainsByScenario,
    rowsToCreateByScenario,
    anchors: uniqueAnchors.map(summarizeAnchor),
    skippedAnchors,
    calculationSkips,
    existingRows: existingRows.map((row) => ({ docId: row.docId, cycleId: row.cycleId })),
    plannedChains,
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
