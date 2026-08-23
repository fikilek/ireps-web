import assert from "node:assert/strict";
import test from "node:test";

import {
  SALES_PLANNING_STATES,
  buildGeofencePlanningDraftStats,
  buildGeofencePlanningModel,
  buildSalesPlanningRecords,
  classifySalesPlanningState,
  getCanonicalAstId,
  isNormalSalesPlanningCategory,
  normalizePlanningAssets,
  normalizePlanningPremises,
  summarizeSalesPlanningRecords,
} from "./geofencePlanningModel.js";

const LM = "ZA5241";
const WARD = "ZA5241003";

function candidate({
  lmPcode = LM,
  wardPcode = WARD,
  lat = -26.5,
  lng = 28.5,
  erfId = "ERF_1",
  erfNumber = "100",
} = {}) {
  return {
    lmPcode,
    wardPcode,
    latitude: lat,
    longitude: lng,
    erfId,
    erfNumber,
    hasValidGps: true,
  };
}

function salesRow({
  id = "SALES_1",
  leakageCategory = "CAT1 - Zero Purchaser",
  geofenceGpsEligible = true,
  hasUsableGps = true,
  erfCandidates = [candidate()],
  tbRefs = [],
  tbRefsIntegrity = { valid: true, issues: [] },
} = {}) {
  return {
    id,
    meterNo: `METER_${id}`,
    leakageCategory,
    geofenceGpsEligible,
    hasUsableGps,
    erfCandidates,
    tbRefs,
    tbRefsIntegrity,
  };
}

function tbRef(status) {
  return {
    id: `TB_${status}`,
    fieldWork: status ? { status } : null,
  };
}

function square() {
  return [
    { lat: -26.6, lng: 28.4 },
    { lat: -26.4, lng: 28.4 },
    { lat: -26.4, lng: 28.6 },
    { lat: -26.6, lng: 28.6 },
  ];
}

test("Normal Sales category is excluded before GPS and lifecycle planning", () => {
  const normal = salesRow({
    id: "NORMAL",
    leakageCategory: "Normal - No Leakage Flag",
  });
  const records = buildSalesPlanningRecords({
    salesRows: [normal],
    lmPcode: LM,
    wardPcode: WARD,
  });

  assert.equal(isNormalSalesPlanningCategory(normal), true);
  assert.deepEqual(records, []);
});

test("non-Normal CAT Sales rows remain eligible for planning", () => {
  const cat1 = salesRow({
    id: "CAT1",
    leakageCategory: "CAT1 - Zero Purchaser",
  });
  const records = buildSalesPlanningRecords({
    salesRows: [cat1],
    lmPcode: LM,
    wardPcode: WARD,
  });

  assert.equal(isNormalSalesPlanningCategory(cat1), false);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, "CAT1");
});

test("Geofence planning Sales counts exclude Normal category rows", () => {
  const model = buildGeofencePlanningModel({
    lmPcode: LM,
    wardPcode: WARD,
    salesRows: [
      salesRow({
        id: "NORMAL",
        leakageCategory: "Normal - No Leakage Flag",
      }),
      salesRow({
        id: "CAT1",
        leakageCategory: "CAT1 - Zero Purchaser",
      }),
    ],
  });

  assert.equal(model.salesRecords.length, 1);
  assert.equal(model.salesRecords[0].id, "CAT1");
  assert.equal(model.salesSummary.total, 1);
  assert.equal(model.salesSummary.notTouched, 1);
});

test("planning requires the raw backend-parity Sales GPS flag", () => {
  const records = buildSalesPlanningRecords({
    lmPcode: LM,
    wardPcode: WARD,
    salesRows: [
      salesRow({
        id: "DERIVED_ONLY",
        geofenceGpsEligible: false,
        hasUsableGps: true,
      }),
      salesRow({
        id: "RAW_TRUE",
        geofenceGpsEligible: true,
        hasUsableGps: false,
      }),
    ],
  });

  assert.deepEqual(records.map((record) => record.id), ["RAW_TRUE"]);
});

