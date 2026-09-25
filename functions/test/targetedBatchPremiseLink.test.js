import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertCompleteTargetedBatchPremiseContext,
  buildSalesTbRefsForPremiseStart,
  classifyTargetedBatchPremiseRoute,
  completeTargetedBatchMeterDiscoveryInTransaction,
  createOrLinkTargetedBatchPremise,
  isSalesTargetedBatchContext,
  normalizeTargetedBatchPremiseContext,
} from "../targetedBatches/premiseLink.js";

const TB_ID = "TGB_20260803_064212_TC5B";
const ROW_ID = "TBR_TGB_20260803_064212_TC5B_0001";
const PREMISE_ID = "PRM_TEST_001";
const UPDATED_AT = { seconds: 1, nanoseconds: 0 };

test("recognises only the Sales Targeted Batch source module", () => {
  assert.equal(
    isSalesTargetedBatchContext({
      sourceModule: "SALES_TARGETED_BATCH",
    }),
    true,
  );

  assert.equal(
    isSalesTargetedBatchContext({
      sourceModule: "BGO",
    }),
    false,
  );
});

test("classifies absent context as NORMAL", () => {
  assert.equal(
    classifyTargetedBatchPremiseRoute({
      hasTargetedBatchContext: false,
    }).selectedBranch,
    "NORMAL",
  );
});

test("classifies supported Sales operation types as TARGETED_BATCH", () => {
  [undefined, "   ", "METER_DISCOVERY"].forEach((operationType) => {
    const result = classifyTargetedBatchPremiseRoute({
      hasTargetedBatchContext: true,
      targetedBatchContext: {
        sourceModule: "SALES_TARGETED_BATCH",
        operationType,
        tbId: TB_ID,
        rowId: ROW_ID,
        salesDocId: "04298074388",
        erfId: "ERF_001",
      },
    });

    assert.equal(result.selectedBranch, "TARGETED_BATCH");
  });
});

test("rejects an explicitly invalid Sales operation type", () => {
  const result = classifyTargetedBatchPremiseRoute({
    hasTargetedBatchContext: true,
    targetedBatchContext: {
      sourceModule: "SALES_TARGETED_BATCH",
      operationType: "BGO",
      tbId: TB_ID,
      rowId: ROW_ID,
      salesDocId: "04298074388",
      erfId: "ERF_001",
    },
  });

  assert.equal(result.selectedBranch, "REJECTED_CONTEXT");
  assert.equal(result.code, "TARGETED_BATCH_CONTEXT_INVALID");
});

test("rejects empty, incomplete and unrecognized supplied contexts", () => {
  const contexts = [
    {},
    { sourceModule: "SALES_TARGETED_BATCH", tbId: TB_ID },
    {
      sourceModule: "BGO",
      tbId: TB_ID,
      rowId: ROW_ID,
      salesDocId: "04298074388",
      erfId: "ERF_001",
    },
  ];

  contexts.forEach((targetedBatchContext) => {
    const result = classifyTargetedBatchPremiseRoute({
      hasTargetedBatchContext: true,
      targetedBatchContext,
    });
    assert.equal(result.selectedBranch, "REJECTED_CONTEXT");
    assert.equal(result.code, "TARGETED_BATCH_CONTEXT_INVALID");
  });
});

test("normalises the complete premise correlation chain", () => {
  const context = normalizeTargetedBatchPremiseContext({
    sourceModule: " sales_targeted_batch ",
    operationType: "meter_discovery",
    tbId: ` ${TB_ID} `,
    rowId: ` ${ROW_ID} `,
    rowNo: "1",
    salesDocId: " 04298074388 ",
    erfId: " ERF_001 ",
  });

  assert.deepEqual(context, {
    sourceModule: "SALES_TARGETED_BATCH",
    operationType: "METER_DISCOVERY",
    tbId: TB_ID,
    rowId: ROW_ID,
    rowNo: 1,
    salesDocId: "04298074388",
    erfId: "ERF_001",
    meterNo: null,
    accountNumber: null,
    customerName: null,
  });

  assert.doesNotThrow(() =>
    assertCompleteTargetedBatchPremiseContext(context),
  );
});

test("rejects an incomplete Targeted Batch premise context", () => {
  assert.throws(
    () =>
      assertCompleteTargetedBatchPremiseContext({
        tbId: TB_ID,
        rowId: ROW_ID,
        salesDocId: "",
        erfId: "",
      }),
    (error) => {
      assert.equal(error.irepsCode, "TARGETED_BATCH_CONTEXT_INCOMPLETE");
      assert.deepEqual(error.details.missing, ["salesDocId", "erfId"]);
      return true;
    },
  );
});

