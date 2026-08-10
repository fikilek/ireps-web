import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RESET_SCHEMA_VERSION, RESET_POLICY, CONFIRM_TOKEN, classifySalesTbTrn,
  premiseCorrelation, correlationState, cleanPremiseIds, parseStorageObject,
  validateEvidenceReferences, evidenceObjectState, detectDuplicates,
  markSharedStorage, serializeFirestoreValue, stableStringify, sha256Text,
  sortByKeys, expectedErfCounts, inventoryPathWithinRoot,
  assertExpectedUpdateTime, uniqueSorted, cleanDemoSales, validatePreflight,
  exactUpdateTime, parseExactUpdateTime, exactUpdateTimesEqual, makeLastUpdateTime,
  writeImmutableJson, replaceLatestPointer, proveCanonicalCorrelation,
  assessStorageLiveState, assessSalesCollection,
} from "../scripts/tools/targeted-batches/targetedBatchReset.helpers.js";

const canonical = {id: "TRN_MDIS_1", sourceModule: "SALES_TARGETED_BATCH", meterType: "NA", accessData: {trnType: "METER_DISCOVERY", access: {hasAccess: "no"}, erfId: "ERF"}, targetedBatchContext: {tbId: "TB", rowId: "ROW", salesDocId: "SALE", erfId: "ERF"}};
const classification = (data = canonical, id = data.id) => classifySalesTbTrn({id, data}).classification;
const evidenceUrl = (trnId = canonical.id, bucket = "ireps2.appspot.com", objectPath = `meters/no_access/${trnId}_noAccessPhoto.jpg`) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;

test("canonical Sales TB NA requires the complete exact shape", () => assert.equal(classification(), "CANONICAL_SALES_TB_NA"));
test("successful Sales TB Meter Discovery is explicitly preserved", () => {
  const result = classifySalesTbTrn({id: canonical.id, data: {...canonical, meterType: "PREPAID", accessData: {...canonical.accessData, access: {hasAccess: "yes"}}}});
  assert.equal(result.classification, "NON_TARGET"); assert.equal(result.preservedReason, "SUCCESSFUL_SALES_TB_METER_DISCOVERY");
});
test("malformed Sales TB records block", () => assert.equal(classification({...canonical, targetedBatchContext: {tbId: "TB"}}), "AMBIGUOUS_SALES_TB_RECORD"));
test("contradictory Sales TB access and meter signals block", () => {
  assert.equal(classification({...canonical, meterType: "PREPAID"}), "AMBIGUOUS_SALES_TB_RECORD");
  assert.equal(classification({...canonical, accessData: {...canonical.accessData, access: {hasAccess: "yes"}}}), "AMBIGUOUS_SALES_TB_RECORD");
});
test("root identity and conflicting ERF identities block", () => {
  assert.equal(classification({...canonical, id: "OTHER"}, canonical.id), "AMBIGUOUS_SALES_TB_RECORD");
  assert.equal(classification({...canonical, accessData: {...canonical.accessData, erfId: "OTHER"}}), "AMBIGUOUS_SALES_TB_RECORD");
});
test("ordinary non-Sales and BGO TRNs are preserved", () => {
  assert.equal(classification({id: "ORDINARY", accessData: {access: {hasAccess: "no"}}}), "NON_TARGET");
  assert.equal(classification({...canonical, sourceModule: "BGO", targetedBatchContext: undefined}), "NON_TARGET");
});

test("pre-premise No Access is valid and creates no premise manifest row", () => assert.deepEqual(premiseCorrelation({premiseId: null}), {valid: true, classification: "VALID_PRE_PREMISE_NO_ACCESS", includeManifest: false}));
test("an existing authoritative premise is included", () => assert.deepEqual(premiseCorrelation({premiseId: "PREMISE", premiseExists: true}), {valid: true, classification: "REFERENCED_PREMISE", includeManifest: true}));
test("a missing authoritative premise blocks precisely", () => assert.deepEqual(premiseCorrelation({premiseId: "PREMISE", premiseExists: false}), {valid: false, classification: "MISSING_REFERENCED_PREMISE", includeManifest: false}));
test("correlation does not require an absent premise", () => {
  assert.deepEqual(correlationState({tb: true, row: true, sales: true, premiseRequired: false, registryErf: true}), ["FULLY_CORRELATED"]);
  assert.ok(correlationState({tb: true, row: true, sales: true, premiseRequired: true, premise: false, registryErf: true}).includes("MISSING_REFERENCED_PREMISE"));
});

