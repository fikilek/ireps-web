import assert from "node:assert/strict";
import test from "node:test";

import {
  TARGETED_BATCH_PLANNING_MODES,
  isSubcontractorServiceProvider,
  resolveTargetedBatchCreateAuthority,
  validateAuthoritativeSalesDocument,
  validateCreateTargetedBatchPayload,
} from "../targetedBatches/helpers.js";

function makeNgpDraft(rowCount = 2) {
  const tbId = "TGB_20260816_044220_AB12";
  const ids = Array.from(
    { length: rowCount },
    (_, index) => `071000000${String(index).padStart(2, "0")}`,
  );
  const rows = ids.map((id, index) => ({
    rowNo: String(index + 1),
    salesAllMeterId: id,
    sourceSalesAllMeterId: id,
    meterNo: id,
    lmPcode: "ZA5241",
    proposedTbId: tbId,
    draftBatchKey: `NGP::${tbId}`,
    planning: {
      mode: TARGETED_BATCH_PLANNING_MODES.nonGpsStreet,
      townKey: "dundee",
      streetKey: `dundee::street ${index + 1}`,
      streetNameKey: `street ${index + 1}`,
      strNo: String(index + 1),
      strName: `Street ${index + 1}`,
      strType: "Street",
    },
  }));

  return {
    id: tbId,
    creationGroup: {
      id: "TBCG_20260816_044220_AB12",
      proposedBatchCount: 1,
    },
    source: {
      type: "PREPAID_SALES",
      label: "Prepaid Sales",
    },
    scope: {
      lmPcode: "ZA5241",
      lmName: "Endumeni",
    },
    selection: {
      reason: "Selected from Non GPS Batch Planning",
      planningMode: TARGETED_BATCH_PLANNING_MODES.nonGpsStreet,
    },
    authoritativeIds: {
      salesAllMeterIds: ids,
      uploadRowIds: [],
    },
    proposedBatches: [
      {
        tbId,
        draftBatchKey: `NGP::${tbId}`,
        sequence: 1,
        scope: {
          lmPcode: "ZA5241",
          lmName: "Endumeni",
          wardPcode: "",
          wardNumber: "",
          wardName: "",
        },
        salesAllMeterIds: ids,
        rows,
      },
    ],
    displayRows: rows,
    validation: {
      passed: true,
      status: "PASSED",
      errors: [],
      warnings: [],
      planningMode: TARGETED_BATCH_PLANNING_MODES.nonGpsStreet,
    },
  };
}

function makeSnapshot({
  id = "07100000000",
  gps = false,
  tbRefs = [],
  town = "Dundee",
  strNo = "1",
  strName = "Street 1",
  strType = "Street",
} = {}) {
  return {
    exists: true,
    id,
    ref: { path: `sales-all-meters/${id}` },
    data() {
      return {
        meterNo: id,
        lmPcode: "ZA5241",
        HasUsableGps: gps,
        tbRefs,
        town,
        adr: { strNo, strName, strType },
      };
    },
  };
}

test("NGP create payload accepts one 1-20 batch without ward scope", () => {
  const result = validateCreateTargetedBatchPayload({
    draft: makeNgpDraft(20),
  });

  assert.equal(result.ok, true);
  assert.equal(result.proposedBatches.length, 1);
  assert.equal(result.proposedBatches[0].expectedRows, 20);
  assert.equal(result.proposedBatches[0].scope.wardPcode, "");
});

test("NGP create payload rejects more than 20 rows", () => {
  const result = validateCreateTargetedBatchPayload({
    draft: makeNgpDraft(21),
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("at most 20")));
});

test("NGP create payload rejects more than one proposed batch", () => {
  const draft = makeNgpDraft(2);
  draft.proposedBatches.push({
    ...draft.proposedBatches[0],
    tbId: "TGB_20260816_044221_CD34",
    draftBatchKey: "NGP::TGB_20260816_044221_CD34",
  });

  const result = validateCreateTargetedBatchPayload({ draft });

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((message) =>
      message.includes("exactly one proposed Targeted Batch"),
    ),
  );
});

test("authoritative NGP Sales validation does not require ERF but requires unchanged no-GPS street truth", () => {
  const row = makeNgpDraft(1).displayRows[0];
  const result = validateAuthoritativeSalesDocument({
    snapshot: makeSnapshot(),
    expectedSalesId: "07100000000",
    expectedLmPcode: "ZA5241",
    expectedTbId: "TGB_20260816_044220_AB12",
    planningMode: TARGETED_BATCH_PLANNING_MODES.nonGpsStreet,
    draftRow: row,
  });

  assert.equal(result.ok, true);
  assert.equal(result.erfReference, null);
});

