import test from "node:test";
import assert from "node:assert/strict";
import { previewBulk, createBulkGraph, BULK_CONTRACT, digest } from "../tcUploads/stage2Core.js";
import { OFFICIAL_HEADERS } from "../tcUploads/stage1Validation.js";
import { serializeCsv } from "../tcUploads/sourceCsv.js";

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

function makeMockDb(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs).map(([k, v]) => [k, structuredClone(v)]));

  function docRef(path) {
    const id = path.split("/").pop();
    return {
      id,
      path,
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
        for (const [k, v] of Object.entries(updates)) setByPath(cur, k, structuredClone(v));
        store.set(path, cur);
      },
      async create(data) {
        if (store.has(path)) throw new Error(`Document ${path} already exists`);
        store.set(path, structuredClone(data));
      },
    };
  }

  function makeQuery(colName, filters = [], limitCount = null) {
    return {
      where(field, op, value) {
        return makeQuery(colName, [...filters, { field, op, value }], limitCount);
      },
      limit(n) {
        return makeQuery(colName, filters, n);
      },
      async get() {
        const prefix = `${colName}/`;
        const docs = [];
        for (const [path, data] of store.entries()) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          if (rest.includes("/")) continue;
          let match = true;
          for (const { field, op, value } of filters) {
            const actual = getByPath(data, field);
            if (op === "==" && actual !== value) { match = false; break; }
            if (op === "in" && !value.includes(actual)) { match = false; break; }
          }
          if (match) {
            const id = rest;
            docs.push({
              id,
              exists: true,
              ref: docRef(path),
              data: () => structuredClone(data),
            });
          }
        }
        const sliced = limitCount == null ? docs : docs.slice(0, limitCount);
        return {
          empty: sliced.length === 0,
          size: sliced.length,
          docs: sliced,
          forEach(cb) { sliced.forEach(cb); },
        };
      },
    };
  }

  const db = {
    _store: store,
    doc: docRef,
    getAll(...refs) {
      return Promise.all(refs.map((r) => r.get()));
    },
    collection(name) {
      return {
        doc(id) {
          const generatedId = id || `${name}_auto_${Math.random().toString(36).slice(2, 10)}`;
          return docRef(`${name}/${generatedId}`);
        },
        where(field, op, value) {
          return makeQuery(name, [{ field, op, value }]);
        },
        limit(n) {
          return makeQuery(name, [], n);
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        get: (refOrQuery) => refOrQuery.get(),
        getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
        set: (ref, data, opts) => ref.set(data, opts),
        update: (ref, data) => ref.update(data),
        create: (ref, data) => ref.create(data),
      };
      return fn(tx);
    },
  };

  return db;
}

function makeRow(rowNo, meterNo) {
  return Object.fromEntries(
    OFFICIAL_HEADERS.map((h) => [
      h,
      h === "rowNo" ? String(rowNo) : h === "meterNo" ? meterNo : "",
    ])
  );
}

function makeBaseDocs({ lmPcode, wardPcode, uid }) {
  return {
    [`users/${uid}`]: {
      accountStatus: "ACTIVE",
      employment: { role: "MNG", serviceProvider: { id: "MNC1" } },
      access: { workbases: [lmPcode] },
    },
    [`wards/${wardPcode}`]: {
      parents: { localMunicipalityId: lmPcode },
      name: "Ward 1",
    },
  };
}

function addMeterDocs(docs, { id, meterNo, lmPcode, wardPcode, premiseId, state }) {
  const parents = { lmPcode, wardPcode };
  docs[`premises/${premiseId}`] = {
    id: premiseId,
    parents,
    erfId: `E_${id}`,
    erfNo: "101",
    services: { electricityMeters: [{ trnId: id }] },
  };
  docs[`asts/${id}`] = {
    id,
    meterType: "electricity",
    accessData: { parents, premise: { id: premiseId }, erfNo: "101" },
    ast: { astData: { astId: id, astNo: meterNo, meter: { type: "conventional" } } },
    status: { state },
    geofenceRefs: [],
  };
  docs[`trns/${id}`] = {
    id,
    accessData: { trnType: "METER_DISCOVERY", access: { hasAccess: "yes" } },
    ast: { astData: { astNo: meterNo } },
  };
  docs[`meter_master/${meterNo}`] = { refs: { asts: { id } } };
}