test("enriches only the matching Sales TB reference", () => {
  const originalOtherReference = {
    id: "TGB_20260913_120000_BBBB",
    date: UPDATED_AT,
  };
  const originalDate = { seconds: 123, nanoseconds: 456 };
  const tbRefs = [
    originalOtherReference,
    {
      id: TB_ID,
      date: originalDate,
    },
  ];

  const result = buildSalesTbRefsForPremiseStart({
    tbRefs,
    tbId: TB_ID,
    rowId: ROW_ID,
    premiseId: PREMISE_ID,
    targetedMeterNo: "04298074388",
    updatedAt: UPDATED_AT,
  });

  assert.equal(result.alreadyLinked, false);
  assert.equal(result.updatedTbRefs.length, 2);
  assert.strictEqual(result.updatedTbRefs[0], originalOtherReference);
  assert.strictEqual(result.updatedTbRefs[1].date, originalDate);
  assert.equal(result.updatedTbRefs[1].rowId, ROW_ID);
  assert.deepEqual(result.updatedTbRefs[1].fieldWork, {
    status: "IN_PROGRESS",
    outcomeCode: null,
    outcomeLabel: null,
    targetedMeterNo: "04298074388",
    discoveredMeterNo: null,
    meterMatch: null,
    premiseId: PREMISE_ID,
    meterId: null,
    trnId: null,
    submittedAt: null,
    updatedAt: UPDATED_AT,
  });

  assert.deepEqual(tbRefs, [
    originalOtherReference,
    {
      id: TB_ID,
      date: originalDate,
    },
  ]);
});

test("same TB Row and premise is idempotent", () => {
  const result = buildSalesTbRefsForPremiseStart({
    tbRefs: [
      {
        id: TB_ID,
        rowId: ROW_ID,
        date: UPDATED_AT,
        fieldWork: {
          status: "IN_PROGRESS",
          updatedAt: UPDATED_AT,
          premiseId: PREMISE_ID,
          targetedMeterNo: "04298074388",
        },
      },
    ],
    tbId: TB_ID,
    rowId: ROW_ID,
    premiseId: PREMISE_ID,
    targetedMeterNo: "04298074388",
    updatedAt: UPDATED_AT,
  });

  assert.equal(result.alreadyLinked, true);
  assert.equal(result.updatedTbRefs[0].fieldWork.status, "IN_PROGRESS");
  assert.equal(result.updatedTbRefs[0].fieldWork.premiseId, PREMISE_ID);
});

test("another premise cannot replace the existing Sales link", () => {
  assert.throws(
    () =>
      buildSalesTbRefsForPremiseStart({
        tbRefs: [
          {
            id: TB_ID,
            date: UPDATED_AT,
            rowId: ROW_ID,
            fieldWork: {
              status: "IN_PROGRESS",
              updatedAt: UPDATED_AT,
              premiseId: "PRM_EXISTING",
            },
          },
        ],
        tbId: TB_ID,
        rowId: ROW_ID,
        premiseId: PREMISE_ID,
        targetedMeterNo: "04298074388",
        updatedAt: UPDATED_AT,
      }),
    (error) => {
      assert.equal(error.irepsCode, "SALES_TB_REF_PREMISE_CONFLICT");
      return true;
    },
  );
});

test("missing and duplicate Sales TB references are blocked", () => {
  assert.throws(
    () =>
      buildSalesTbRefsForPremiseStart({
        tbRefs: [],
        tbId: TB_ID,
        rowId: ROW_ID,
        premiseId: PREMISE_ID,
        targetedMeterNo: "04298074388",
        updatedAt: UPDATED_AT,
      }),
    (error) => error.irepsCode === "TB_REFERENCE_INVALID",
  );

  assert.throws(
    () =>
      buildSalesTbRefsForPremiseStart({
        tbRefs: [{ id: TB_ID }, { id: TB_ID }],
        tbId: TB_ID,
        rowId: ROW_ID,
        premiseId: PREMISE_ID,
        targetedMeterNo: "04298074388",
        updatedAt: UPDATED_AT,
      }),
    (error) => error.irepsCode === "TB_REFERENCE_AMBIGUOUS",
  );
});

test("premise callable routes linked creation through the transaction helper", async () => {
  const indexSource = await readFile(
    new URL("../index.js", import.meta.url),
    "utf8",
  );

  assert.match(
    indexSource,
    /createOrLinkTargetedBatchPremise\(\{/,
  );
  assert.match(
    indexSource,
    /classifyTargetedBatchPremiseRoute\(\{/,
  );
  assert.match(indexSource, /selectedBranch: targetedBatchRoute\.selectedBranch/);
  assert.match(indexSource, /"REJECTED_CONTEXT"/);
  assert.match(
    indexSource,
    /error\?\.irepsCode \|\| "UNKNOWN_ERROR"/,
  );
});

class FakeDocumentReference {
  constructor(store, collectionName, id) {
    this.store = store;
    this.collectionName = collectionName;
    this.id = id;
    this.path = `${collectionName}/${id}`;
  }
}

// A collection query, enough for the reads the batch-work guard makes (TB-R059): equality filters on a
// collection, read through the same transaction as the documents.
class FakeQuery {
  constructor(store, collectionName, filters = []) {
    this.store = store;
    this.collectionName = collectionName;
    this.filters = filters;
  }

  where(field, op, value) {
    return new FakeQuery(this.store, this.collectionName, [
      ...this.filters,
      [field, value],
    ]);
  }

  limit() {
    return this;
  }

  async get() {
    return this.store.runQuery(this);
  }
}

class FakeDocumentSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this.value = value;
  }

  data() {
    return this.value;
  }
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function setDotPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;

  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== "object") {
      cursor[part] = {};
    }
    cursor = cursor[part];
  });

  cursor[parts.at(-1)] = value;
}

