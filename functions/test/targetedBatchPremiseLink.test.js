import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertCompleteTargetedBatchPremiseContext,
  buildSalesTbRefsForPremiseStart,
  classifyTargetedBatchPremiseRoute,
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
    id: "TGB_OTHER",
    date: "OTHER_DATE",
    fieldWork: {
      status: "COMPLETED",
      premiseId: "PRM_OTHER",
    },
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
        date: "DATE",
        fieldWork: {
          status: "IN_PROGRESS",
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
            rowId: ROW_ID,
            fieldWork: {
              status: "IN_PROGRESS",
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
    (error) => error.irepsCode === "SALES_TB_REF_NOT_FOUND",
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
    (error) => error.irepsCode === "SALES_TB_REF_DUPLICATE",
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
    };
  }

  read(path) {
    return cloneValue(this.documents.get(path));
  }

  async runTransaction(callback) {
    const writes = [];

    const transaction = {
      get: async (ref) =>
        new FakeDocumentSnapshot(
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
        allocation: { status: "ALLOCATED" },
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
      [`demo_sales_meters/${salesDocId}`]: {
        meterNo: salesDocId,
        geofenceRefs: [{ id: "GF_001" }],
        category: "CAT-1",
        tbRefs: [
          {
            id: TB_ID,
            date: "CREATION_DATE",
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
  const sales = db.read(`demo_sales_meters/${fixture.salesDocId}`);
  const premise = db.read(`premises/${fixture.premiseId}`);

  assert.equal(parent.execution.status, "IN_PROGRESS");
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
    db.read(`demo_sales_meters/${fixture.salesDocId}`).tbRefs.length,
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
  fixture.documents[`demo_sales_meters/${fixture.salesDocId}`].tbRefs = [];
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
    (error) => error?.irepsCode === "SALES_TB_REF_NOT_FOUND",
  );

  assert.equal(db.read(`premises/${fixture.premiseId}`), undefined);
  assert.equal(db.read(`tb_rows/${ROW_ID}`).execution.status, "NOT_STARTED");
  assert.equal(
    db.read(`tb_uploads/${TB_ID}`).counts.executionStartedRows,
    0,
  );
});