test("authoritative NGP Sales validation fails if GPS or another TB appears after selection", () => {
  const row = makeNgpDraft(1).displayRows[0];

  const gpsResult = validateAuthoritativeSalesDocument({
    snapshot: makeSnapshot({ gps: true }),
    expectedSalesId: "07100000000",
    expectedLmPcode: "ZA5241",
    expectedTbId: "TGB_20260816_044220_AB12",
    planningMode: TARGETED_BATCH_PLANNING_MODES.nonGpsStreet,
    draftRow: row,
  });
  assert.equal(gpsResult.code, "NGP_SALES_NOW_HAS_GPS");

  const tbResult = validateAuthoritativeSalesDocument({
    snapshot: makeSnapshot({
      tbRefs: [{ id: "TGB_20260816_010101_ZZ99" }],
    }),
    expectedSalesId: "07100000000",
    expectedLmPcode: "ZA5241",
    expectedTbId: "TGB_20260816_044220_AB12",
    planningMode: TARGETED_BATCH_PLANNING_MODES.nonGpsStreet,
    draftRow: row,
  });
  assert.equal(tbResult.code, "NGP_SALES_ALREADY_BATCHED");
});

test("authoritative NGP Sales validation fails if Town / street changes after selection", () => {
  const row = makeNgpDraft(1).displayRows[0];

  const result = validateAuthoritativeSalesDocument({
    snapshot: makeSnapshot({ strName: "Different Street" }),
    expectedSalesId: "07100000000",
    expectedLmPcode: "ZA5241",
    expectedTbId: "TGB_20260816_044220_AB12",
    planningMode: TARGETED_BATCH_PLANNING_MODES.nonGpsStreet,
    draftRow: row,
  });

  assert.equal(result.code, "NGP_AUTHORITATIVE_PLANNING_CHANGED");
});

function makeAuthorityDb({ user, serviceProviders = {} } = {}) {
  return {
    doc(path) {
      return {
        async get() {
          if (path.startsWith("users/")) {
            return {
              exists: Boolean(user),
              data: () => user || {},
            };
          }

          if (path.startsWith("userProfiles/") || path.startsWith("profiles/")) {
            return {
              exists: false,
              data: () => ({}),
            };
          }

          if (path.startsWith("serviceProviders/")) {
            const id = path.split("/")[1];
            const provider = serviceProviders[id];
            return {
              exists: Boolean(provider),
              data: () => provider || {},
            };
          }

          throw new Error(`Unexpected Firestore path in authority test: ${path}`);
        },
      };
    },
  };
}

function makeAuthorityRequest(uid = "actor-uid") {
  return {
    auth: {
      uid,
      token: {},
    },
  };
}

test("service-provider hierarchy detects SUBC only from SP/SUBC client relationship", () => {
  assert.equal(
    isSubcontractorServiceProvider({
      clients: [{ clientType: "SP", relationshipType: "SUBC" }],
    }),
    true,
  );

  assert.equal(
    isSubcontractorServiceProvider({
      clients: [{ clientType: "LM", relationshipType: "MNC" }],
    }),
    false,
  );
});

test("Targeted Batch authority allows MNG without LM or service-provider hierarchy validation", async () => {
  const result = await resolveTargetedBatchCreateAuthority({
    db: makeAuthorityDb({
      user: {
        employment: {
          role: "MNG",
          serviceProvider: { id: "RSTE", name: "RSTE" },
        },
      },
    }),
    request: makeAuthorityRequest(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.role, "MNG");
});

test("Targeted Batch authority allows SPV attached to a main service provider", async () => {
  const result = await resolveTargetedBatchCreateAuthority({
    db: makeAuthorityDb({
      user: {
        employment: {
          role: "SPV",
          serviceProvider: { id: "RSTE", name: "RSTE" },
        },
      },
      serviceProviders: {
        RSTE: {
          profile: { tradingName: "RSTE" },
          clients: [{ clientType: "LM", relationshipType: "MNC" }],
        },
      },
    }),
    request: makeAuthorityRequest(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.role, "SPV");
  assert.equal(result.serviceProviderId, "RSTE");
  assert.equal(result.serviceProviderFound, true);
  assert.equal(result.isSubcontractor, false);
});

test("Targeted Batch authority denies SPV attached to a SUBC service provider", async () => {
  const result = await resolveTargetedBatchCreateAuthority({
    db: makeAuthorityDb({
      user: {
        employment: {
          role: "SPV",
          serviceProvider: { id: "THATO", name: "Thato Engineers" },
        },
      },
      serviceProviders: {
        THATO: {
          clients: [
            {
              id: "RSTE",
              name: "RSTE",
              clientType: "SP",
              relationshipType: "SUBC",
            },
          ],
        },
      },
    }),
    request: makeAuthorityRequest(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.role, "SPV");
  assert.equal(result.serviceProviderId, "THATO");
  assert.equal(result.isSubcontractor, true);
  assert.equal(result.relationshipType, "SUBC");
});

test("Targeted Batch authority fails closed when SPV service-provider document is missing", async () => {
  const result = await resolveTargetedBatchCreateAuthority({
    db: makeAuthorityDb({
      user: {
        employment: {
          role: "SPV",
          serviceProvider: { id: "MISSING", name: "Missing SP" },
        },
      },
    }),
    request: makeAuthorityRequest(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.serviceProviderFound, false);
});

test("Targeted Batch authority denies non-MNG non-SPV roles", async () => {
  const result = await resolveTargetedBatchCreateAuthority({
    db: makeAuthorityDb({
      user: {
        employment: {
          role: "FWR",
          serviceProvider: { id: "RSTE", name: "RSTE" },
        },
      },
    }),
    request: makeAuthorityRequest(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.role, "FWR");
});