test("Sales candidate scope requires exact LM and ward pcodes", () => {
  const records = buildSalesPlanningRecords({
    lmPcode: " za5241 ",
    wardPcode: "za5241003",
    salesRows: [
      salesRow({
        id: "MATCH",
        erfCandidates: [candidate({ lmPcode: "za5241", wardPcode: "ZA5241003" })],
      }),
      salesRow({
        id: "WRONG_LM",
        erfCandidates: [candidate({ lmPcode: "ZA9999" })],
      }),
      salesRow({
        id: "WRONG_WARD",
        erfCandidates: [candidate({ wardPcode: "ZA5241004" })],
      }),
      salesRow({
        id: "WARD_NUMBER_ONLY",
        erfCandidates: [
          {
            ...candidate(),
            wardPcode: "",
            wardNumber: "3",
          },
        ],
      }),
    ],
  });

  assert.deepEqual(records.map((record) => record.id), ["MATCH"]);
});

test("multiple matching Sales candidates render but count one Sales document", () => {
  const records = buildSalesPlanningRecords({
    lmPcode: LM,
    wardPcode: WARD,
    salesRows: [
      salesRow({
        id: "MULTI",
        erfCandidates: [
          candidate({ erfId: "ERF_1", lat: -26.50, lng: 28.50 }),
          candidate({ erfId: "ERF_2", lat: -26.51, lng: 28.51 }),
        ],
      }),
    ],
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].candidates.length, 2);
  assert.equal(summarizeSalesPlanningRecords(records).total, 1);

  const stats = buildGeofencePlanningDraftStats({
    draftPoints: square(),
    salesRecords: records,
  });

  assert.equal(stats.sales.total, 1);
  assert.equal(stats.sales.notTouched, 1);
});

test("Sales fieldwork precedence is COMPLETED over IN_PROGRESS over NOT TOUCHED", () => {
  assert.equal(
    classifySalesPlanningState(salesRow()).state,
    SALES_PLANNING_STATES.NOT_TOUCHED,
  );

  assert.equal(
    classifySalesPlanningState(
      salesRow({ tbRefs: [tbRef("NOT_STARTED")] }),
    ).state,
    SALES_PLANNING_STATES.NOT_TOUCHED,
  );

  assert.equal(
    classifySalesPlanningState(
      salesRow({ tbRefs: [tbRef("NOT_STARTED"), tbRef("IN_PROGRESS")] }),
    ).state,
    SALES_PLANNING_STATES.IN_PROGRESS,
  );

  assert.equal(
    classifySalesPlanningState(
      salesRow({ tbRefs: [tbRef("IN_PROGRESS"), tbRef("COMPLETED")] }),
    ).state,
    SALES_PLANNING_STATES.COMPLETED,
  );
});

test("invalid tbRefs integrity and unknown fieldwork fail closed", () => {
  const invalidIntegrity = classifySalesPlanningState(
    salesRow({
      tbRefsIntegrity: { valid: false, issues: ["tbRefs.0.id"] },
    }),
  );
  assert.equal(
    invalidIntegrity.state,
    SALES_PLANNING_STATES.INTEGRITY_EXCEPTION,
  );

  const unknownStatus = classifySalesPlanningState(
    salesRow({ tbRefs: [tbRef("BOGUS")] }),
  );
  assert.equal(
    unknownStatus.state,
    SALES_PLANNING_STATES.INTEGRITY_EXCEPTION,
  );
});

test("Sales valid total equals three operational buckets and excludes integrity", () => {
  const records = buildSalesPlanningRecords({
    lmPcode: LM,
    wardPcode: WARD,
    salesRows: [
      salesRow({ id: "N" }),
      salesRow({ id: "I", tbRefs: [tbRef("IN_PROGRESS")] }),
      salesRow({ id: "C", tbRefs: [tbRef("COMPLETED")] }),
      salesRow({
        id: "X",
        tbRefsIntegrity: { valid: false, issues: ["tbRefs"] },
      }),
    ],
  });

  const summary = summarizeSalesPlanningRecords(records);

  assert.equal(summary.notTouched, 1);
  assert.equal(summary.inProgress, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.integrityExceptions, 1);
  assert.equal(
    summary.total,
    summary.notTouched + summary.inProgress + summary.completed,
  );
});

