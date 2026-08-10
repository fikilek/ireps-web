import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import admin from "firebase-admin";
import {
  validateExistingMeterMaster,
  METER_MASTER_CLASSIFICATIONS,
} from "../../../meterMaster/helpers.js";
import {
  PROJECT_ID,
  LM_PCODE,
  exactUpdateTime,
  updateTimeEqual,
  stable,
} from "./endumeniReset.helpers.js";

const APPLY_TOKEN = "REPAIR_ENDUMENI_METER_MASTER";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const DEFAULT_INVENTORY = path.join(
  ROOT,
  "docs",
  "reports",
  "endumeni-nuclear-reset",
  "ENDUMENI_INVENTORY_20260809T003353349Z",
  "inventory.json",
);
const CANONICAL_ROOT = [
  "accountNo", "customerNo", "lmPcode", "metadata", "meterNo", "meterType", "refs",
].sort();

const mode = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).reduce((rows, item, index, all) =>
  item.startsWith("--") ? [...rows, [item.slice(2), all[index + 1]?.startsWith("--") ? true : all[index + 1]]] : rows, []));
const serviceAccount = args["service-account"] || process.env.IREPS_DEV_SERVICE_ACCOUNT ||
  "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json";
const inventoryPath = path.resolve(args.inventory || DEFAULT_INVENTORY);
const onlyMeter = args.meter ? String(args.meter).trim() : null;

function assertCli() {
  if (!["dry-run", "apply"].includes(mode)) {
    throw new Error("Usage: repair-reset-corrupted-meter-master-dev.js <dry-run|apply> --project-id ireps2 [--meter ID] [--confirm REPAIR_ENDUMENI_METER_MASTER]");
  }
  if (args["project-id"] !== PROJECT_ID) throw new Error("--project-id ireps2 is required");
  if (mode === "apply" && args.confirm !== APPLY_TOKEN) throw new Error(`CONFIRMATION_REQUIRED:${APPLY_TOKEN}`);
  if (!fs.existsSync(serviceAccount)) throw new Error("SERVICE_ACCOUNT_NOT_FOUND");
  if (!fs.existsSync(inventoryPath)) throw new Error("PRE_RESET_INVENTORY_NOT_FOUND");
}

function loadInventory() {
  const manifest = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  if (manifest.projectId !== PROJECT_ID || manifest.lmPcode !== LM_PCODE ||
      manifest.mode !== "READ_ONLY" || manifest.status !== "PASSED") {
    throw new Error("INVALID_PRE_RESET_INVENTORY");
  }
  const targetPath = path.resolve(manifest.files?.targets?.path || "");
  const approvedRoot = path.resolve(ROOT, "docs", "reports", "endumeni-nuclear-reset");
  const relative = path.relative(approvedRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(targetPath)) {
    throw new Error("PRE_RESET_TARGETS_OUTSIDE_APPROVED_ROOT");
  }
  const targets = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  return {manifest, targetPath, targets};
}

function hydrate(value) {
  if (Array.isArray(value)) return value.map(hydrate);
  if (!value || typeof value !== "object") return value;
  if (value.__type__ === "timestamp") {
    return new admin.firestore.Timestamp(Number(value.seconds), value.nanoseconds);
  }
  if (value.__type__ === "reference") throw new Error("UNSUPPORTED_REFERENCE_IN_METER_MASTER");
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrate(item)]));
}

function resetCorruptedStable(value) {
  if (Array.isArray(value)) return value.map(resetCorruptedStable);
  if (!value || typeof value !== "object") return value;
  if (value.__type__ === "timestamp") {
    return {_nanoseconds: value.nanoseconds, _seconds: Number(value.seconds)};
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "__type__")
    .map(([key, item]) => [key, resetCorruptedStable(item)]));
}