test("premise cleanup is exact, order preserving and idempotent", () => {
  const first = cleanPremiseIds(["ordinary", "target", "new-unrelated", "bgo"], ["target"]);
  assert.equal(first.safe, true); assert.deepEqual(first.remaining, ["ordinary", "new-unrelated", "bgo"]);
  assert.deepEqual(cleanPremiseIds(first.remaining, ["target"]).remaining, first.remaining);
  assert.equal(cleanPremiseIds(["target", "target"], ["target"]).safe, false);
  assert.equal(cleanPremiseIds(["ok", null], ["target"]).safe, false);
});

test("exact valid No Access evidence is accepted", () => {
  const result = validateEvidenceReferences([{tag: "noAccessPhoto", url: evidenceUrl()}], canonical.id);
  assert.equal(result.valid, true); assert.equal(result.references[0].bucket, "ireps2.appspot.com"); assert.equal(result.references[0].objectPath, `meters/no_access/${canonical.id}_noAccessPhoto.jpg`);
});
test("missing No Access evidence blocks", () => assert.equal(validateEvidenceReferences([], canonical.id).reason, "MISSING_NO_ACCESS_EVIDENCE"));
test("multiple No Access evidence entries block", () => assert.equal(validateEvidenceReferences([{tag: "noAccessPhoto", url: evidenceUrl()}, {tag: "noAccessPhoto", url: evidenceUrl()}], canonical.id).reason, "MULTIPLE_NO_ACCESS_EVIDENCE"));
test("malformed evidence URL blocks", () => assert.equal(validateEvidenceReferences([{tag: "noAccessPhoto", url: "not-a-url"}], canonical.id).reason, "UNRESOLVED_STORAGE_PATH"));
test("unexpected evidence bucket blocks", () => assert.equal(validateEvidenceReferences([{tag: "noAccessPhoto", url: evidenceUrl(canonical.id, "wrong.appspot.com")}], canonical.id).reason, "UNEXPECTED_BUCKET"));
test("evidence outside the exact prefix blocks", () => assert.equal(validateEvidenceReferences([{tag: "noAccessPhoto", url: evidenceUrl(canonical.id, "ireps2.appspot.com", `meters/other/${canonical.id}_noAccessPhoto.jpg`)}], canonical.id).reason, "OUTSIDE_APPROVED_PREFIX"));
test("wildcard and folder evidence paths block", () => {
  assert.equal(parseStorageObject({uri: "gs://ireps2.appspot.com/meters/no_access/*.jpg"}).reason, "WILDCARD_PATH");
  assert.equal(parseStorageObject({uri: "gs://ireps2.appspot.com/meters/no_access/"}).reason, "FOLDER_PATH");
});
test("an unexpected exact object name blocks", () => assert.equal(validateEvidenceReferences([{tag: "noAccessPhoto", url: evidenceUrl(canonical.id, "ireps2.appspot.com", "meters/no_access/other.jpg")}], canonical.id).reason, "UNEXPECTED_EVIDENCE_OBJECT_PATH"));
test("existing evidence captures generation and metageneration", () => {
  const state = evidenceObjectState({bucket: "ireps2.appspot.com", objectPath: "meters/no_access/a.jpg"}, {generation: "12", metageneration: "3"});
  assert.deepEqual({state: state.state, generation: state.generation, metageneration: state.metageneration, deletionEligible: state.deletionEligible}, {state: "EXISTS", generation: "12", metageneration: "3", deletionEligible: true});
});
test("exact Storage 404 is recorded as already missing and eligible", () => {
  const state = evidenceObjectState({bucket: "ireps2.appspot.com", objectPath: "meters/no_access/a.jpg"}, null, {code: 404});
  assert.equal(state.state, "ALREADY_MISSING"); assert.equal(state.deletionEligible, true); assert.equal(state.exists, false);
});
test("non-404 Storage metadata failure blocks", () => assert.equal(evidenceObjectState({}, null, {code: 403}).deletionEligible, false));
test("shared target evidence blocks", () => {
  const item = {bucket: "ireps2.appspot.com", objectPath: "meters/no_access/a.jpg", deletionEligible: true};
  assert.ok(markSharedStorage([item, item]).every((entry) => entry.shared && !entry.deletionEligible));
});
test("evidence referenced by a non-target TRN blocks", () => {
  const item = {bucket: "ireps2.appspot.com", objectPath: "meters/no_access/a.jpg", deletionEligible: true};
  assert.equal(markSharedStorage([item], new Set([`${item.bucket}/${item.objectPath}`]))[0].deletionEligible, false);
});

