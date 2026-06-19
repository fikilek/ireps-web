#!/usr/bin/env node
/**
 * iREPS MREAD Staging v1 — Phase 0 Billing Cycle Seed Script
 *
 * Purpose:
 *   Creates controlled MREAD staging cycle controller documents in Firestore.
 *
 * Writes to:
 *   mread_staging_cycles/{cycleId}
 *
 * Important boundaries:
 *   - Does NOT create registry_mread test/fake data.
 *   - Does NOT create mread_staging rows.
 *   - Does NOT run generateMreadStaging.
 *   - Does NOT estimate consumption.
 *   - Does NOT apply billing rules.
 *
 * Default behaviour:
 *   - Dry-run only unless --confirm is provided.
 *   - Create-only unless --force is provided.
 *
 * Default service account path:
 *   C:\dev\secrets\ireps2-e72fd9dc94de.json
 */

import admin from 'firebase-admin';

const SCRIPT_NAME = 'seed_mread_staging_cycles.js';
const SCRIPT_VERSION = '1.0.1';
const DEFAULT_SERVICE_ACCOUNT_PATH = 'C:\\dev\\secrets\\ireps2-e72fd9dc94de.json';
const DEFAULT_COLLECTION = 'mread_staging_cycles';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) fail(`Invalid date '${dateKey}'. Expected YYYY-MM-DD.`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function dateKeyToUtcDate(dateKey, endOfDay = false) {
  const { year, month, day } = parseDateKey(dateKey);
  if (endOfDay) {
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function compareDateKeys(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function shortFinancialYearLabel(startYear) {
  const endYear = startYear + 1;
  return `${startYear}/${String(endYear).slice(-2)}`;
}

function fullFinancialYearLabel(startYear) {
  return `${startYear}/${startYear + 1}`;
}

function getCycleWindow(fyStartYear, cycleNo) {
  if (cycleNo < 1 || cycleNo > 12) {
    fail(`Invalid cycle number ${cycleNo}. Expected 1 to 12.`);
  }

  // Locked business rule:
  // Cycle 1 = 16 July FY-start-year to 15 August FY-start-year.
  // Cycle 12 = 16 June FY-end-year to 15 July FY-end-year.
  const startMonthIndexZeroBased = 6 + (cycleNo - 1); // July is 6.
  const startYear = fyStartYear + Math.floor(startMonthIndexZeroBased / 12);
  const startMonth = (startMonthIndexZeroBased % 12) + 1;

  const endMonthIndexZeroBased = startMonthIndexZeroBased + 1;
  const endYear = fyStartYear + Math.floor(endMonthIndexZeroBased / 12);
  const endMonth = (endMonthIndexZeroBased % 12) + 1;

  return {
    startDate: toDateKey(startYear, startMonth, 16),
    endDate: toDateKey(endYear, endMonth, 15),
    display: `16 ${MONTH_NAMES[startMonth - 1]} ${startYear} - 15 ${MONTH_NAMES[endMonth - 1]} ${endYear}`,
  };
}

function buildAllCyclePreviews(lmPcode, fyStartYears) {
  const cycles = [];
  fyStartYears.forEach((fyStartYear) => {
    for (let cycleNo = 1; cycleNo <= 12; cycleNo += 1) {
      const window = getCycleWindow(fyStartYear, cycleNo);
      const cycleNoText = pad2(cycleNo);
      const cycleId = `${lmPcode}_${fyStartYear}_${fyStartYear + 1}_CYCLE_${cycleNoText}`;
      cycles.push({
        cycleId,
        lmPcode,
        billingPeriod: shortFinancialYearLabel(fyStartYear),
        billingPeriodFull: fullFinancialYearLabel(fyStartYear),
        billingPeriodStartYear: fyStartYear,
        billingPeriodEndYear: fyStartYear + 1,
        cycleNo,
        cycleNoText,
        cycleCode: `${fyStartYear}_${fyStartYear + 1}_CYCLE_${cycleNoText}`,
        cycleLabel: `Cycle ${cycleNo} - ${shortFinancialYearLabel(fyStartYear)}`,
        window,
      });
    }
  });
  return cycles;
}

function assignStatuses(cycles, asOfDateKey) {
  const completedCycles = cycles.filter((cycle) => compareDateKeys(cycle.window.endDate, asOfDateKey) < 0);
  const latestCompleted = completedCycles.reduce((latest, cycle) => {
    if (!latest) return cycle;
    return compareDateKeys(cycle.window.endDate, latest.window.endDate) > 0 ? cycle : latest;
  }, null);

  return cycles.map((cycle) => {
    let status = 'FUTURE';
    if (latestCompleted && cycle.cycleId === latestCompleted.cycleId) {
      status = 'DRAFT';
    } else if (latestCompleted && compareDateKeys(cycle.window.endDate, latestCompleted.window.endDate) < 0) {
      status = 'CLOSED';
    }
    return { ...cycle, status };
  });
}

function toFirestoreDoc(cycle, runContext) {
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
  const startDateUtc = dateKeyToUtcDate(cycle.window.startDate, false);
  const endDateUtc = dateKeyToUtcDate(cycle.window.endDate, true);

  return {
    cycleId: cycle.cycleId,
    lmPcode: cycle.lmPcode,

    billingPeriod: cycle.billingPeriod,
    billingPeriodFull: cycle.billingPeriodFull,
    billingPeriodStartYear: cycle.billingPeriodStartYear,
    billingPeriodEndYear: cycle.billingPeriodEndYear,

    cycleNo: cycle.cycleNo,
    cycleNoText: cycle.cycleNoText,
    cycleCode: cycle.cycleCode,
    cycleLabel: cycle.cycleLabel,

    window: {
      start: admin.firestore.Timestamp.fromDate(startDateUtc),
      end: admin.firestore.Timestamp.fromDate(endDateUtc),
      startDate: cycle.window.startDate,
      endDate: cycle.window.endDate,
      display: cycle.window.display,
      pattern: 'MONTHLY_16_TO_15',
    },

    status: cycle.status, // CLOSED | DRAFT | FUTURE

    currentIteration: 0,
    activeStagingId: null,

    lastGenerated: null,

    summary: {
      totalRows: 0,
      rowsWithCurrentReading: 0,
      rowsWithConsumption: 0,
      successfulReads: 0,
      noAccess: 0,
      unsuccessful: 0,
      mediaEvidence: 0,
    },

    closed: {
      closedAt: null,
      closedByUser: null,
    },

    metadata: {
      created: {
        at: serverTimestamp,
        byUid: 'SYSTEM_SCRIPT',
        byUser: SCRIPT_NAME,
      },
      updated: {
        at: serverTimestamp,
        byUid: 'SYSTEM_SCRIPT',
        byUser: SCRIPT_NAME,
      },
      source: {
        scriptName: SCRIPT_NAME,
        scriptVersion: SCRIPT_VERSION,
        setupType: 'MREAD_STAGING_CYCLE_SEED',
        collection: runContext.collectionName,
        asOfDate: runContext.asOfDate,
      },
    },
  };
}

function printPreview(cycles) {
  console.log('\nPreview: MREAD staging cycle controller documents');
  console.log('='.repeat(80));
  console.log('Cycle ID'.padEnd(35), 'Period'.padEnd(8), 'No'.padEnd(4), 'Window'.padEnd(34), 'Status');
  console.log('-'.repeat(80));
  cycles.forEach((cycle) => {
    console.log(
      cycle.cycleId.padEnd(35),
      cycle.billingPeriod.padEnd(8),
      String(cycle.cycleNo).padEnd(4),
      cycle.window.display.padEnd(34),
      cycle.status,
    );
  });
  console.log('-'.repeat(80));
  const statusCounts = cycles.reduce((acc, cycle) => {
    acc[cycle.status] = (acc[cycle.status] || 0) + 1;
    return acc;
  }, {});
  console.log('Status totals:', JSON.stringify(statusCounts));
  console.log('='.repeat(80));
}

function initFirebase(serviceAccountPath) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || serviceAccountPath;
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  return admin.firestore();
}

async function writeCycles(db, cycles, options) {
  let created = 0;
  let skipped = 0;
  let overwritten = 0;

  for (const cycle of cycles) {
    const docRef = db.collection(options.collectionName).doc(cycle.cycleId);
    const snap = await docRef.get();
    const docData = toFirestoreDoc(cycle, options);

    if (snap.exists && !options.force) {
      console.log(`SKIP existing: ${cycle.cycleId}`);
      skipped += 1;
      continue;
    }

    if (snap.exists && options.force) {
      console.log(`OVERWRITE: ${cycle.cycleId}`);
      await docRef.set(docData);
      overwritten += 1;
      continue;
    }

    console.log(`CREATE: ${cycle.cycleId}`);
    await docRef.create(docData);
    created += 1;
  }

  return { created, skipped, overwritten };
}

async function main() {
  const args = parseArgs(process.argv);

  const lmPcode = args.lmPcode;
  if (!lmPcode || typeof lmPcode !== 'string') {
    fail('Missing required --lmPcode, for example --lmPcode ZA2157');
  }

  const fyStartYearsArg = args.fyStartYears || '2025,2026';
  const fyStartYears = fyStartYearsArg.split(',').map((part) => Number(part.trim())).filter(Number.isFinite);
  if (!fyStartYears.length) fail('Invalid --fyStartYears. Example: --fyStartYears 2025,2026');

  const asOfDate = args.asOfDate || new Date().toISOString().slice(0, 10);
  parseDateKey(asOfDate);

  const collectionName = args.collection || DEFAULT_COLLECTION;
  const serviceAccountPath = args.serviceAccount || DEFAULT_SERVICE_ACCOUNT_PATH;
  const confirm = Boolean(args.confirm);
  const force = Boolean(args.force);

  const cycles = assignStatuses(buildAllCyclePreviews(lmPcode, fyStartYears), asOfDate);

  printPreview(cycles);

  console.log('\nRun configuration:');
  console.log(`  lmPcode:             ${lmPcode}`);
  console.log(`  fyStartYears:        ${fyStartYears.join(', ')}`);
  console.log(`  asOfDate:            ${asOfDate}`);
  console.log(`  collection:          ${collectionName}`);
  console.log(`  serviceAccountPath:  ${serviceAccountPath}`);
  console.log(`  confirm:             ${confirm}`);
  console.log(`  force:               ${force}`);

  if (!confirm) {
    console.log('\nDRY RUN ONLY. No Firestore writes were performed.');
    console.log('Add --confirm to write documents.');
    return;
  }

  if (force) {
    console.warn('\nWARNING: --force is enabled. Existing documents may be overwritten.');
  }

  const db = initFirebase(serviceAccountPath);
  const result = await writeCycles(db, cycles, {
    collectionName,
    serviceAccountPath,
    asOfDate,
    force,
  });

  console.log('\nWrite summary:');
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nFAILED');
    console.error(error);
    process.exit(1);
  });