class FakeFirestore {
  constructor(initialDocuments = {}) {
    this.documents = new Map(
      Object.entries(initialDocuments).map(([path, value]) => [
        path,
        cloneValue(value),
      ]),
    );
    this.transactionWrites = [];
  }

  collection(collectionName) {
    return {
      doc: (id) =>
        new FakeDocumentReference(this, collectionName, id),
      where: (field, op, value) =>
        new FakeQuery(this, collectionName, [[field, value]]),
    };
  }

  read(path) {
    return cloneValue(this.documents.get(path));
  }

  runQuery(query) {
    const at = (value, path) =>
      path
        .split(".")
        .reduce(
          (cursor, key) =>
            cursor === undefined || cursor === null ? undefined : cursor[key],
          value,
        );
    const docs = [...this.documents.entries()]
      .filter(
        ([path]) =>
          path.startsWith(`${query.collectionName}/`) &&
          path.split("/").length === 2,
      )
      .filter(([, value]) =>
        query.filters.every(([field, wanted]) => at(value, field) === wanted),
      )
      .map(([path, value]) => ({
        id: path.split("/").at(-1),
        ref: new FakeDocumentReference(this, query.collectionName, path.split("/").at(-1)),
        data: () => cloneValue(value),
      }));

    return { docs, empty: docs.length === 0 };
  }

  async runTransaction(callback) {
    const writes = [];

    const transaction = {
      get: async (ref) =>
        ref instanceof FakeQuery
          ? this.runQuery(ref)
          : new FakeDocumentSnapshot(
            ref,
            cloneValue(this.documents.get(ref.path)),
          ),
      create: (ref, value) => {
        writes.push({ type: "create", ref, value: cloneValue(value) });
      },
      update: (ref, patch) => {
        writes.push({ type: "update", ref, value: cloneValue(patch) });
      },
    };

    const result = await callback(transaction);

    this.transactionWrites.push(...cloneValue(writes));

    writes.forEach((write) => {
      if (write.type === "create") {
        if (this.documents.has(write.ref.path)) {
          throw new Error(`Document already exists: ${write.ref.path}`);
        }

        this.documents.set(write.ref.path, write.value);
        return;
      }

      const existing = cloneValue(this.documents.get(write.ref.path));

      if (!existing) {
        throw new Error(`Document not found: ${write.ref.path}`);
      }

      Object.entries(write.value).forEach(([path, value]) => {
        if (path.includes(".")) {
          setDotPath(existing, path, value);
        } else {
          existing[path] = value;
        }
      });

      this.documents.set(write.ref.path, existing);
    });

    return result;
  }
}

function buildLinkedFixture() {
  const salesDocId = "04298074388";
  const erfId = "ERF_001";

  return {
    salesDocId,
    erfId,
    premiseId: PREMISE_ID,
    documents: {
      [`tb_uploads/${TB_ID}`]: {
        id: TB_ID,
        creation: { state: "READY" },
        allocation: { status: "ALLOCATED", targetType: "TEAM", targetId: "TEAM_1" },
        acceptance: { status: "ACCEPTED" },
        execution: {
          status: "NOT_STARTED",
          startedAt: null,
          completedAt: null,
        },
        counts: {
          executionStartedRows: 0,
          completedRows: 0,
        },
        scope: {
          lmPcode: "ZA5241",
          wardPcode: "ZA524100005",
        },
        metadata: {},
      },
      [`tb_rows/${ROW_ID}`]: {
        id: ROW_ID,
        tbId: TB_ID,
        rowNo: 1,
        salesAllMeterId: salesDocId,
        source: { recordId: salesDocId },
        decision: { status: "ACCEPT" },
        allocation: {
          allocatable: true,
          status: "ALLOCATED",
        },
        execution: {
          status: "NOT_STARTED",
          startedAt: null,
          completedAt: null,
        },
        refs: {
          erfId,
          premiseId: null,
          meterId: null,
          trnId: null,
        },
        meter: {
          numberRaw: salesDocId,
          numberNormalized: salesDocId,
        },
        customer: {
          accountNumber: "ACC-1",
          customerName: "Test Customer",
        },
        location: {
          addressLine1: "67 DAMMANN",
          town: "GLENCOE",
        },
        scope: {
          lmPcode: "ZA5241",
          wardPcode: "ZA524100005",
        },
        metadata: {},
      },
      [`sales-all-meters/${salesDocId}`]: {
        meterNo: salesDocId,
        geofenceRefs: [{ id: "GF_001" }],
        category: "CAT-1",
        tbRefs: [
          {
            id: TB_ID,
            date: UPDATED_AT,
          },
        ],
      },
      [`ireps_erfs/${erfId}`]: {
        erfId,
        admin: {
          localMunicipality: { pcode: "ZA5241" },
          ward: { pcode: "ZA524100005" },
        },
      },
      // TB-R048 field-work guard (1.3.33): the worker belongs to the TEAM the batch is allocated to.
      "teams/TEAM_1": {
        team: { status: "ACTIVE", name: "Team 1" },
        scope: { memberUserIds: ["USER_1"] },
      },
      "users/USER_1": {
        profile: { displayName: "Field Worker", employment: { role: "FWR" } },
      },
    },
  };
}

