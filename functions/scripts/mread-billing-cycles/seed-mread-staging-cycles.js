// functions/scripts/mread-billing-cycles/seed-mread-staging-cycles.js
//
// Safe create-only seed for MREAD staging cycle controller docs.
//
// Dry-run examples:
//   node scripts/mread-billing-cycles/seed-mread-staging-cycles.js --project ireps2 --lmPcode ZA7423 --lmName "Lesedi"
//   node scripts/mread-billing-cycles/seed-mread-staging-cycles.js --project ireps2 --all-missing
//
// Write examples:
//   node scripts/mread-billing-cycles/seed-mread-staging-cycles.js --project ireps2 --lmPcode ZA7423 --lmName "Lesedi" --confirm
//   node scripts/mread-billing-cycles/seed-mread-staging-cycles.js --project ireps2 --all-missing --confirm
//
// Safety:
// - Dry-run by default.
// - Requires --confirm before any Firestore write.
// - Create-only: existing docs are skipped and never overwritten.
// - Does not create mread_staging parent docs or row subcollections.

import { existsSync, readFileSync } from "node:fs";
import admin from "firebase-admin";

const COLLECTION_LMS = "lms";
const COLLECTION_CYCLES = "mread_staging_cycles";
const SCRIPT_NAME = "seed-mread-staging-cycles.js";
const SCRIPT_VERSION = "1.0.0";
const SETUP_TYPE = "MREAD_STAGING_CYCLE_SEED";
const TIMEZONE = "Africa/Johannesburg";
const WINDOW_PATTERN = "MONTHLY_16_TO_15";
const SYSTEM_UID = "SYSTEM_SCRIPT";
const SYSTEM_USER = SCRIPT_NAME;
const PROJECT_CREDENTIAL_FILES = Object.freeze({
  ireps2: "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json",
  "ireps-test": "C:\\dev\\secrets\\ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
});
const BILLING_PERIODS = [
  { startYear: 2025, endYear: 2026 },
  { startYear: 2026, endYear: 2027 },
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const ZERO_SUMMARY = Object.freeze({
  mediaEvidence: 0,
  noAccess: 0,
  rowsWithConsumption: 0,
  rowsWithCurrentReading: 0,
  successfulReads: 0,
  totalRows: 0,
  unsuccessful: 0,
});

function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeLmPcode(value) {
  return normalizeText(value).toUpperCase();
}

function resolveCredentialFile(projectId, args = {}) {
  const explicitCredentialFile = normalizeText(args.credentials || args.credentialFile || args.keyFile);
  const defaultCredentialFile = PROJECT_CREDENTIAL_FILES[projectId];
  const credentialFile = explicitCredentialFile || defaultCredentialFile;

  if (!credentialFile) {
    throw new Error(
      `No credential file is configured for project "${projectId}". `
        + "Pass --credentials C:\\dev\\secrets\\your-service-account.json",
    );
  }

  if (!existsSync(credentialFile)) {
    throw new Error(
      `Credential file was not found: ${credentialFile}. `
        + "Check C:\\dev\\secrets or pass --credentials with the correct path.",
    );
  }

  return credentialFile;
}

function loadServiceAccount(projectId, credentialFile) {
  const serviceAccount = JSON.parse(readFileSync(credentialFile, "utf8"));
  const serviceAccountProjectId = normalizeText(serviceAccount.project_id);

  if (serviceAccountProjectId && serviceAccountProjectId !== projectId) {
    throw new Error(
      `Credential project mismatch. --project is "${projectId}" but key file belongs to "${serviceAccountProjectId}".`,
    );
  }

  return serviceAccount;
}

function initializeFirebase(projectId, args = {}) {
  if (!projectId) {
    throw new Error('Missing required --project value. Example: --project ireps2');
  }

  const credentialFile = resolveCredentialFile(projectId, args);
  const serviceAccount = loadServiceAccount(projectId, credentialFile);

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId,
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return {
    db: admin.firestore(),
    credentialFile,
  };
}

function getTodayInTimezone(timezone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function toDateOnly(value) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  }
  return text;
}