test("deterministic primitives, null, arrays and nested objects retain data", () => {
  const value = {z: null, a: [true, 2, "x", {b: 2, a: 1}]};
  assert.equal(stableStringify(value), stableStringify({a: [true, 2, "x", {a: 1, b: 2}], z: null}));
  assert.equal(sha256Text(stableStringify(value)), sha256Text(stableStringify({a: [true, 2, "x", {a: 1, b: 2}], z: null})));
});
test("JavaScript Date serialization is tagged ISO-8601", () => assert.deepEqual(serializeFirestoreValue(new Date("2026-01-02T03:04:05.000Z")), {__type__: "Date", iso: "2026-01-02T03:04:05.000Z"}));
test("Firestore Timestamp serialization is tagged and stable", () => {
  const timestamp = {seconds: 5, nanoseconds: 7, toDate: () => new Date("1970-01-01T00:00:05.000Z")};
  assert.deepEqual(serializeFirestoreValue(timestamp), {__type__: "Timestamp", iso: "1970-01-01T00:00:05.000Z", seconds: "5", nanoseconds: 7});
});
test("Firestore GeoPoint serialization is tagged", () => {
  class GeoPoint { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } }
  assert.deepEqual(serializeFirestoreValue(new GeoPoint(-26.2, 28.04)), {__type__: "GeoPoint", latitude: -26.2, longitude: 28.04});
});
test("Buffer and Uint8Array serialization use lossless base64", () => {
  assert.deepEqual(serializeFirestoreValue(Buffer.from([0, 1, 255])), {__type__: "Bytes", base64: "AAH/"});
  assert.deepEqual(serializeFirestoreValue(new Uint8Array([0, 1, 255])), {__type__: "Bytes", base64: "AAH/"});
});
test("Firestore Bytes serialization is tagged", () => assert.deepEqual(serializeFirestoreValue({toUint8Array: () => new Uint8Array([1, 2])}), {__type__: "Bytes", base64: "AQI="}));
test("DocumentReference serialization records only its exact path", () => {
  class DocumentReference { constructor(referencePath) { this.path = referencePath; } }
  assert.deepEqual(serializeFirestoreValue(new DocumentReference("trns/TRN")), {__type__: "DocumentReference", path: "trns/TRN"});
});
test("unsupported SDK-like objects fail rather than leak", () => assert.throws(() => serializeFirestoreValue(new Map([["a", 1]])), /Unsupported Firestore value/));

