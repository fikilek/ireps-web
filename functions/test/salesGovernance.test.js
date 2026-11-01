import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validatePublication, validateSnapshot, validateVerificationReport, hasScopeAccess } from "../salesGovernance/artifacts.js";
const sha = value => createHash("sha256").update(value).digest("hex");
const hash = "a".repeat(64);
const scope = ["ZA5241", "contour"];
const publication = () => ({ schemaVersion: 1, lmPcode: scope[0], provider: scope[1], latestMonth: "2026-06", months: { "2026-06": { snapshotSha256: hash, verification: { status: "PASS", complete: true, reportSha256: hash } } } });
test("publication requires complete verified evidence and greatest published month", () => {
  assert.deepEqual(validatePublication(publication(), ...scope), ["2026-06"]);
  for (const mutate of [p => p.months["2026-06"].verification.complete = false, p => p.latestMonth = "2026-07", p => p.months["2026-06"].verification.reportSha256 = "", p => p.lmPcode = "ZA7423"]) {
    const p = publication(); mutate(p); assert.throws(() => validatePublication(p, ...scope));
  }
  const skipped = publication(); skipped.months["2026-08"] = structuredClone(skipped.months["2026-06"]); skipped.latestMonth = "2026-08";
  assert.throws(() => validatePublication(skipped, ...scope));
  const julyBaseline = publication(); julyBaseline.months["2026-07"] = julyBaseline.months["2026-06"]; delete julyBaseline.months["2026-06"]; julyBaseline.latestMonth = "2026-07";
  assert.throws(() => validatePublication(julyBaseline, ...scope));
});
test("snapshot verifies exact bytes, complete canonical membership and previous hash", () => {
  const snapshot = { schemaVersion: 1, lmPcode: scope[0], provider: scope[1], month: "2026-06", sourceSha256: hash, previousSnapshotSha256: null, members: ["001", "002"], replacements: [], exceptions: [], completeness: { complete: true, evidenceSha256: hash } };
  const bytes = Buffer.from(JSON.stringify(snapshot));
  assert.equal(validateSnapshot(bytes, sha(bytes), ...scope, "2026-06", null).members.length, 2);
  assert.throws(() => validateSnapshot(bytes, hash, ...scope, "2026-06", null));
  assert.throws(() => validateSnapshot(bytes, sha(bytes), ...scope, "2026-07", null));
  for (const patch of [{ replacements: [null] }, { replacements: [{ predecessor: "001", successor: "001" }] }, { exceptions: [null] }]) {
    const malformed = Buffer.from(JSON.stringify({ ...snapshot, ...patch }));
    assert.throws(() => validateSnapshot(malformed, sha(malformed), ...scope, "2026-06", null));
  }
  snapshot.members.push("001"); const duplicate = Buffer.from(JSON.stringify(snapshot));
  assert.throws(() => validateSnapshot(duplicate, sha(duplicate), ...scope, "2026-06", null));
});
test("preflight, failed, partial, wrong-project and unbound executions cannot publish", () => {
  const valid = JSON.parse(readFileSync(new URL("./fixtures/sales-governance/report.json", import.meta.url)));
  const snapshotBytes = readFileSync(new URL("./fixtures/sales-governance/snapshot.json", import.meta.url));
  const snapshot = JSON.parse(snapshotBytes);
  const check = report => { const bytes = Buffer.from(JSON.stringify(report)); return validateVerificationReport(bytes, sha(bytes), "ireps2", "2026-06", sha(snapshotBytes), snapshot); };
  assert.equal(check(valid).rowsRead, 2);
  for (const patch of [{ preflightOnly: true }, { projectId: "other" }, { failedCount: 1 }, { rowsRead: 5 }, { sourceEvidence: {} }, { result: "PREFLIGHT_PASS" }]) assert.throws(() => check({ ...valid, ...patch }));
  for (const mutate of [r => r.recordsInspected = 1, r => r.verification.preservedProjectionAfterSha256 = "b".repeat(64), r => r.recoveryEvidence.complete = false, r => r.planEvidence.complete = false, r => r.batchEvidence.writeWavesCommitted = 0, r => r.sourceEvidence.scopeDocumentIds = ["M1"]]) {
    const report = structuredClone(valid); mutate(report); assert.throws(() => check(report));
  }
});
test("scope authorization uses server-side workbase assignments", () => {
  assert.equal(hasScopeAccess({ access: { workbases: [{ id: "ZA5241" }] } }, "ZA5241"), true);
  assert.equal(hasScopeAccess({ access: { workbases: [{ id: "ZA7423" }] } }, "ZA5241"), false);
  assert.equal(hasScopeAccess({}, "ZA5241"), false);
});