function toTimestampStart(dateText) {
  return admin.firestore.Timestamp.fromDate(new Date(`${dateText}T00:00:00.000Z`));
}

function toTimestampEnd(dateText) {
  return admin.firestore.Timestamp.fromDate(new Date(`${dateText}T23:59:59.999Z`));
}

function toUtcDate(dateText) {
  return new Date(`${dateText}T00:00:00.000Z`);
}

function formatDateDisplay(dateText) {
  const [yearText, monthText, dayText] = dateText.split("-");
  const monthIndex = Number(monthText) - 1;
  return `${Number(dayText)} ${MONTH_NAMES[monthIndex]} ${yearText}`;
}

function shortBillingPeriod(startYear, endYear) {
  return `${startYear}/${String(endYear).slice(-2)}`;
}

function fullBillingPeriod(startYear, endYear) {
  return `${startYear}/${endYear}`;
}

function cycleNoText(cycleNo) {
  return String(cycleNo).padStart(2, "0");
}

function addMonths(year, monthIndex, monthsToAdd) {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  date.setUTCMonth(date.getUTCMonth() + monthsToAdd);
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
  };
}

function buildCycleWindow(startYear, cycleNo) {
  // Cycle 1 starts on 16 July of the billing-period start year.
  const startMonthIndex = 6; // July, zero-based.
  const start = addMonths(startYear, startMonthIndex, cycleNo - 1);
  const end = addMonths(startYear, startMonthIndex, cycleNo);

  const startDate = `${start.year}-${String(start.monthIndex + 1).padStart(2, "0")}-16`;
  const endDate = `${end.year}-${String(end.monthIndex + 1).padStart(2, "0")}-15`;

  return {
    startDate,
    endDate,
    display: `${formatDateDisplay(startDate)} - ${formatDateDisplay(endDate)}`,
  };
}

function buildExpectedCycles(lmPcode, lmName, asOfDate) {
  const cycles = [];

  for (const period of BILLING_PERIODS) {
    const billingPeriod = shortBillingPeriod(period.startYear, period.endYear);
    const billingPeriodFull = fullBillingPeriod(period.startYear, period.endYear);

    for (let cycleNo = 1; cycleNo <= 12; cycleNo += 1) {
      const paddedCycleNo = cycleNoText(cycleNo);
      const cycleCode = `${period.startYear}_${period.endYear}_CYCLE_${paddedCycleNo}`;
      const cycleId = `${lmPcode}_${cycleCode}`;
      const window = buildCycleWindow(period.startYear, cycleNo);

      cycles.push({
        cycleId,
        lmPcode,
        lmName,
        billingPeriod,
        billingPeriodFull,
        billingPeriodStartYear: period.startYear,
        billingPeriodEndYear: period.endYear,
        cycleCode,
        cycleLabel: `Cycle ${cycleNo} - ${billingPeriod}`,
        cycleNo,
        cycleNoText: paddedCycleNo,
        window,
        asOfDate,
      });
    }
  }

  return cycles;
}