const approvedRoot = "C:\\dev\\ireps-web\\docs\\reports\\targeted-batch-reset\\generated";
test("timestamped inventory beneath the approved Windows root is accepted", () => assert.equal(inventoryPathWithinRoot(`${approvedRoot}\\RUN_1\\inventory.json`, approvedRoot).valid, true));
for (const [name, candidate] of [
  ["relative", "RUN_1\\inventory.json"],
  ["parent traversal", `${approvedRoot}\\..\\outside\\inventory.json`],
  ["sibling", "C:\\dev\\ireps-web\\docs\\reports\\targeted-batch-reset\\other\\inventory.json"],
  ["misleading prefix", "C:\\dev\\ireps-web\\docs\\reports\\targeted-batch-reset\\generated-old\\RUN\\inventory.json"],
  ["wrong filename", `${approvedRoot}\\RUN_1\\other.json`],
]) test(`inventory path rejects ${name}`, () => assert.equal(inventoryPathWithinRoot(candidate, approvedRoot).valid, false));
test("resolved symlink or junction escape is rejected", () => assert.equal(inventoryPathWithinRoot(`${approvedRoot}\\LINK\\inventory.json`, approvedRoot, {root: approvedRoot, candidate: "C:\\outside\\inventory.json"}).reason, "INVENTORY_REALPATH_ESCAPE"));

test("stale write snapshot reports exact document", () => assert.throws(() => assertExpectedUpdateTime({collection: "trns", id: "TRN", expected: exactUpdateTime({seconds: 1, nanoseconds: 1}), actual: exactUpdateTime({seconds: 1, nanoseconds: 2})}), /STALE_UPDATE_TIME trns\/TRN/));
test("unchanged write snapshot is accepted", () => { const time = exactUpdateTime({seconds: 1, nanoseconds: 1}); assert.equal(assertExpectedUpdateTime({collection: "tb_rows", id: "ROW", expected: time, actual: time}), true); });
test("missing guarded document fails closed", () => assert.throws(() => assertExpectedUpdateTime({collection: "tb_uploads", id: "TB", expected: "time", actual: null, exists: false}), /MISSING_GUARDED_DOCUMENT/));

test("duplicate detection and sorting are deterministic", () => {
  assert.deepEqual(detectDuplicates([{id: "b"}, {id: "a"}, {id: "b"}], (item) => item.id), ["b"]);
  assert.deepEqual(sortByKeys([{id: "b"}, {id: "a"}], ["id"]).map((item) => item.id), ["a", "b"]);
});
test("demo Sales cleanup removes only root tbRefs", () => {
  const source = {tbRefs: [{id: "TB"}], geofenceRefs: [{id: "G"}], nested: {tbRefs: true}, other: 1}; const result = cleanDemoSales(source);
  assert.equal(Object.hasOwn(result, "tbRefs"), false); assert.deepEqual(result.geofenceRefs, source.geofenceRefs); assert.deepEqual(result.nested, source.nested); assert.equal(result.other, 1);
});
test("registry ERF counts exclude only exact target TRNs", () => {
  const trns = [{id: "target", accessData: {access: {hasAccess: "no"}}}, {id: "ordinary", accessData: {access: {hasAccess: "no"}}}, {id: "yes", accessData: {access: {hasAccess: "yes"}}}];
  assert.deepEqual(expectedErfCounts(trns, ["target"]), {trnsNa: 1, trnsAccess: 1, trnsTotal: 2}); assert.deepEqual(uniqueSorted(["b", "a", "b"]), ["a", "b"]);
});