function buildPremisePayload(fixture, targetedBatchContext = {}) {
  return {
    id: fixture.premiseId,
    erfId: fixture.erfId,
    erfNo: "1018",
    address: {
      strNo: "1",
      strName: "Main",
      strType: "Street",
    },
    propertyType: {
      type: "Residential",
    },
    parents: {
      lmPcode: "ZA5241",
      wardPcode: "ZA524100005",
    },
    metadata: {},
    targetedBatchContext: {
      sourceModule: "SALES_TARGETED_BATCH",
      operationType: "METER_DISCOVERY",
      tbId: TB_ID,
      rowId: ROW_ID,
      rowNo: 1,
      salesDocId: fixture.salesDocId,
      erfId: fixture.erfId,
      ...targetedBatchContext,
    },
  };
}

function readPremiseCreateWrite(db, premiseId) {
  return db.transactionWrites.find(
    (write) =>
      write.type === "create" &&
      write.ref.path === `premises/${premiseId}`,
  );
}

test("authoritative TB-row source address is stored when mobile context has no source address", async () => {
  const fixture = buildLinkedFixture();
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);

  await createOrLinkTargetedBatchPremise({
    db,
    premiseRef,
    premisePayload: buildPremisePayload(fixture),
    actorUid: "USER_1",
    actorName: "Field Worker",
  });

  const premiseCreate = readPremiseCreateWrite(db, fixture.premiseId);
  assert.ok(premiseCreate);
  assert.equal(
    premiseCreate.value.targetedBatchContext.sourceAddress.addressLine1,
    "67 DAMMANN",
  );
  assert.equal(
    premiseCreate.value.targetedBatchContext.sourceAddress.town,
    "GLENCOE",
  );
  assert.equal(
    premiseCreate.value.targetedBatchContext.sourceModule,
    "SALES_TARGETED_BATCH",
  );
  assert.equal(
    premiseCreate.value.targetedBatchContext.operationType,
    "METER_DISCOVERY",
  );
  assert.equal(premiseCreate.value.targetedBatchContext.tbId, TB_ID);
  assert.equal(premiseCreate.value.targetedBatchContext.rowId, ROW_ID);
  assert.equal(
    premiseCreate.value.targetedBatchContext.salesDocId,
    fixture.salesDocId,
  );
  assert.equal(
    premiseCreate.value.targetedBatchContext.erfId,
    fixture.erfId,
  );
});

test("premise-start Sales write maintains updated* metadata when Sales metadata is active", async () => {
  const fixture = buildLinkedFixture();
  fixture.documents[`sales-all-meters/${fixture.salesDocId}`].metadata = {
    createdAt: { seconds: 1780272000, nanoseconds: 0 },
    createdByUid: "SPU_1",
    createdByUser: "System Power User",
    updatedAt: { seconds: 1782864000, nanoseconds: 0 },
    updatedByUid: "SPU_1",
    updatedByUser: "System Power User",
  };
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);

  await createOrLinkTargetedBatchPremise({
    db,
    premiseRef,
    premisePayload: buildPremisePayload(fixture),
    actorUid: "USER_1",
    actorName: "Field Worker One",
  });

  const sales = db.read(`sales-all-meters/${fixture.salesDocId}`);
  assert.equal(sales.metadata.createdByUid, "SPU_1");
  assert.equal(sales.metadata.createdByUser, "System Power User");
  assert.ok(sales.metadata.updatedAt);
  assert.equal(sales.metadata.updatedByUid, "USER_1");
  assert.equal(sales.metadata.updatedByUser, "Field Worker One");
});