test("DCN upload routing: CONNECTED -> MDCN, DISCONNECTED -> MINSP (separate batch), DECOMMISSIONED -> Ineligible", async () => {
  const lmPcode = "ZA5241";
  const wardPcode = "ZA5241001";
  const uid = "M_USER_1";
  const docs = makeBaseDocs({ lmPcode, wardPcode, uid });

  addMeterDocs(docs, { id: "TRN_MDIS_CONN", meterNo: "10000001", lmPcode, wardPcode, premiseId: "P1", state: "CONNECTED" });
  addMeterDocs(docs, { id: "TRN_MDIS_DISC", meterNo: "10000002", lmPcode, wardPcode, premiseId: "P2", state: "DISCONNECTED" });
  addMeterDocs(docs, { id: "TRN_MDIS_DECOM", meterNo: "10000003", lmPcode, wardPcode, premiseId: "P3", state: "DECOMMISSIONED" });

  // Open METER_REMOVAL on TRN_MDIS_DISC must NOT block proposed METER_INSPECTION (same-operation check only)
  docs["trns/TRN_OPEN_REM"] = {
    id: "TRN_OPEN_REM",
    accessData: { trnType: "METER_REMOVAL" },
    ast: { astData: { astId: "TRN_MDIS_DISC" } },
    workflow: { state: "ISSUED" },
  };
  // Open METER_INSPECTION on TRN_MDIS_CONN must NOT block METER_DISCONNECTION
  docs["trns/TRN_OPEN_INSP_CONN"] = {
    id: "TRN_OPEN_INSP_CONN",
    accessData: { trnType: "METER_INSPECTION" },
    ast: { astData: { astId: "TRN_MDIS_CONN" } },
    workflow: { state: "CREATED" },
  };

  const rows = [
    makeRow(1, "10000001"),
    makeRow(2, "10000002"),
    makeRow(3, "10000003"),
  ];
  const db = makeMockDb(docs);

  const preview = await previewBulk({
    db,
    uid,
    data: { lmPcode, trnType: "METER_DISCONNECTION", rows, keep: {} },
  });

  const eligMap = new Map(preview.eligibility);
  assert.equal(eligMap.get("1").eligible, true);
  assert.equal(eligMap.get("1").effectiveTrnType, "METER_DISCONNECTION");

  assert.equal(eligMap.get("2").eligible, true);
  assert.equal(eligMap.get("2").effectiveTrnType, "METER_INSPECTION");
  assert.match(eligMap.get("2").message, /Proposed for Inspection \(MINSP\)/);

  assert.equal(eligMap.get("3").eligible, false);
  assert.match(eligMap.get("3").message, /Decommissioned/i);

  const csv = serializeCsv([OFFICIAL_HEADERS, ...rows.map((r) => OFFICIAL_HEADERS.map((h) => r[h]))]);
  const source = {
    id: digest(`${uid}:dcn-routing`),
    uid,
    lmPcode,
    trnType: "METER_DISCONNECTION",
    contractVersion: BULK_CONTRACT,
    hash: digest(csv),
    fileName: "DCN_Test.csv",
    generation: "1",
  };
  await db.doc(`tc_source_files/${source.id}`).set(source);

  const created = await createBulkGraph({
    db,
    uid,
    data: {
      lmPcode,
      trnType: "METER_DISCONNECTION",
      selectedRowNos: ["1", "2"],
      keep: {},
    },
    source,
    csv,
  });

  assert.equal(created.success, true);
  assert.equal(created.totalMeters, 2);
  assert.equal(created.batches.length, 2, "CONNECTED and DISCONNECTED in same ward must split into 2 single-type batches");

  const tcUploads = created.batches.map((b) => db._store.get(`tc_uploads/${b.tcId}`));
  const trnTypes = new Set(tcUploads.map((u) => u.trnType));
  assert.deepEqual(trnTypes, new Set(["METER_DISCONNECTION", "METER_INSPECTION"]));

  const dcnBatch = tcUploads.find((u) => u.trnType === "METER_DISCONNECTION");
  const inspBatch = tcUploads.find((u) => u.trnType === "METER_INSPECTION");
  assert.match(dcnBatch.id, /^TRN_BGO_\d{8}_\d{6}_ZA5241001_MDCN$/);
  assert.match(inspBatch.id, /^TRN_BGO_\d{8}_\d{6}_ZA5241001_MINSP$/);
  assert.equal(dcnBatch.trnIds.length, 1);
  assert.equal(inspBatch.trnIds.length, 1);

  const dcnTrn = db._store.get(`trns/${dcnBatch.trnIds[0]}`);
  const inspTrn = db._store.get(`trns/${inspBatch.trnIds[0]}`);
  assert.equal(dcnTrn.accessData.trnType, "METER_DISCONNECTION");
  assert.equal(inspTrn.accessData.trnType, "METER_INSPECTION");
});