const validPreflight = {projectId: "ireps2", serviceAccountProject: "ireps2", confirmToken: CONFIRM_TOKEN, inventory: {schemaVersion: RESET_SCHEMA_VERSION, status: "PASSED", resetPolicy: RESET_POLICY}, hashesMatch: true, countsMatch: true, updateTimesMatch: true, ambiguousTrns: 0, ambiguousStorage: 0};
test("preflight accepts only the exact approved state and confirmation", () => assert.equal(validatePreflight(validPreflight).passed, true));
for (const [name, patch, error] of [["wrong project", {projectId: "prod"}, "WRONG_PROJECT"], ["wrong credential", {serviceAccountProject: "prod"}, "WRONG_SERVICE_ACCOUNT_PROJECT"], ["old schema", {inventory: {...validPreflight.inventory, schemaVersion: "1.1.0"}}, "OLD_SCHEMA_VERSION"], ["blocked inventory", {inventory: {...validPreflight.inventory, status: "BLOCKED_AMBIGUOUS_SCOPE"}}, "INVENTORY_NOT_PASSED"], ["hash mismatch", {hashesMatch: false}, "HASH_MISMATCH"], ["update mismatch", {updateTimesMatch: false}, "UPDATE_TIME_MISMATCH"], ["count mismatch", {countsMatch: false}, "COUNT_MISMATCH"], ["ambiguous TRN", {ambiguousTrns: 1}, "AMBIGUOUS_TRN"], ["ambiguous Storage", {ambiguousStorage: 1}, "AMBIGUOUS_STORAGE"], ["old confirmation", {confirmToken: "RESET_TARGETED_BATCH_SCOPE_DEV"}, "WRONG_CONFIRMATION_TOKEN"]]) test(`preflight blocks ${name}`, () => assert.ok(validatePreflight({...validPreflight, ...patch}).errors.includes(error)));

test("apply uses exact manifests, write preconditions, and no active ireps_erfs operation", () => {
  const source = fs.readFileSync(new URL("../scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /collection\(["']ireps_erfs["']\)/); assert.doesNotMatch(source, /deleteFiles|deleteFilesByPrefix|batchDeleteCollection/);
  assert.match(source, /makeLastUpdateTime/); assert.doesNotMatch(source, /Timestamp\.fromDate|updateTime.*toDate/); assert.match(source, /inventory\.exports\.tb_rows\.path/); assert.match(source, /inventory\.exports\.tb_uploads\.path/); assert.match(source, /readJsonl\(inventory\.manifests\.salesTbNaTrns\.path\)/);
  const demoSalesStart = source.indexOf('console.log("[DEMO_SALES] START")'); const demoSalesEnd = source.indexOf('phases.push({phase: "DEMO_SALES"', demoSalesStart); const demoSalesBlock = source.slice(demoSalesStart, demoSalesEnd);
  assert.ok(demoSalesStart >= 0 && demoSalesEnd > demoSalesStart); assert.doesNotMatch(demoSalesBlock, /guardedWrite|expectedUpdateTime|lastUpdateTime/); assert.match(demoSalesBlock, /snap\.ref\.update\(\{tbRefs: admin\.firestore\.FieldValue\.delete\(\)\}\)/);
});
test("Step 1 contains no active ireps_erfs operation", () => {
  const source = fs.readFileSync(new URL("../scripts/tools/targeted-batches/01_read_targeted_batch_reset_scope_dev.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /collection\(["']ireps_erfs["']\)/); assert.doesNotMatch(source, /COUNT_COLLECTIONS[^\n]*ireps_erfs/);
});

test("exact updateTime preserves zero and non-zero nanoseconds", () => {
  assert.deepEqual(exactUpdateTime({seconds: 7, nanoseconds: 0}), {__firestoreUpdateTime__: {seconds: "7", nanoseconds: 0}});
  assert.deepEqual(parseExactUpdateTime(exactUpdateTime({_seconds: 7, _nanoseconds: 123456789})), {seconds: "7", nanoseconds: 123456789});
  assert.equal(exactUpdateTimesEqual(exactUpdateTime({seconds: 7, nanoseconds: 1}), exactUpdateTime({seconds: 7, nanoseconds: 2})), false);
});
test("malformed and legacy updateTimes are rejected", () => {
  for (const value of [{seconds: "x", nanoseconds: 0}, {seconds: -1, nanoseconds: 0}, {seconds: 1, nanoseconds: -1}, {seconds: 1, nanoseconds: 1.5}, {seconds: 1, nanoseconds: 1000000000}]) assert.throws(() => exactUpdateTime(value), /MALFORMED_UPDATE_TIME/);
  assert.throws(() => parseExactUpdateTime("2026-01-01T00:00:00.000Z"), /LEGACY_OR_MISSING/);
});
test("lastUpdateTime is constructed directly from exact components", () => {
  class Timestamp { constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; } }
  const condition = makeLastUpdateTime(exactUpdateTime({seconds: 9, nanoseconds: 987654321}), Timestamp);
  assert.deepEqual(condition.lastUpdateTime, new Timestamp(9, 987654321));
});