test("authoritative TB-row source address overrides a conflicting mobile source address", async () => {
  const fixture = buildLinkedFixture();
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);

  await createOrLinkTargetedBatchPremise({
    db,
    premiseRef,
    premisePayload: buildPremisePayload(fixture, {
      sourceAddress: {
        addressLine1: "999 WRONG MOBILE ADDRESS",
        town: "WRONG MOBILE TOWN",
      },
    }),
    actorUid: "USER_1",
    actorName: "Field Worker",
  });

  const premiseCreate = readPremiseCreateWrite(db, fixture.premiseId);
  assert.ok(premiseCreate);
  assert.equal(
    premiseCreate.value.targetedBatchContext.sourceAddress.addressLine1,
    "67 DAMMANN",
  );
  assert.equal(
    premiseCreate.value.targetedBatchContext.sourceAddress.town,
    "GLENCOE",
  );
  assert.notEqual(
    premiseCreate.value.targetedBatchContext.sourceAddress.addressLine1,
    "999 WRONG MOBILE ADDRESS",
  );
  assert.notEqual(
    premiseCreate.value.targetedBatchContext.sourceAddress.town,
    "WRONG MOBILE TOWN",
  );
});

test("linked premise transaction starts TB execution and preserves Sales data", async () => {
  const fixture = buildLinkedFixture();
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);
  const payload = {
    id: fixture.premiseId,
    erfId: fixture.erfId,
    erfNo: "1018",
    address: {
      strNo: "1",
      strName: "Main",
      strType: "Street",
    },
    propertyType: {
      type: "Residential",
    },
    parents: {
      lmPcode: "ZA5241",
      wardPcode: "ZA524100005",
    },
    metadata: {},
    targetedBatchContext: {
      sourceModule: "SALES_TARGETED_BATCH",
      operationType: "METER_DISCOVERY",
      tbId: TB_ID,
      rowId: ROW_ID,
      rowNo: 1,
      salesDocId: fixture.salesDocId,
      erfId: fixture.erfId,
    },
  };

  const firstResult = await createOrLinkTargetedBatchPremise({
    db,
    premiseRef,
    premisePayload: payload,
    actorUid: "USER_1",
    actorName: "Field Worker",
  });

  assert.equal(firstResult.linked, true);
  assert.equal(firstResult.premiseCreated, true);
  assert.equal(firstResult.alreadyLinked, false);

  const parent = db.read(`tb_uploads/${TB_ID}`);
  const row = db.read(`tb_rows/${ROW_ID}`);
  const sales = db.read(`sales-all-meters/${fixture.salesDocId}`);
  const premise = db.read(`premises/${fixture.premiseId}`);

  assert.equal(parent.execution.status, "IN_PROGRESS");
  assert.equal(parent.status, "IN_PROGRESS", "rules section 14: the batch is In Progress once field work starts");
  assert.equal(parent.counts.executionStartedRows, 1);
  assert.equal(row.execution.status, "IN_PROGRESS");
  assert.equal(row.refs.premiseId, fixture.premiseId);
  assert.equal(sales.tbRefs.length, 1);
  assert.equal(sales.tbRefs[0].rowId, ROW_ID);
  assert.equal(sales.tbRefs[0].fieldWork.status, "IN_PROGRESS");
  assert.equal(
    sales.tbRefs[0].fieldWork.premiseId,
    fixture.premiseId,
  );
  assert.deepEqual(sales.geofenceRefs, [{ id: "GF_001" }]);
  assert.equal(sales.category, "CAT-1");
  assert.equal(
    premise.targetedBatchContext.salesDocId,
    fixture.salesDocId,
  );
  const premiseCreate = readPremiseCreateWrite(db, fixture.premiseId);
  assert.ok(premiseCreate);
  assert.deepEqual(
    premiseCreate.value.targetedBatchContext.sourceAddress,
    {
      addressLine1: "67 DAMMANN",
      town: "GLENCOE",
    },
  );

  const secondResult = await createOrLinkTargetedBatchPremise({
    db,
    premiseRef,
    premisePayload: payload,
    actorUid: "USER_1",
    actorName: "Field Worker",
  });

  assert.equal(secondResult.alreadyLinked, true);
  assert.equal(
    db.read(`tb_uploads/${TB_ID}`).counts.executionStartedRows,
    1,
  );
  assert.equal(
    db.read(`sales-all-meters/${fixture.salesDocId}`).tbRefs.length,
    1,
  );
  assert.equal(
    db.transactionWrites.filter(
      (write) =>
        write.type === "create" &&
        write.ref.path === `premises/${fixture.premiseId}`,
    ).length,
    1,
  );
});

test("linked helper failure creates no premise or partial linkage", async () => {
  const fixture = buildLinkedFixture();
  fixture.documents[`sales-all-meters/${fixture.salesDocId}`].tbRefs = [];
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);

  await assert.rejects(
    createOrLinkTargetedBatchPremise({
      db,
      premiseRef,
      premisePayload: {
        id: fixture.premiseId,
        erfId: fixture.erfId,
        parents: {
          lmPcode: "ZA5241",
          wardPcode: "ZA524100005",
        },
        targetedBatchContext: {
          sourceModule: "SALES_TARGETED_BATCH",
          operationType: "METER_DISCOVERY",
          tbId: TB_ID,
          rowId: ROW_ID,
          salesDocId: fixture.salesDocId,
          erfId: fixture.erfId,
        },
      },
      actorUid: "USER_1",
      actorName: "Field Worker",
    }),
    (error) => error?.irepsCode === "TARGETED_BATCH_MEMBERSHIP_CONFLICT",
  );

  assert.equal(db.read(`premises/${fixture.premiseId}`), undefined);
  assert.equal(db.read(`tb_rows/${ROW_ID}`).execution.status, "NOT_STARTED");
  assert.equal(
    db.read(`tb_uploads/${TB_ID}`).counts.executionStartedRows,
    0,
  );
});