test("premises are filtered by both page LM and ward after ward query", () => {
  const premises = normalizePlanningPremises({
    lmPcode: LM,
    wardPcode: WARD,
    premises: [
      {
        id: "P1",
        lmPcode: LM,
        wardPcode: WARD,
        geometry: { centroid: { lat: -26.5, lng: 28.5 } },
      },
      {
        id: "P_WRONG_LM",
        lmPcode: "ZA9999",
        wardPcode: WARD,
        geometry: { centroid: { lat: -26.5, lng: 28.5 } },
      },
    ],
  });

  assert.deepEqual(premises.map((premise) => premise.id), ["P1"]);
});

test("Assets require exact scope, non-REMOVED state and AST GPS only", () => {
  const makeAsset = ({
    id,
    lmPcode = LM,
    wardPcode = WARD,
    status = "ACTIVE",
    gps = { lat: -26.5, lng: 28.5 },
    premiseCentroid = null,
  }) => ({
    id,
    status,
    accessData: { parents: { lmPcode, wardPcode } },
    ast: gps ? { location: { gps }, astData: { astNo: id } } : { astData: { astNo: id } },
    geometry: premiseCentroid ? { centroid: premiseCentroid } : undefined,
  });

  const assets = normalizePlanningAssets({
    lmPcode: LM,
    wardPcode: WARD,
    assets: [
      makeAsset({ id: "A1" }),
      makeAsset({ id: "REMOVED", status: "REMOVED" }),
      makeAsset({ id: "NO_GPS", gps: null, premiseCentroid: { lat: -26.5, lng: 28.5 } }),
      makeAsset({ id: "WRONG_LM", lmPcode: "ZA9999" }),
      makeAsset({ id: "WRONG_WARD", wardPcode: "ZA5241004" }),
    ],
  });

  assert.deepEqual(assets.map((asset) => asset.id), ["A1"]);
});

test("canonical AST identity matches decorated no-geofence rows", () => {
  assert.equal(
    getCanonicalAstId({ __astId: "AST_1", id: "DOC_1" }),
    "AST_1",
  );
  assert.equal(getCanonicalAstId({ id: "AST_1" }), "AST_1");
});

test("general Assets renderer excludes no-geofence IDs without removing draft population", () => {
  const model = buildGeofencePlanningModel({
    lmPcode: LM,
    wardPcode: WARD,
    draftPoints: square(),
    assets: [
      {
        id: "AST_1",
        status: "ACTIVE",
        accessData: { parents: { lmPcode: LM, wardPcode: WARD } },
        ast: {
          location: { gps: { lat: -26.5, lng: 28.5 } },
          astData: { astNo: "M1" },
        },
      },
      {
        id: "AST_2",
        status: "ACTIVE",
        accessData: { parents: { lmPcode: LM, wardPcode: WARD } },
        ast: {
          location: { gps: { lat: -26.51, lng: 28.51 } },
          astData: { astNo: "M2" },
        },
      },
    ],
    noGeofenceMeters: [{ __astId: "AST_1", id: "AST_1" }],
  });

  assert.deepEqual(model.assets.map((asset) => asset.id), ["AST_1", "AST_2"]);
  assert.deepEqual(model.generalAssets.map((asset) => asset.id), ["AST_2"]);
  assert.equal(model.draftStats.assets, 2);
});

test("draft stats include all Sales states regardless of rendering filters", () => {
  const model = buildGeofencePlanningModel({
    lmPcode: LM,
    wardPcode: WARD,
    draftPoints: square(),
    salesRows: [
      salesRow({ id: "N" }),
      salesRow({ id: "I", tbRefs: [tbRef("IN_PROGRESS")] }),
      salesRow({ id: "C", tbRefs: [tbRef("COMPLETED")] }),
      salesRow({
        id: "X",
        tbRefsIntegrity: { valid: false, issues: ["tbRefs"] },
      }),
    ],
  });

  assert.deepEqual(model.draftStats.sales, {
    total: 3,
    notTouched: 1,
    inProgress: 1,
    completed: 1,
    integrityExceptions: 1,
  });
});