test("latest pointer can be created and refreshed while immutable JSON rejects overwrite", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tb-pointer-"));
  try {
    const pointer = path.join(directory, "LATEST_INVENTORY.json"); const immutable = path.join(directory, "inventory.json");
    replaceLatestPointer(pointer, {runId: "ONE", projectId: "ireps2", inventoryPath: "one"}, {unique: "one"});
    replaceLatestPointer(pointer, {runId: "TWO", projectId: "ireps2", inventoryPath: "two"}, {unique: "two"});
    assert.equal(JSON.parse(fs.readFileSync(pointer)).runId, "TWO");
    writeImmutableJson(immutable, {runId: "ONE"}); assert.throws(() => writeImmutableJson(immutable, {runId: "TWO"}), /EEXIST/);
  } finally { fs.rmSync(directory, {recursive: true}); }
});
test("failed pointer temporary write preserves old pointer and cleans only its own temp", () => {
  const files = new Map([["C:\\r\\LATEST_INVENTORY.json", "old"], ["C:\\r\\unrelated.tmp", "keep"]]);
  const mock = {writeFileSync(file) { files.set(file, "partial"); throw Object.assign(new Error("fail"), {code: "EIO"}); }, existsSync: (file) => files.has(file), unlinkSync: (file) => files.delete(file)};
  assert.throws(() => replaceLatestPointer("C:\\r\\LATEST_INVENTORY.json", {runId: "new"}, {fileSystem: mock, unique: "mine"}), /fail/);
  assert.equal(files.get("C:\\r\\LATEST_INVENTORY.json"), "old"); assert.equal(files.get("C:\\r\\unrelated.tmp"), "keep");
});

const correlationFixture = (patch = {}) => ({trnId: "TRN", trn: {id: "TRN", sourceModule: "SALES_TARGETED_BATCH", accessData: {erfId: "ERF", premise: {id: "PREM"}}, targetedBatchContext: {tbId: "TB", rowId: "ROW", salesDocId: "SALE", erfId: "ERF"}}, rowId: "ROW", row: {id: "ROW", tbId: "TB", salesAllMeterId: "SALE", refs: {erfId: "ERF", premiseId: "PREM", meterId: null, trnId: null}, execution: {status: "IN_PROGRESS"}}, tbId: "TB", parent: {id: "TB"}, salesDocId: "SALE", sales: {tbRefs: [{id: "TB", rowId: "ROW", fieldWork: {premiseId: "PREM"}}]}, erfId: "ERF", premiseId: "PREM", premise: {id: "PREM", erfId: "ERF", noAccessTrnIds: ["TRN"]}, registryErf: {id: "ERF"}, ...patch});
test("fully correlated and pre-premise targets pass", () => {
  assert.equal(proveCanonicalCorrelation(correlationFixture()).valid, true);
  const fixture = correlationFixture({premiseId: null, premise: null}); fixture.trn = {...fixture.trn, accessData: {erfId: "ERF"}}; fixture.row = {...fixture.row, refs: {...fixture.row.refs, premiseId: null}}; fixture.sales = {tbRefs: [{id: "TB", rowId: "ROW", fieldWork: {}}]};
  assert.equal(proveCanonicalCorrelation(fixture).valid, true);
});
for (const [name, mutate, blocker] of [
  ["other batch row", (f) => f.row.tbId = "OTHER", "ROW_TB_ID_MISMATCH"], ["other Sales row", (f) => f.row.salesAllMeterId = "OTHER", "ROW_SALES_DOC_ID_MISMATCH"], ["other ERF row", (f) => f.row.refs.erfId = "OTHER", "ROW_ERF_ID_MISMATCH"], ["parent identity", (f) => f.parent.id = "OTHER", "PARENT_BATCH_ID_MISMATCH"], ["missing exact tbRef", (f) => f.sales.tbRefs[0].rowId = "OTHER", "SALES_TBREF_NOT_FOUND"], ["duplicate tbRef", (f) => f.sales.tbRefs.push({...f.sales.tbRefs[0]}), "DUPLICATE_SALES_TBREF_MATCH"], ["tbRef ERF", (f) => f.sales.tbRefs[0].erfId = "OTHER", "SALES_TBREF_ERF_ID_MISMATCH"], ["premise ERF", (f) => f.premise.erfId = "OTHER", "PREMISE_ERF_ID_MISMATCH"], ["registry identity", (f) => f.registryErf.id = "OTHER", "REGISTRY_ERF_ID_MISMATCH"],
]) test(`correlation blocks ${name}`, () => { const fixture = correlationFixture(); mutate(fixture); assert.ok(proveCanonicalCorrelation(fixture).blockers.includes(blocker)); });