test("DCN upload blocks DISCONNECTED meter only if it already has an active METER_INSPECTION job", async () => {
  const lmPcode = "ZA5241";
  const wardPcode = "ZA5241001";
  const uid = "M_USER_2";
  const docs = makeBaseDocs({ lmPcode, wardPcode, uid });

  addMeterDocs(docs, { id: "TRN_MDIS_DISC_BUSY", meterNo: "20000001", lmPcode, wardPcode, premiseId: "P1", state: "DISCONNECTED" });
  docs["trns/TRN_ACTIVE_INSP"] = {
    id: "TRN_ACTIVE_INSP",
    accessData: { trnType: "METER_INSPECTION" },
    ast: { astData: { astId: "TRN_MDIS_DISC_BUSY" } },
    workflow: { state: "ISSUED" },
  };

  const db = makeMockDb(docs);
  const preview = await previewBulk({
    db,
    uid,
    data: { lmPcode, trnType: "METER_DISCONNECTION", rows: [makeRow(1, "20000001")], keep: {} },
  });

  const elig = new Map(preview.eligibility).get("1");
  assert.equal(elig.eligible, false);
  assert.match(elig.message, /Active METER_INSPECTION job .* already exists/);
});

test("DCN upload blocks DISCONNECTED meter if it already has an IN_PROGRESS METER_INSPECTION job", async () => {
  const lmPcode = "ZA5241";
  const wardPcode = "ZA5241001";
  const uid = "M_USER_3";
  const docs = makeBaseDocs({ lmPcode, wardPcode, uid });

  addMeterDocs(docs, { id: "TRN_MDIS_DISC_IP", meterNo: "30000001", lmPcode, wardPcode, premiseId: "P1", state: "DISCONNECTED" });
  docs["trns/TRN_INPROG_INSP"] = {
    id: "TRN_INPROG_INSP",
    accessData: { trnType: "METER_INSPECTION" },
    ast: { astData: { astId: "TRN_MDIS_DISC_IP" } },
    workflow: { state: "IN_PROGRESS" },
  };

  const db = makeMockDb(docs);
  const preview = await previewBulk({
    db,
    uid,
    data: { lmPcode, trnType: "METER_DISCONNECTION", rows: [makeRow(1, "30000001")], keep: {} },
  });

  const elig = new Map(preview.eligibility).get("1");
  assert.equal(elig.eligible, false);
  assert.match(elig.message, /Active METER_INSPECTION job TRN_INPROG_INSP already exists/);
});

test("TRN BGO upload blocks meter whose ERF has an open Targeted Batch", async () => {
  const lmPcode = "ZA5241";
  const wardPcode = "ZA5241001";
  const uid = "M_USER_4";
  const docs = makeBaseDocs({ lmPcode, wardPcode, uid });

  addMeterDocs(docs, { id: "TRN_MDIS_TB_LOCKED", meterNo: "40000001", lmPcode, wardPcode, premiseId: "P1", state: "CONNECTED" });
  docs["tb_uploads/TGB_OPEN_1"] = {
    id: "TGB_OPEN_1",
    geofenceId: "GF1",
    geofenceName: "Gf W6",
    allocation: {
      status: "ALLOCATED",
      targetType: "TEAM",
      targetId: "TEAM_PETER",
      targetName: "Peter Team",
      allocatedAt: "2026-09-17T00:00:00.000Z",
    },
  };
  docs["tb_rows/TGB_OPEN_1_R1"] = {
    id: "TGB_OPEN_1_R1",
    tbId: "TGB_OPEN_1",
    refs: { erfId: "E_TRN_MDIS_TB_LOCKED" },
    execution: { status: "NOT_STARTED" },
  };

  const db = makeMockDb(docs);
  const preview = await previewBulk({
    db,
    uid,
    data: { lmPcode, trnType: "METER_DISCONNECTION", rows: [makeRow(1, "40000001")], keep: {} },
  });

  const elig = new Map(preview.eligibility).get("1");
  assert.equal(elig.eligible, false);
  assert.match(elig.message, /TGB_OPEN_1/);
});