function expectedResetMutation(pre) {
  const next = resetCorruptedStable(pre);
  if (next.refs?.asts) delete next.refs.asts.id;
  next.visibility = "INVISIBLE";
  return next;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function validationFor(id, data) {
  return validateExistingMeterMaster({
    masterId: id,
    existing: data,
    incomingLmPcode: data?.lmPcode,
    incomingMeterType: data?.meterType,
    sourceWriter: "repair-reset-corrupted-meter-master-dev",
  });
}

function shape(data) {
  const valueType = (value) => {
    if (value instanceof admin.firestore.Timestamp) return "timestamp";
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    return typeof value === "object" ? "map" : typeof value;
  };
  return {
    rootFields: Object.keys(data || {}).sort(),
    meterNoFields: Object.keys(data?.meterNo || {}).sort(),
    refsFields: Object.keys(data?.refs || {}).sort(),
    refsAstsFields: Object.keys(data?.refs?.asts || {}).sort(),
    refsSalesFields: Object.keys(data?.refs?.sales || {}).sort(),
    metadataFields: Object.keys(data?.metadata || {}).sort(),
    createdAtType: valueType(data?.metadata?.createdAt),
    updatedAtType: valueType(data?.metadata?.updatedAt),
  };
}

function changedPaths(left, right, prefix = "", rows = []) {
  if (same(left, right)) return rows;
  const objects = left && right && typeof left === "object" && typeof right === "object" &&
    !Array.isArray(left) && !Array.isArray(right) &&
    !(left instanceof admin.firestore.Timestamp) && !(right instanceof admin.firestore.Timestamp);
  if (!objects) { rows.push(prefix || "document"); return rows; }
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    changedPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key, rows);
  }
  return rows;
}

async function assess(db, loaded) {
  let query = db.collection("meter_master").where("lmPcode", "==", LM_PCODE);
  if (onlyMeter) query = query.where(admin.firestore.FieldPath.documentId(), "==", onlyMeter);
  const snap = await query.get();
  const preRows = new Map((loaded.targets.meter_master || []).map((row) => [row.id, row]));
  const results = [];
  for (const doc of snap.docs) {
    const current = doc.data();
    const row = preRows.get(doc.id);
    if (!row) {
      results.push({id: doc.id, classification: "OTHER_DIFFERENCE_BLOCKED", reason: "PRE_RESET_SNAPSHOT_MISSING"});
      continue;
    }
    const pre = hydrate(row.data);
    const preValidation = validationFor(doc.id, pre);
    if (preValidation.classification === METER_MASTER_CLASSIFICATIONS.CONFLICT) {
      results.push({id: doc.id, classification: "OTHER_DIFFERENCE_BLOCKED", reason: "PRE_RESET_NOT_CANONICAL", preValidation});
      continue;
    }
    if (same(current, pre)) {
      results.push({id: doc.id, classification: "UNCHANGED_CANONICAL", row, current, pre, updateTime: exactUpdateTime(doc.updateTime)});
      continue;
    }
    if (same(current, expectedResetMutation(row.data))) {
      results.push({id: doc.id, classification: "RESET_CORRUPTED", row, current, pre, updateTime: exactUpdateTime(doc.updateTime)});
      continue;
    }
    results.push({
      id: doc.id,
      classification: "OTHER_DIFFERENCE_BLOCKED",
      reason: "CURRENT_STATE_NOT_EXACT_RESET_MUTATION",
      differencePaths: changedPaths(current, pre),
    });
  }
  if (onlyMeter && snap.empty) {
    results.push({id: onlyMeter, classification: "OTHER_DIFFERENCE_BLOCKED", reason: "CURRENT_DOCUMENT_NOT_FOUND_IN_ZA5241_QUERY"});
  }
  return {total: snap.size, results};
}

function summary(assessment) {
  const count = (name) => assessment.results.filter((row) => row.classification === name).length;
  return {
    totalZa5241MeterMasters: assessment.total,
    unchangedCanonical: count("UNCHANGED_CANONICAL"),
    resetCorrupted: count("RESET_CORRUPTED"),
    otherDifferencesBlocked: count("OTHER_DIFFERENCE_BLOCKED"),
  };
}

async function restoreOne(db, candidate) {
  const ref = db.collection("meter_master").doc(candidate.id);
  await db.runTransaction(async (transaction) => {
    const live = await transaction.get(ref);
    if (!live.exists || !updateTimeEqual(candidate.updateTime, exactUpdateTime(live.updateTime))) {
      throw new Error(`STALE_CHANGED:${ref.path}`);
    }
    if (!same(live.data(), expectedResetMutation(candidate.row.data))) {
      throw new Error(`CURRENT_STATE_NO_LONGER_EXACT_RESET_MUTATION:${ref.path}`);
    }
    transaction.set(ref, candidate.pre);
  });
}