test("Storage live-state checks recreation, replacement, deletion, and same generation", () => {
  const missing = {state: "ALREADY_MISSING"}; const exists = {state: "EXISTS", generation: "2", metageneration: "3"};
  assert.equal(assessStorageLiveState(missing, null, {code: 404}).valid, true);
  assert.equal(assessStorageLiveState(missing, {generation: "1"}).blocker, "STORAGE_OBJECT_RECREATED_AFTER_INVENTORY");
  assert.equal(assessStorageLiveState(exists, {generation: "2", metageneration: "3"}).valid, true);
  assert.equal(assessStorageLiveState(exists, {generation: "4", metageneration: "1"}).blocker, "STORAGE_OBJECT_REPLACED_AFTER_INVENTORY");
  assert.equal(assessStorageLiveState(exists, null, {code: 404}).blocker, "STORAGE_OBJECT_MISSING_AFTER_INVENTORY");
});

const salesRows = () => [{documentId: "A", updateTime: exactUpdateTime({seconds: 1, nanoseconds: 1}), data: {tbRefs: [{id: "TB"}], geofenceRefs: [1], other: true}}, {documentId: "B", updateTime: exactUpdateTime({seconds: 2, nanoseconds: 2}), data: {other: true}}];
test("full Sales preflight ignores unrelated changes but detects ID and tbRefs scope changes", () => {
  assert.equal(assessSalesCollection(salesRows(), salesRows()).valid, true);
  assert.equal(assessSalesCollection(salesRows(), [...salesRows(), {documentId: "C", updateTime: exactUpdateTime({seconds: 3, nanoseconds: 0}), data: {}}]).valid, false);
  assert.equal(assessSalesCollection(salesRows(), salesRows().slice(0, 1)).valid, false);
  const unrelated = salesRows(); unrelated[1].updateTime = exactUpdateTime({seconds: 2, nanoseconds: 3}); unrelated[1].data.other = "changed"; assert.equal(assessSalesCollection(salesRows(), unrelated).valid, true);
  const changed = salesRows(); changed[0].data.tbRefs = [{id: "OTHER"}]; assert.equal(assessSalesCollection(salesRows(), changed).valid, false);
  const gained = salesRows(); gained[1].data.tbRefs = []; assert.equal(assessSalesCollection(salesRows(), gained).valid, false);
});
test("final full Sales scan requires exact IDs/count and zero root tbRefs", () => {
  const clean = salesRows().map((row) => ({...row, data: cleanDemoSales(row.data)}));
  const result = assessSalesCollection(salesRows(), clean, {final: true}); assert.equal(result.valid, true); assert.equal(result.tbRefsRemaining, 0); assert.deepEqual(clean[0].data.geofenceRefs, [1]);
  clean[1].data.tbRefs = []; assert.equal(assessSalesCollection(salesRows(), clean, {final: true}).valid, false);
});