function toCycleDoc(cycle, nowTimestamp) {
  return {
    activeStagingId: null,
    billingPeriod: cycle.billingPeriod,
    billingPeriodEndYear: cycle.billingPeriodEndYear,
    billingPeriodFull: cycle.billingPeriodFull,
    billingPeriodStartYear: cycle.billingPeriodStartYear,
    currentIteration: 0,
    cycleCode: cycle.cycleCode,
    cycleId: cycle.cycleId,
    cycleLabel: cycle.cycleLabel,
    cycleNo: cycle.cycleNo,
    cycleNoText: cycle.cycleNoText,
    lastGenerated: null,
    lmPcode: cycle.lmPcode,
    lmName: cycle.lmName || null,
    metadata: {
      created: {
        at: nowTimestamp,
        byUid: SYSTEM_UID,
        byUser: SYSTEM_USER,
      },
      source: {
        asOfDate: cycle.asOfDate,
        collection: COLLECTION_CYCLES,
        scriptName: SCRIPT_NAME,
        scriptVersion: SCRIPT_VERSION,
        setupType: SETUP_TYPE,
        timezone: TIMEZONE,
      },
      updated: {
        at: nowTimestamp,
        byUid: SYSTEM_UID,
        byUser: SYSTEM_USER,
      },
    },
    summary: { ...ZERO_SUMMARY },
    window: {
      display: cycle.window.display,
      end: toTimestampEnd(cycle.window.endDate),
      endDate: cycle.window.endDate,
      pattern: WINDOW_PATTERN,
      start: toTimestampStart(cycle.window.startDate),
      startDate: cycle.window.startDate,
    },
  };
}

function getLmNameFromData(data, fallback) {
  return normalizeText(data?.name) || normalizeText(data?.lmName) || fallback;
}

async function resolveLmTargets(db, args) {
  const allMissing = args["all-missing"] === true;
  const lmPcode = normalizeLmPcode(args.lmPcode);

  if (allMissing && lmPcode) {
    throw new Error("Use either --all-missing or --lmPcode, not both.");
  }

  if (!allMissing && !lmPcode) {
    throw new Error('Missing target. Use --lmPcode ZA7423 or --all-missing.');
  }

  if (lmPcode) {
    const lmSnap = await db.collection(COLLECTION_LMS).doc(lmPcode).get();
    const lmName = normalizeText(args.lmName) || (lmSnap.exists ? getLmNameFromData(lmSnap.data(), lmPcode) : lmPcode);

    if (!lmSnap.exists) {
      console.warn(`[iREPS] Warning: lms/${lmPcode} was not found. The script will still preview/create cycles for the requested lmPcode.`);
    }

    return [{ lmPcode, lmName }];
  }

  const lmsSnap = await db.collection(COLLECTION_LMS).get();
  const targets = [];

  for (const doc of lmsSnap.docs) {
    const candidateLmPcode = normalizeLmPcode(doc.id);
    const expectedCycles = buildExpectedCycles(candidateLmPcode, getLmNameFromData(doc.data(), candidateLmPcode), getTodayInTimezone());
    const existingRefs = await getExistingCycleIds(db, expectedCycles.map((cycle) => cycle.cycleId));

    if (existingRefs.size < expectedCycles.length) {
      targets.push({
        lmPcode: candidateLmPcode,
        lmName: getLmNameFromData(doc.data(), candidateLmPcode),
      });
    }
  }

  return targets;
}

async function getExistingCycleIds(db, cycleIds) {
  const existing = new Set();

  for (let index = 0; index < cycleIds.length; index += 10) {
    const chunk = cycleIds.slice(index, index + 10);
    const snaps = await Promise.all(
      chunk.map((cycleId) => db.collection(COLLECTION_CYCLES).doc(cycleId).get()),
    );

    for (const snap of snaps) {
      if (snap.exists) existing.add(snap.id);
    }
  }

  return existing;
}

async function createMissingCycleDocs(db, missingCycles, nowTimestamp) {
  let created = 0;

  for (let index = 0; index < missingCycles.length; index += 450) {
    const chunk = missingCycles.slice(index, index + 450);
    const batch = db.batch();

    for (const cycle of chunk) {
      const ref = db.collection(COLLECTION_CYCLES).doc(cycle.cycleId);
      batch.create(ref, toCycleDoc(cycle, nowTimestamp));
    }

    await batch.commit();
    created += chunk.length;
  }

  return created;
}

async function verifyCreatedDocs(db, expectedCycleIds) {
  const existing = await getExistingCycleIds(db, expectedCycleIds);
  return existing.size;
}

