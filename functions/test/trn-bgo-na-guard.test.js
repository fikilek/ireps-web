import test from "node:test";
import assert from "node:assert/strict";
import { recordLifecycleNoAccess } from "../noAccess/recordLifecycleNoAccess.js";

function getByPath(obj, path) {
  return path.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
}

function setByPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function applyFieldTransform(curValue, value) {
  if (value && typeof value === "object" && value.constructor?.name === "ArrayUnionTransform") {
    const arr = Array.isArray(curValue) ? [...curValue] : [];
    for (const el of value.elements || []) {
      if (!arr.includes(el)) arr.push(el);
    }
    return arr;
  }
  if (value && typeof value === "object" && value.constructor?.name === "NumericIncrementTransform") {
    return (Number(curValue) || 0) + Number(value.operand || 0);
  }
  if (value && typeof value === "object" && value.constructor?.name === "DeleteTransform") {
    return undefined;
  }
  return structuredClone(value);
}

function makeMockDb(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]));

  function docRef(path) {
    const id = path.split("/").pop();
    return {
      id,
      path,
      collection(sub) {
        return {
          doc(subId) {
            return docRef(`${path}/${sub}/${subId || `auto_${Math.random().toString(36).slice(2, 8)}`}`);
          },
        };
      },
      async get() {
        const data = store.get(path);
        return {
          id,
          ref: docRef(path),
          exists: data !== undefined,
          data: () => (data === undefined ? undefined : structuredClone(data)),
        };
      },
      async set(data, opts) {
        if (opts?.merge && store.has(path)) {
          store.set(path, { ...store.get(path), ...structuredClone(data) });
        } else {
          store.set(path, structuredClone(data));
        }
      },
      async update(updates) {
        const cur = structuredClone(store.get(path) || {});
        for (const [k, v] of Object.entries(updates)) {
          const existingVal = getByPath(cur, k);
          const nextVal = applyFieldTransform(existingVal, v);
          if (nextVal === undefined) {
            const parts = k.split(".");
            let target = cur;
            for (let i = 0; i < parts.length - 1 && target; i++) target = target[parts[i]];
            if (target) delete target[parts[parts.length - 1]];
          } else {
            setByPath(cur, k, nextVal);
          }
        }
        store.set(path, cur);
      },
    };
  }

  return {
    _store: store,
    doc: docRef,
    collection(name) {
      return {
        doc(id) {
          return docRef(`${name}/${id || `auto_${Math.random().toString(36).slice(2, 8)}`}`);
        },
        where() {
          return {
            limit() { return this; },
            async get() { return { empty: true, size: 0, docs: [] }; },
          };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
        update: (ref, data) => ref.update(data),
      };
      return fn(tx);
    },
  };
}