// Rules section 14: the batch stays In Progress until every row is complete, then Completed.
async function linkThenDiscover(totalRows, capturedMeterNo = null) {
  const fixture = buildLinkedFixture();
  fixture.documents[`tb_uploads/${TB_ID}`].counts.totalRows = totalRows;
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);
  await createOrLinkTargetedBatchPremise({ db, premiseRef, premisePayload: buildPremisePayload(fixture), actorUid: "USER_1", actorName: "Field Worker" });
  assert.equal(db.read(`tb_uploads/${TB_ID}`).status, "IN_PROGRESS");
  const premise = db.read(`premises/${fixture.premiseId}`);
  const trnData = {
    id: "TRN_MDIS_TEST_1",
    targetedBatchContext: { ...premise.targetedBatchContext, premiseId: fixture.premiseId },
    accessData: { premise: { id: fixture.premiseId } },
    ast: { astData: { astNo: capturedMeterNo || fixture.salesDocId } },
    metadata: { createdByUid: "USER_1", createdByUser: "Field Worker" },
  };
  const result = await db.runTransaction((transaction) => completeTargetedBatchMeterDiscoveryInTransaction({
    transaction, db, trnData, astId: "TRN_MDIS_TEST_1", normalizedMeterNo: capturedMeterNo || fixture.salesDocId,
  }));
  return { db, result };
}

// Targeted Batch rules TB-R064 (1.3.67): a worker who captures a different number through the batch's own
// form records what was found on the row, so TB Register never shows the row's own meter as matched.
test("the batch form records the number found when it is not the row's own meter", async () => {
  const same = await linkThenDiscover(2);
  assert.equal(same.result.meterMatch, true);
  assert.equal(same.db.read(`tb_rows/${ROW_ID}`).execution.foundMeterNo, null);

  const different = await linkThenDiscover(2, "04298085599");
  assert.equal(different.result.meterMatch, false);
  assert.equal(different.db.read(`tb_rows/${ROW_ID}`).execution.foundMeterNo, "04298085599");
  assert.equal(different.db.read(`tb_rows/${ROW_ID}`).execution.status, "COMPLETED");
});

test("meter discovery completes the batch only when every row is complete", async () => {
  const single = await linkThenDiscover(1);
  assert.equal(single.result.batchCompleted, true);
  assert.equal(single.db.read(`tb_uploads/${TB_ID}`).status, "COMPLETED");
  assert.equal(single.db.read(`tb_uploads/${TB_ID}`).execution.status, "COMPLETED");

  const oneOfTwo = await linkThenDiscover(2);
  assert.equal(oneOfTwo.result.batchCompleted, false);
  assert.equal(oneOfTwo.db.read(`tb_uploads/${TB_ID}`).status, "IN_PROGRESS");
  assert.equal(oneOfTwo.db.read(`tb_uploads/${TB_ID}`).execution.status, "IN_PROGRESS");
});

// Targeted Batch rules TB-R048 field-work guard (1.3.33): only an FWR or SPV of the allocated TEAM or SP
// may start a row, so a premise captured before an unallocation cannot start a row after reallocation.
// Work on a batched meter belongs to the batch's team (TB-R059), so an outsider is turned away by that
// rule first, in the sentence naming the batch, its geofence, the team and the date.
test("a worker outside the allocated TEAM cannot start a row, and nothing is written", async () => {
  const fixture = buildLinkedFixture();
  fixture.documents["users/OUTSIDER"] = { profile: { displayName: "Outsider", employment: { role: "FWR" } } };
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);
  await assert.rejects(
    createOrLinkTargetedBatchPremise({ db, premiseRef, premisePayload: buildPremisePayload(fixture), actorUid: "OUTSIDER", actorName: "Outsider" }),
    { code: "METER_IN_ANOTHER_TEAMS_BATCH" },
  );
  assert.equal(db.transactionWrites.length, 0);
  assert.equal(db.read(`tb_rows/${ROW_ID}`).execution.status, "NOT_STARTED");
});