function printTargetPreview({ lmPcode, lmName, expectedCount, existingCount, missingCycles }) {
  console.log("");
  console.log(`LM: ${lmPcode} / ${lmName}`);
  console.log(`Expected cycle docs: ${expectedCount}`);
  console.log(`Existing docs skipped: ${existingCount}`);
  console.log(`Missing docs to create: ${missingCycles.length}`);

  if (missingCycles.length) {
    console.log("Missing cycle IDs:");
    for (const cycle of missingCycles) {
      console.log(`- ${cycle.cycleId} | ${cycle.window.display} | CONFIG`);
    }
  }
}

async function processTarget({ db, target, asOfDate, dryRun }) {
  const expectedCycles = buildExpectedCycles(target.lmPcode, target.lmName, asOfDate);
  const expectedCycleIds = expectedCycles.map((cycle) => cycle.cycleId);
  const existingCycleIds = await getExistingCycleIds(db, expectedCycleIds);
  const missingCycles = expectedCycles.filter((cycle) => !existingCycleIds.has(cycle.cycleId));

  printTargetPreview({
    lmPcode: target.lmPcode,
    lmName: target.lmName,
    expectedCount: expectedCycles.length,
    existingCount: existingCycleIds.size,
    missingCycles,
  });

  if (dryRun || !missingCycles.length) {
    return {
      expected: expectedCycles.length,
      existing: existingCycleIds.size,
      missing: missingCycles.length,
      created: 0,
      verified: existingCycleIds.size,
    };
  }

  const nowTimestamp = admin.firestore.Timestamp.now();
  const created = await createMissingCycleDocs(db, missingCycles, nowTimestamp);
  const verified = await verifyCreatedDocs(db, expectedCycleIds);

  return {
    expected: expectedCycles.length,
    existing: existingCycleIds.size,
    missing: missingCycles.length,
    created,
    verified,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = normalizeText(args.project);
  const asOfDate = toDateOnly(args.asOfDate || getTodayInTimezone());
  const confirm = args.confirm === true;
  const dryRun = !confirm;

  const { db, credentialFile } = initializeFirebase(projectId, args);

  console.log("");
  console.log("MREAD staging cycle seed");
  console.log("─────────────────────────");
  console.log(`Project: ${projectId}`);
  console.log(`Credential file: ${credentialFile}`);
  console.log(`Collection: ${COLLECTION_CYCLES}`);
  console.log(`As-of date: ${asOfDate}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN (no writes)" : "CONFIRMED WRITE"}`);
  console.log("");

  if (dryRun) {
    console.log("No Firestore writes will be made. Add --confirm to write missing docs.");
  } else {
    console.log("Confirmed write mode. Existing cycle docs will still be skipped and never overwritten.");
  }

  const targets = await resolveLmTargets(db, args);

  if (!targets.length) {
    console.log("");
    console.log("No target LMs require cycle setup.");
    return;
  }

  let totals = {
    expected: 0,
    existing: 0,
    missing: 0,
    created: 0,
    verified: 0,
  };

  for (const target of targets) {
    const result = await processTarget({ db, target, asOfDate, dryRun });
    totals = {
      expected: totals.expected + result.expected,
      existing: totals.existing + result.existing,
      missing: totals.missing + result.missing,
      created: totals.created + result.created,
      verified: totals.verified + result.verified,
    };
  }

  console.log("");
  console.log("Summary");
  console.log("───────");
  console.log(`Targets: ${targets.length}`);
  console.log(`Expected docs: ${totals.expected}`);
  console.log(`Existing docs skipped: ${totals.existing}`);
  console.log(`Missing docs found: ${totals.missing}`);
  console.log(`Created docs: ${totals.created}`);
  console.log(`Verified docs after run: ${totals.verified}`);

  if (dryRun && totals.missing) {
    console.log("");
    console.log("Dry-run complete. Re-run with --confirm to create the missing docs.");
  }
}

main().catch((error) => {
  console.error("");
  console.error("MREAD staging cycle seed failed:");
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