test("recordLifecycleNoAccess never completes a TRN BGO instruction even when submitted with instructionTrnId === trnId", async () => {
  const instrId = "TRN_MINSP_1794788511717_ELC_ZA5241006_2631";
  const astId = "TRN_MDIS_1790491022800_ELC_ZA5241006_2631";
  const premiseId = "PREM_1";
  const erfId = "ERF_1";
  const lmPcode = "ZA5241";
  const wardPcode = "ZA5241006";
  const batchId = "TRN_BGO_20261116_022151_ZA5241006_MINSP";
  const rowId = `${batchId}_R000001`;
  const sourceFileId = "SRC_1";
  const requestId = "REQ_1";
  const uid = "FWR_1";

  const db = makeMockDb({
    [`users/${uid}`]: {
      accountStatus: "ACTIVE",
      employment: { role: "FWR", serviceProvider: { id: "SP1" } },
      access: { workbases: [lmPcode] },
    },
    "serviceProviders/SP1": { status: "ACTIVE", registeredName: "SP One" },
    [`tc_uploads/${batchId}`]: {
      id: batchId,
      contractVersion: "TRN_BGO_11COL_REASON_FREE_V1",
      sourceFileId,
      lmPcode,
      trnIds: [instrId],
      workflow: { state: "ACCEPTED" },
      assignment: { targets: [{ type: "SP", id: "SP1" }] },
    },
    [`tc_rows/${rowId}`]: { id: rowId, tcId: batchId, trnId: instrId, requestId },
    [`tc_source_files/${sourceFileId}`]: { id: sourceFileId, committed: true },
    [`tc_upload_dedupe/V2_${requestId}`]: { result: { success: true, batches: [{ tcId: batchId }] } },
    [`ireps_erfs/${erfId}`]: { id: erfId, erfNo: "2631", admin: { localMunicipality: { pcode: lmPcode }, ward: { pcode: wardPcode } }, parents: { lmPcode, wardPcode } },
    [`premises/${premiseId}`]: { id: premiseId, erfId, erfNo: "2631", address: { street: "18A Oldacre St" }, propertyType: { type: "Residential" }, noAccessTrnIds: [] },
    [`asts/${astId}`]: {
      id: astId,
      meterType: "electricity",
      accessData: { erfId, premise: { id: premiseId }, parents: { lmPcode, wardPcode } },
      ast: { astData: { astId, astNo: "04297758833" }, location: { gps: { lat: -28.16, lng: 30.23 } } },
      trnActiveLifecycle: { trnId: instrId, trnType: "METER_INSPECTION", workflowState: "ACCEPTED" },
      counts: { noAccess: 0 },
    },
    [`trns/${instrId}`]: {
      id: instrId,
      accessData: { trnType: "METER_INSPECTION", erfId, premise: { id: premiseId }, parents: { lmPcode, wardPcode } },
      ast: { astData: { astId, astNo: "04297758833" }, location: { gps: { lat: -28.16, lng: 30.23 } } },
      workflow: { state: "ACCEPTED" },
      assignment: { targets: [{ type: "SP", id: "SP1" }] },
      origin: { channel: "OFFICE", trnBgo: { batchId, rowId, sourceFileId, requestId, contractVersion: "TRN_BGO_11COL_REASON_FREE_V1" } },
    },
  });

  const makePayload = (stamp) => ({
    id: instrId,
    instructionTrnId: instrId,
    astId,
    origin: { channel: "OFFICE", trnBgo: { batchId } },
    media: [{ tag: "noAccessPhoto", url: "https://example.com/na.jpg" }],
    metadata: { createdOnDevice: stamp, updatedOnDevice: stamp },
    accessData: {
      trnType: "METER_INSPECTION",
      erfId,
      erfNo: "2631",
      parents: { lmPcode, wardPcode },
      premise: { id: premiseId },
      access: { hasAccess: "no", reasonCode: "OTHER", reasonOther: "Gate locked", reason: "Gate locked" },
    },
  });

  const first = await recordLifecycleNoAccess({
    db,
    data: makePayload("2026-11-16T00:30:00.000Z"),
    actor: { uid, name: "Worker 1" },
    now: "2026-11-16T00:30:01.000Z",
    isOffice: true,
  });

  assert.equal(first.success, true);
  assert.notEqual(first.trnId, instrId);
  assert.match(first.trnId, new RegExp(`^${instrId}_NA_`));

  const instrAfter1 = db._store.get(`trns/${instrId}`);
  assert.equal(instrAfter1.workflow.state, "IN_PROGRESS");
  assert.equal(instrAfter1.noAccessCount, 1);
  assert.deepEqual(instrAfter1.noAccessTrnIds, [first.trnId]);
  assert.equal(db._store.get(`asts/${astId}`).trnActiveLifecycle.trnId, instrId);

  const naDoc1 = db._store.get(`trns/${first.trnId}`);
  assert.deepEqual(naDoc1.assignment, { targets: [{ type: "SP", id: "SP1" }] });
  assert.equal(naDoc1.origin?.trnBgoNoAccess?.batchId, batchId);
  assert.equal(naDoc1.origin?.trnBgoNoAccess?.rowId, rowId);
  assert.equal(naDoc1.origin?.trnBgoNoAccess?.instructionTrnId, instrId);

  const second = await recordLifecycleNoAccess({
    db,
    data: makePayload("2026-11-16T00:31:00.000Z"),
    actor: { uid, name: "Worker 1" },
    now: "2026-11-16T00:31:01.000Z",
    isOffice: true,
  });

  assert.equal(second.success, true);
  assert.notEqual(second.trnId, first.trnId);

  const instrAfter2 = db._store.get(`trns/${instrId}`);
  assert.equal(instrAfter2.workflow.state, "IN_PROGRESS");
  assert.equal(instrAfter2.noAccessCount, 2);
  assert.deepEqual(instrAfter2.noAccessTrnIds, [first.trnId, second.trnId]);

  // Once the instruction itself is COMPLETED, further NAs are rejected
  instrAfter2.workflow.state = "COMPLETED";
  db._store.set(`trns/${instrId}`, instrAfter2);
  await assert.rejects(
    recordLifecycleNoAccess({
      db,
      data: makePayload("2026-11-16T00:32:00.000Z"),
      actor: { uid, name: "Worker 1" },
      now: "2026-11-16T00:32:01.000Z",
      isOffice: true,
    }),
    /already completed/i
  );
});