// TB-R059 lets the worker through on their open team membership (TM-R001); the TB-R048 field-work guard
// still has the last word, because the allocated TEAM does not list them.
test("the field-work guard still refuses a worker the allocated TEAM does not list", async () => {
  const fixture = buildLinkedFixture();
  fixture.documents["users/OUTSIDER"] = { profile: { displayName: "Outsider", employment: { role: "FWR" } } };
  fixture.documents["team_member_history/TEAM_1__OUTSIDER__1"] = {
    id: "TEAM_1__OUTSIDER__1", teamId: "TEAM_1", userUid: "OUTSIDER", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null,
  };
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);
  await assert.rejects(
    createOrLinkTargetedBatchPremise({ db, premiseRef, premisePayload: buildPremisePayload(fixture), actorUid: "OUTSIDER", actorName: "Outsider" }),
    { code: "TARGETED_BATCH_NOT_ASSIGNED_TO_ACTOR" },
  );
  assert.equal(db.transactionWrites.length, 0);
  assert.equal(db.read(`tb_rows/${ROW_ID}`).execution.status, "NOT_STARTED");
});

test("a manager is not a field worker and cannot start a row either", async () => {
  const fixture = buildLinkedFixture();
  fixture.documents["users/USER_1"] = { profile: { displayName: "Manager", employment: { role: "MNG" } } };
  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);
  await assert.rejects(
    createOrLinkTargetedBatchPremise({ db, premiseRef, premisePayload: buildPremisePayload(fixture), actorUid: "USER_1", actorName: "Manager" }),
    { code: "TARGETED_BATCH_ACCESS_DENIED" },
  );
  assert.equal(db.transactionWrites.length, 0);
});

test("the premise callable passes the caller's token to the guard", async () => {
  const indexSource = await readFile(new URL("../index.js", import.meta.url), "utf8");
  assert.match(indexSource, /actorUid: caller\.uid,\s*actorName,\s*authToken: caller\.token \|\| \{\},/);
});

// TB-R067 (1.3.73): at ERF 689 thirteen businesses share one address. The worker presses Premise on a row,
// picks the shop that was already captured there, types its real business name, and submits. The premise
// must be joined to that row AND must keep what was typed - and nothing captured on another screen may move.
test("a premise that was already there is joined and keeps what the worker typed", async () => {
  const fixture = buildLinkedFixture();

  fixture.documents[`premises/${fixture.premiseId}`] = {
    id: fixture.premiseId,
    erfId: fixture.erfId,
    erfNo: "1018",
    address: { strNo: "26", strName: "Old Acre", strType: "Street" },
    propertyType: { type: "Commercial", name: "Shop", unitNo: "2" },
    occupancy: { status: "Occupied" },
    parents: { lmPcode: "ZA5241", wardPcode: "ZA524100005" },
    // Captured on other screens. TB-R067 never touches these.
    accountData: { account: { accountNo: "0002139405" } },
    services: { electricityMeters: [{ id: "AST_1" }] },
    noAccessTrnIds: ["TRN_NA_1"],
    metadata: { createdByUid: "USER_0" },
  };

  const db = new FakeFirestore(fixture.documents);
  const premiseRef = db.collection("premises").doc(fixture.premiseId);

  const result = await createOrLinkTargetedBatchPremise({
    db,
    premiseRef,
    premisePayload: {
      id: fixture.premiseId,
      erfId: fixture.erfId,
      erfNo: "1018",
      address: { strNo: "26", strName: "Old Acre", strType: "Street" },
      propertyType: { type: "Commercial", name: "TFS Wholesalers", unitNo: "7" },
      occupancy: { status: "Occupied" },
      media: [{ tag: "premisePhoto", url: "https://example/premise.jpg" }],
      parents: { lmPcode: "ZA5241", wardPcode: "ZA524100005" },
      metadata: {},
      targetedBatchContext: {
        sourceModule: "SALES_TARGETED_BATCH",
        operationType: "METER_DISCOVERY",
        tbId: TB_ID,
        rowId: ROW_ID,
        rowNo: 1,
        salesDocId: fixture.salesDocId,
        erfId: fixture.erfId,
      },
    },
    actorUid: "USER_1",
    actorName: "Field Worker",
  });

  assert.equal(result.linked, true);
  assert.equal(result.premiseCreated, false, "the premise was already standing there");

  const row = db.read(`tb_rows/${ROW_ID}`);
  const premise = db.read(`premises/${fixture.premiseId}`);

  assert.equal(row.refs.premiseId, fixture.premiseId, "the row is joined to it");
  assert.equal(premise.targetedBatchContext.rowId, ROW_ID, "and it carries its row");

  assert.equal(premise.propertyType.name, "TFS Wholesalers", "the business name the worker typed is saved");
  assert.equal(premise.propertyType.unitNo, "7");
  assert.equal(premise.media.length, 1, "the photo taken on the form is on the premise, not orphaned");

  assert.equal(premise.accountData.account.accountNo, "0002139405", "account data is untouched");
  assert.deepEqual(premise.services.electricityMeters, [{ id: "AST_1" }], "its meters are untouched");
  assert.deepEqual(premise.noAccessTrnIds, ["TRN_NA_1"], "its No Access history is untouched");
  assert.equal(premise.metadata.updatedByUid, "USER_1");
});

