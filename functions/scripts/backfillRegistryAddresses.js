// Environment-specific migration. Defaults to a read-only DEV dry run; --apply requires a
// previously saved plan. Backups include full Firestore field representations.
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { initializeApp, cert, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { ADDRESS_FIELDS, assertRegistryBackfillProject, planRegistryAddressBackfill } from "../maintenance/registryAddressBackfillPlan.js";
import { savedPremiseUnits } from "../registry/savedPremiseUnits.js";

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes("--key") || !args.includes("--output")) throw new Error("Required: --key <matching project credential> --output <evidence directory> [--project ireps2|ireps-test|ireps-5c3e9]");
const key = JSON.parse(fs.readFileSync(option("--key"), "utf8"));
const project = assertRegistryBackfillProject(args.includes("--project") ? option("--project") : "ireps2", key.project_id);
const output = path.resolve(option("--output"));
fs.mkdirSync(output, { recursive: true });
const app = initializeApp({ projectId: project, credential: cert(key) });
const db = getFirestore(app);
db.settings({ preferRest: true });
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2));
const stamp = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
const backup = snap => ({ path: snap.ref.path, updateTime: snap.updateTime, fields: snap._fieldsProto, data: snap.data() });
const strip = data => {
  const copy = structuredClone(data);
  for (const field of ADDRESS_FIELDS) delete copy.accessData?.premise?.[field];
  return copy;
};
try {
  if (!args.includes("--apply")) {
    const [trns, asts, premises, registry] = await Promise.all(["trns", "asts", "premises", "registry_meters"].map(name => db.collection(name).get()));
    const byId = new Map(premises.docs.map(snap => [snap.id, snap]));
    const registryById = new Map(registry.docs.map(snap => [snap.id, snap]));
    const records = [];
    const backups = new Map();
    for (const snap of [...trns.docs, ...asts.docs]) {
      const data = snap.data();
      if (snap.ref.parent.id === "asts" && !["electricity", "water"].includes(String(data.meterType).toLowerCase())) continue;
      const source = byId.get(data.accessData?.premise?.id);
      const proposed = planRegistryAddressBackfill(data, source?.data());
      const row = snap.ref.parent.id === "asts" ? registryById.get(snap.id) : null;
      const registryPatch = row && proposed.values ? { ...savedPremiseUnits(proposed.values), premiseAddress: proposed.values.address, premisePropertyType: proposed.values.propertyType } : null;
      const registryNeedsUpdate = registryPatch && Object.entries(registryPatch).some(([k,v]) => row.data()[k] !== v);
      const plan = { path: snap.ref.path, updateTime: stamp(snap), sourcePath: source?.ref.path ?? null, sourceUpdateTime: source ? stamp(source) : null,
        ...proposed, registryPath: row?.ref.path ?? null, registryUpdateTime: row ? stamp(row) : null, registryPatch, registryNeedsUpdate: Boolean(registryNeedsUpdate),
        registryMissing: snap.ref.parent.id === "asts" && !row,
      };
      if (plan.status === "UNCHANGED" && registryNeedsUpdate) plan.status = "UPDATE";
      records.push(plan);
      if (plan.status === "UPDATE") for (const item of [snap, source, row].filter(Boolean)) backups.set(item.ref.path, backup(item));
    }
    const summary = { project, mode: "dry-run", at: new Date().toISOString(), counts: {} };
    for (const record of records) {
      const group = `${record.path.split('/')[0]}_${record.status}`;
      summary.counts[group] = (summary.counts[group] || 0) + 1;
    }
    write("before-images.json", [...backups.values()]);
    write("plan.json", { ...summary, records });
    write("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const plan = JSON.parse(fs.readFileSync(path.join(output, "plan.json"), "utf8"));
    const backups = new Map(JSON.parse(fs.readFileSync(path.join(output, "before-images.json"), "utf8")).map(item => [item.path, item]));
    if (plan.project !== project) throw new Error("Plan project mismatch");
    if (fs.existsSync(path.join(output, "applied.jsonl"))) throw new Error("Apply already started; inspect its journal and create a fresh dry run before retrying");
    const candidates = plan.records.filter(record => record.status === "UPDATE");
    if (candidates.some(record => !backups.has(record.path) || !backups.has(record.sourcePath))) throw new Error("Incomplete backup");
    const results = [];
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < candidates.length) {
        const item = candidates[next++];
        let result;
        try {
          result = await db.runTransaction(async tx => {
            const refs = [db.doc(item.path), db.doc(item.sourcePath)];
            if (item.registryPath) refs.push(db.doc(item.registryPath));
            const [target, source, registry] = await tx.getAll(...refs);
            if (!target.exists || !source.exists || stamp(target) !== item.updateTime || stamp(source) !== item.sourceUpdateTime)
              return { path: item.path, status: "SKIPPED_CONCURRENT_CHANGE" };
            const fresh = planRegistryAddressBackfill(target.data(), source.data());
            if (fresh.status === "HOLD" || !isDeepStrictEqual(fresh.patch, item.patch))
              return { path: item.path, status: "SKIPPED_PLAN_CHANGED" };
            if (item.registryPath && (!registry?.exists || stamp(registry) !== item.registryUpdateTime || registry.data().premiseId !== target.data().accessData.premise.id))
              return { path: item.path, status: "SKIPPED_REGISTRY_LINK" };
            if (Object.keys(item.patch).length) tx.update(target.ref, item.patch);
            if (item.registryNeedsUpdate) tx.update(registry.ref, item.registryPatch);
            return { path: item.path, status: "APPLIED" };
          });
        } catch (error) { result = { path: item.path, status: "FAILED", error: error.message }; }
        results.push(result);
        fs.appendFileSync(path.join(output, "applied.jsonl"), JSON.stringify(result) + "\n");
      }
    }));
    const verification = [];
    for (const result of results.filter(item => item.status === "APPLIED")) {
      const item = candidates.find(item => item.path === result.path);
      const after = await db.doc(item.path).get();
      const values = after.data()?.accessData?.premise;
      const fieldsMatch = ADDRESS_FIELDS.every(field => values?.[field] === item.values[field]);
      // JSON round-trip compares Firestore values to their saved backup form.
      const unrelatedUnchanged = isDeepStrictEqual(strip(JSON.parse(JSON.stringify(after.data()))), strip(backups.get(item.path).data));
      let registryMatches = true;
      if (item.registryPath) {
        const row = await db.doc(item.registryPath).get();
        registryMatches = Object.entries(item.registryPatch).every(([k,v]) => row.data()?.[k] === v);
      }
      verification.push({ path: item.path, fieldsMatch, unrelatedUnchanged, registryMatches });
    }
    const summary = { project, mode: "apply", at: new Date().toISOString(), counts: {}, verified: verification.length,
      verificationFailures: verification.filter(row => !row.fieldsMatch || !row.unrelatedUnchanged || !row.registryMatches) };
    for (const result of results) summary.counts[result.status] = (summary.counts[result.status] || 0) + 1;
    write("verification.json", verification);
    write("apply-summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.counts.FAILED || summary.verificationFailures.length) process.exitCode = 1;
  }
} finally { await deleteApp(app); }