async function verifyOne(db, id) {
  const snap = await db.collection("meter_master").doc(id).get();
  if (!snap.exists) return {pass: false, reason: "MISSING"};
  const data = snap.data();
  const validation = validationFor(id, data);
  return {
    pass: JSON.stringify(Object.keys(data).sort()) === JSON.stringify(CANONICAL_ROOT) &&
      typeof data?.refs?.asts?.id === "string" &&
      data?.metadata?.createdAt instanceof admin.firestore.Timestamp &&
      data?.metadata?.updatedAt instanceof admin.firestore.Timestamp &&
      validation.classification !== METER_MASTER_CLASSIFICATIONS.CONFLICT,
    shape: shape(data),
    validation: validation.classification === METER_MASTER_CLASSIFICATIONS.CONFLICT ? validation.conflict : "PASS",
  };
}

async function runWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const runners = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function verifyAll(db) {
  const snap = await db.collection("meter_master").where("lmPcode", "==", LM_PCODE).get();
  let canonical = 0;
  let noncanonical = 0;
  for (const doc of snap.docs) {
    const result = validationFor(doc.id, doc.data());
    if (result.classification === METER_MASTER_CLASSIFICATIONS.CONFLICT) noncanonical += 1;
    else canonical += 1;
  }
  return {totalZa5241: snap.size, canonicalAfterRepair: canonical, noncanonicalAfterRepair: noncanonical};
}

async function main() {
  assertCli();
  const loaded = loadInventory();
  const credential = JSON.parse(fs.readFileSync(serviceAccount, "utf8"));
  if (credential.project_id !== PROJECT_ID) throw new Error("WRONG_SERVICE_ACCOUNT_PROJECT");
  const app = admin.initializeApp({credential: admin.credential.cert(credential), projectId: PROJECT_ID}, `meter-master-repair-${Date.now()}`);
  try {
    const db = admin.firestore(app);
    const assessment = await assess(db, loaded);
    const report = {
      mode,
      projectId: PROJECT_ID,
      lmPcode: LM_PCODE,
      inventoryPath,
      targetPath: loaded.targetPath,
      ...summary(assessment),
    };
    if (onlyMeter) {
      const candidate = assessment.results.find((row) => row.id === onlyMeter);
      report.meter = onlyMeter;
      report.classification = candidate?.classification || "OTHER_DIFFERENCE_BLOCKED";
      if (candidate?.current && candidate?.pre) {
        report.currentShape = shape(candidate.current);
        report.preResetShape = shape(candidate.pre);
        report.fieldsToRestore = changedPaths(candidate.current, candidate.pre);
        report.preResetCanonicalValidation = validationFor(onlyMeter, candidate.pre).classification ===
          METER_MASTER_CLASSIFICATIONS.CONFLICT ? "FAIL" : "PASS";
      }
      if (mode === "apply") {
        if (candidate?.classification !== "RESET_CORRUPTED") throw new Error("METER_NOT_SAFE_REPAIR_CANDIDATE");
        await restoreOne(db, candidate);
        report.repair = "APPLIED";
        report.postRepairVerification = await verifyOne(db, onlyMeter);
        if (!report.postRepairVerification.pass) throw new Error("POST_REPAIR_VERIFICATION_FAILED");
      }
    } else if (mode === "apply") {
      const candidates = assessment.results.filter((row) => row.classification === "RESET_CORRUPTED");
      const preBlocked = assessment.results.filter((row) => row.classification === "OTHER_DIFFERENCE_BLOCKED").length;
      let repaired = 0;
      let blocked = preBlocked;
      let failed = 0;
      let processed = 0;
      const waveSize = 400;
      for (let start = 0; start < candidates.length; start += waveSize) {
        const wave = candidates.slice(start, start + waveSize);
        await runWithConcurrency(wave, 10, async (candidate) => {
          try {
            await restoreOne(db, candidate);
            repaired += 1;
          } catch (error) {
            if (String(error?.message || error).includes("STALE_CHANGED") ||
                String(error?.message || error).includes("NO_LONGER_EXACT_RESET_MUTATION")) blocked += 1;
            else failed += 1;
          }
        });
        processed += wave.length;
        console.log(`[${processed}/${candidates.length}] repaired=${repaired} blocked=${blocked} failed=${failed}`);
      }
      report.target = assessment.total - 1;
      report.repairedThisRun = repaired;
      report.blocked = blocked;
      report.failed = failed;
      Object.assign(report, await verifyAll(db));
      report.repaired = report.canonicalAfterRepair - 1;
      if (blocked || failed || report.noncanonicalAfterRepair) process.exitCode = 1;
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.delete();
  }
}

main().catch((error) => {
  console.error("METER MASTER REPAIR FAILED", error.message);
  process.exitCode = 1;
});