// TB-R067 (1.3.73) 6: a wrong join can be put right, but only while nothing hangs on the premise being left.
test("a row can be moved to another premise, and the one it leaves goes back to Not joined", async () => {
  const fixture = buildLinkedFixture();
  const wrongPremiseId = "PRM_WRONG";
  const rightPremiseId = fixture.premiseId;

  fixture.documents[`premises/${wrongPremiseId}`] = {
    id: wrongPremiseId,
    erfId: fixture.erfId,
    parents: { lmPcode: "ZA5241", wardPcode: "ZA524100005" },
    propertyType: { type: "Commercial", name: "Kwik Fit", unitNo: "1" },
    targetedBatchContext: {
      sourceModule: "SALES_TARGETED_BATCH",
      operationType: "METER_DISCOVERY",
      tbId: TB_ID,
      rowId: ROW_ID,
      salesDocId: fixture.salesDocId,
      erfId: fixture.erfId,
    },
    metadata: {},
  };
  fixture.documents[`tb_rows/${ROW_ID}`].refs = {
    ...fixture.documents[`tb_rows/${ROW_ID}`].refs,
    premiseId: wrongPremiseId,
  };

  const db = new FakeFirestore(fixture.documents);
  const payload = {
    id: rightPremiseId,
    erfId: fixture.erfId,
    erfNo: "1018",
    address: { strNo: "26", strName: "Old Acre", strType: "Street" },
    propertyType: { type: "Commercial", name: "TFS Wholesalers", unitNo: "2" },
    parents: { lmPcode: "ZA5241", wardPcode: "ZA524100005" },
    metadata: {},
    targetedBatchContext: {
      sourceModule: "SALES_TARGETED_BATCH",
      operationType: "METER_DISCOVERY",
      tbId: TB_ID,
      rowId: ROW_ID,
      rowNo: 1,
      salesDocId: fixture.salesDocId,
      erfId: fixture.erfId,
    },
  };

  // Without naming the premise it is leaving, nothing moves.
  await assert.rejects(
    createOrLinkTargetedBatchPremise({
      db,
      premiseRef: db.collection("premises").doc(rightPremiseId),
      premisePayload: payload,
      actorUid: "USER_1",
      actorName: "Field Worker",
    }),
    (error) => error.code === "TARGETED_BATCH_PREMISE_CONFLICT" || /another premise/.test(error.message),
  );

  const moved = await createOrLinkTargetedBatchPremise({
    db,
    premiseRef: db.collection("premises").doc(rightPremiseId),
    premisePayload: payload,
    actorUid: "USER_1",
    actorName: "Field Worker",
    replacesPremiseId: wrongPremiseId,
  });

  assert.equal(moved.linked, true);
  assert.equal(db.read(`tb_rows/${ROW_ID}`).refs.premiseId, rightPremiseId, "the row moved");
  assert.equal(
    db.read(`premises/${wrongPremiseId}`).targetedBatchContext,
    null,
    "the premise it left is free for the row it really belongs to",
  );
  assert.equal(
    db.read(`premises/${wrongPremiseId}`).propertyType.name,
    "Kwik Fit",
    "and nothing else about it changed",
  );
});

test("a row whose premise already has a meter cannot be moved", async () => {
  const fixture = buildLinkedFixture();
  const wrongPremiseId = "PRM_WRONG";

  fixture.documents[`premises/${wrongPremiseId}`] = {
    id: wrongPremiseId,
    erfId: fixture.erfId,
    parents: { lmPcode: "ZA5241", wardPcode: "ZA524100005" },
    propertyType: { type: "Commercial", name: "Kwik Fit", unitNo: "1" },
    metadata: {},
  };
  fixture.documents[`tb_rows/${ROW_ID}`].refs = {
    ...fixture.documents[`tb_rows/${ROW_ID}`].refs,
    premiseId: wrongPremiseId,
    meterId: "AST_1",
  };

  const db = new FakeFirestore(fixture.documents);

  await assert.rejects(
    createOrLinkTargetedBatchPremise({
      db,
      premiseRef: db.collection("premises").doc(fixture.premiseId),
      premisePayload: {
        id: fixture.premiseId,
        erfId: fixture.erfId,
        parents: { lmPcode: "ZA5241", wardPcode: "ZA524100005" },
        propertyType: { type: "Commercial", name: "TFS Wholesalers", unitNo: "2" },
        metadata: {},
        targetedBatchContext: {
          sourceModule: "SALES_TARGETED_BATCH",
          operationType: "METER_DISCOVERY",
          tbId: TB_ID,
          rowId: ROW_ID,
          salesDocId: fixture.salesDocId,
          erfId: fixture.erfId,
        },
      },
      actorUid: "USER_1",
      actorName: "Field Worker",
      replacesPremiseId: wrongPremiseId,
    }),
    (error) => error.code === "TARGETED_BATCH_PREMISE_HAS_METER",
  );

  assert.equal(db.read(`tb_rows/${ROW_ID}`).refs.premiseId, wrongPremiseId, "nothing moved");
});
