import test from "node:test";
import assert from "node:assert/strict";
import {
  PREMISE_QA_FAILURE_REASONS,
  computePremiseDigest,
  premiseReviewAccess,
  projectPremiseQaToTbRow,
  invalidatePremiseQaIfSubstantive,
} from "../functions/qa/premiseQaReview.js";
import { buildPremiseRegistryRow } from "../functions/registry/premiseRegistryRowBuilder.js";

test("computePremiseDigest computes SHA-256 over substantive fields and ignores system metadata", () => {
  const basePremise = {
    address: { strNo: "12", strName: "Victoria", strType: "Street", suburb: "Central" },
    propertyType: { type: "Residential", name: "Single Residential" },
    occupancy: { status: "Occupied" },
    geometry: { location: { lat: -28.156, lng: 30.334 } },
    media: [{ tag: "Front Facade", url: "https://example.com/front.jpg" }],
    erfNo: "5224",
    metadata: { updatedAt: "2026-10-21T06:00:00Z", updatedByUser: "Alice" },
  };

  const digest1 = computePremiseDigest(basePremise);
  assert.ok(typeof digest1 === "string" && digest1.length === 64, "Returns valid SHA-256 hash");

  // Non-substantive update (metadata timestamp changed)
  const metaUpdated = {
    ...basePremise,
    metadata: { updatedAt: "2026-10-21T07:00:00Z", updatedByUser: "Bob" },
  };
  const digest2 = computePremiseDigest(metaUpdated);
  assert.equal(digest1, digest2, "Non-substantive metadata edit produces identical digest");

  // Substantive update (street number changed)
  const addrUpdated = {
    ...basePremise,
    address: { ...basePremise.address, strNo: "14" },
  };
  const digest3 = computePremiseDigest(addrUpdated);
  assert.notEqual(digest1, digest3, "Substantive address edit produces different digest");

  // Substantive update (media added)
  const mediaUpdated = {
    ...basePremise,
    media: [...basePremise.media, { tag: "Gate", url: "https://example.com/gate.jpg" }],
  };
  const digest4 = computePremiseDigest(mediaUpdated);
  assert.notEqual(digest1, digest4, "Substantive photo update produces different digest");
});

test("premiseReviewAccess enforces governance roles, active status, workbase matching, and strict no-self-review", () => {
  const providers = [
    {
      id: "SP_01",
      code: "CONTOUR",
      status: "ACTIVE",
      clients: [
        { clientType: "LM", relationshipType: "MNC", id: "KZN241", name: "eDumbe Local Municipality" },
      ],
    },
  ];
  const premise = {
    id: "PRM_001",
    parents: { lmPcode: "KZN241" },
    metadata: { createdByUid: "FWR_USER_01", createdByUser: "Peter Fieldworker" },
    qa: { lastSubmittedByUid: "FWR_USER_01", lastSubmittedByUser: "Peter Fieldworker" },
  };

  // 1. Role checks
  const mngUser = {
    accountStatus: "ACTIVE",
    employment: { role: "MNG", serviceProvider: { id: "SP_01" } },
    access: { workbases: ["KZN241"] },
  };
  assert.equal(premiseReviewAccess({ actorUid: "MNG_999", actor: mngUser, providers, premise }).allowed, true);

  const spvUser = {
    accountStatus: "ACTIVE",
    employment: { role: "SPV", serviceProvider: { id: "SP_01" } },
    access: { workbases: ["KZN241"] },
  };
  assert.equal(premiseReviewAccess({ actorUid: "SPV_888", actor: spvUser, providers, premise }).allowed, true);

  const admUser = {
    accountStatus: "ACTIVE",
    employment: { role: "ADM" },
  };
  assert.equal(premiseReviewAccess({ actorUid: "ADM_001", actor: admUser, providers, premise }).allowed, true);

  const fwrUser = {
    accountStatus: "ACTIVE",
    employment: { role: "FWR", serviceProvider: { id: "SP_01" } },
    access: { workbases: ["KZN241"] },
  };
  const fwrAccess = premiseReviewAccess({ actorUid: "OTHER_FWR", actor: fwrUser, providers, premise });
  assert.equal(fwrAccess.allowed, false);
  assert.match(fwrAccess.reason, /managers and main-contractor supervisors/i);

  // 2. Inactive account rejected
  const inactiveMng = {
    accountStatus: "INACTIVE",
    employment: { role: "MNG", serviceProvider: { id: "SP_01" } },
    access: { workbases: ["KZN241"] },
  };
  const inactiveAccess = premiseReviewAccess({ actorUid: "MNG_999", actor: inactiveMng, providers, premise });
  assert.equal(inactiveAccess.allowed, false);
  assert.match(inactiveAccess.reason, /active/i);

  // 3. Workbase mismatch rejected
  const otherLmUser = {
    accountStatus: "ACTIVE",
    employment: { role: "MNG", serviceProvider: { id: "SP_01" } },
    access: { workbases: ["KZN999"] },
  };
  const mismatchAccess = premiseReviewAccess({ actorUid: "MNG_OTHER", actor: otherLmUser, providers, premise });
  assert.equal(mismatchAccess.allowed, false);
  assert.match(mismatchAccess.reason, /workbase/i);

  // 4. Strict No-Self-Review: reviewer UID matches creatorUid or lastSubmittedByUid
  const selfReviewer = {
    accountStatus: "ACTIVE",
    employment: { role: "MNG", serviceProvider: { id: "SP_01" } },
    access: { workbases: ["KZN241"] },
  };
  const selfAccess = premiseReviewAccess({ actorUid: "FWR_USER_01", actor: selfReviewer, providers, premise });
  assert.equal(selfAccess.allowed, false);
  assert.match(selfAccess.reason, /Another authorised reviewer must QA your own submission/i);
});

test("projectPremiseQaToTbRow validates bidirectional linkage and projects QA without touching execution status", async () => {
  const updates = [];
  const fakeTx = {
    get: async (ref) => {
      if (ref.id === "ROW_VALID") {
        return {
          exists: true,
          data: () => ({
            id: "ROW_VALID",
            tbId: "TB_001",
            refs: { premiseId: "PRM_001" },
            execution: { status: "IN_PROGRESS" },
            salesDocId: "MTR_001",
          }),
        };
      }
      if (ref.id === "ROW_MISMATCHED") {
        return {
          exists: true,
          data: () => ({
            id: "ROW_MISMATCHED",
            tbId: "TB_001",
            refs: { premiseId: "PRM_OTHER" }, // points to different premise
            execution: { status: "IN_PROGRESS" },
          }),
        };
      }
      return { exists: false };
    },
    update: (ref, data) => {
      updates.push({ refId: ref.id, data });
    },
  };

  const fakeDb = {
    collection: (col) => ({
      doc: (id) => ({ col, id }),
    }),
  };

  const premise = {
    id: "PRM_001",
    targetedBatchContext: { tbId: "TB_001", rowId: "ROW_VALID", salesDocId: "MTR_001" },
  };

  // Valid projection
  const result = await projectPremiseQaToTbRow(fakeTx, fakeDb, "PRM_001", premise, "QA_PASS", {
    reviewedAt: "2026-10-21T06:00:00Z",
    reviewedByUser: "Jane Khumalo (MNG)",
    reviewedByUid: "MNG_001",
  });
  assert.equal(result.projected, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data["qa.premiseStatus"], "QA_PASS");
  assert.equal(updates[0].data["qa.premiseReviewedByUser"], "Jane Khumalo (MNG)");
  assert.equal(updates[0].data["execution.status"], undefined, "Never overwrites execution status");

  // Rejection when row is linked to a different premise
  const mismatchPremise = {
    id: "PRM_001",
    targetedBatchContext: { tbId: "TB_001", rowId: "ROW_MISMATCHED" },
  };
  const mismatchResult = await projectPremiseQaToTbRow(fakeTx, fakeDb, "PRM_001", mismatchPremise, "QA_PASS");
  assert.equal(mismatchResult.projected, false);
  assert.equal(mismatchResult.reason, "ROW_PREMISE_ID_MISMATCH");
});

test("invalidatePremiseQaIfSubstantive resets QA_PASS to QA_PENDING when substantive fields change", async () => {
  let premiseUpdate = null;
  let historyEntry = null;
  let registryUpdate = null;
  let rowUpdate = null;

  const beforeData = {
    address: { strNo: "12", strName: "Victoria" },
    propertyType: { type: "Residential" },
    occupancy: { status: "Occupied" },
    geometry: { location: { lat: -28.1, lng: 30.3 } },
    media: [{ tag: "Front Facade", url: "https://example.com/1.jpg" }],
    qa: { status: "QA_PASS", reviewedByUser: "Jane MNG" },
    targetedBatchContext: { tbId: "TB_001", rowId: "ROW_001" },
  };

  const afterData = {
    ...beforeData,
    address: { strNo: "14", strName: "Victoria" }, // Substantive change!
  };

  const fakeDb = {
    doc: (path) => ({
      path,
      collection: (sub) => ({
        doc: (id) => ({ path: `${path}/${sub}/${id}`, id }),
      }),
    }),
    collection: (col) => ({
      doc: (id) => ({ path: `${col}/${id}`, id }),
    }),
    runTransaction: async (cb) => {
      const tx = {
        get: async (ref) => {
          if (ref.path === "premises/PRM_TEST") {
            return { exists: true, data: () => beforeData };
          }
          if (ref.path === "tb_rows/ROW_001") {
            return {
              exists: true,
              data: () => ({
                id: "ROW_001",
                tbId: "TB_001",
                refs: { premiseId: "PRM_TEST" },
                execution: { status: "COMPLETED" },
              }),
            };
          }
          return { exists: false };
        },
        create: (ref, data) => { historyEntry = { path: ref.path, data }; },
        update: (ref, data) => {
          if (ref.path === "premises/PRM_TEST") premiseUpdate = data;
          if (ref.path === "tb_rows/ROW_001") rowUpdate = data;
        },
        set: (ref, data) => {
          if (ref.path === "registry_premises/PRM_TEST") registryUpdate = data;
        },
      };
      return cb(tx);
    },
  };

  const res = await invalidatePremiseQaIfSubstantive(
    fakeDb,
    beforeData,
    afterData,
    "PRM_TEST",
    "FWR_PETER",
    "Peter Peter",
  );

  assert.equal(res.invalidated, true);
  assert.equal(premiseUpdate.qa.status, "QA_PENDING");
  assert.equal(historyEntry.data.action, "QA_INVALIDATED");
  assert.equal(historyEntry.data.previousStatus, "QA_PASS");
  assert.equal(historyEntry.data.newStatus, "QA_PENDING");
  assert.equal(registryUpdate.qa.status, "QA_PENDING");
  assert.equal(rowUpdate["qa.premiseStatus"], "QA_PENDING");
});

test("invalidatePremiseQaIfSubstantive returns QA_FAIL to QA_PENDING when corrected by fieldworker", async () => {
  let historyEntry = null;
  let premiseUpdate = null;

  const beforeFail = {
    address: { strNo: "12" },
    qa: { status: "QA_FAIL", reasonCode: "ADDRESS_INCORRECT", resubmissionCount: 0 },
    targetedBatchContext: { tbId: "TB_001", rowId: "ROW_001" },
  };

  const afterCorrection = {
    ...beforeFail,
    address: { strNo: "14" }, // Corrected!
  };

  const fakeDb = {
    doc: (path) => ({
      path,
      collection: (sub) => ({
        doc: (id) => ({ path: `${path}/${sub}/${id}`, id }),
      }),
    }),
    collection: (col) => ({
      doc: (id) => ({ path: `${col}/${id}`, id }),
    }),
    runTransaction: async (cb) => {
      const tx = {
        get: async (ref) => {
          if (ref.path === "premises/PRM_FAIL") return { exists: true, data: () => beforeFail };
          if (ref.path === "tb_rows/ROW_001") {
            return {
              exists: true,
              data: () => ({ id: "ROW_001", tbId: "TB_001", refs: { premiseId: "PRM_FAIL" } }),
            };
          }
          return { exists: false };
        },
        create: (ref, data) => { historyEntry = { path: ref.path, data }; },
        update: (ref, data) => { if (ref.path === "premises/PRM_FAIL") premiseUpdate = data; },
        set: () => {},
      };
      return cb(tx);
    },
  };

  const res = await invalidatePremiseQaIfSubstantive(
    fakeDb,
    beforeFail,
    afterCorrection,
    "PRM_FAIL",
    "FWR_PETER",
    "Peter Peter",
  );

  assert.equal(res.invalidated, true);
  assert.equal(premiseUpdate.qa.status, "QA_PENDING");
  assert.equal(premiseUpdate.qa.resubmissionCount, 1);
  assert.equal(historyEntry.data.action, "QA_RESUBMISSION");
  assert.equal(historyEntry.data.previousStatus, "QA_FAIL");
  assert.equal(historyEntry.data.newStatus, "QA_PENDING");
});

test("buildPremiseRegistryRow projects canonical premise QA state to registry projection", () => {
  const premiseData = {
    erfNo: "5224",
    address: { formatted: "12 Victoria Street" },
    propertyType: { type: "Residential", name: "Single Residential" },
    qa: {
      status: "QA_PENDING",
      reviewedAt: null,
      reviewedByUser: null,
      lastSubmittedAt: "2026-10-21T04:02:49Z",
      lastSubmittedByUser: "Peter Peter",
    },
  };

  const row = buildPremiseRegistryRow("PRM_001", premiseData);
  assert.equal(row.premiseId, "PRM_001");
  assert.equal(row.qa?.status, "QA_PENDING");
  assert.equal(row.qa?.lastSubmittedByUser, "Peter Peter");
});

test("Historical records without QA are preserved without inadvertent enrollment", async () => {
  const historicalPremise = {
    address: { strNo: "12" },
    qa: null, // No QA object
  };
  const updatedHistorical = {
    ...historicalPremise,
    address: { strNo: "14" },
  };

  const res = await invalidatePremiseQaIfSubstantive(
    {},
    historicalPremise,
    updatedHistorical,
    "PRM_HISTORICAL",
  );
  assert.equal(res.invalidated, false, "Historical premises stay unenrolled in QA");
});

test("getPremiseQaReview returns media photographs and full premise context", async () => {
  const { getPremiseQaReview } = await import("../functions/qa/premiseQaReview.js");

  const mockDb = {
    doc: (path) => ({
      get: async () => {
        if (path === "users/USER_MNG") {
          return {
            exists: true,
            data: () => ({
              accountStatus: "ACTIVE",
              employment: { role: "MNG" },
              access: { workbases: ["KZN241"] },
            }),
          };
        }
        if (path === "premises/PRM_TEST_PHOTOS") {
          return {
            exists: true,
            data: () => ({
              id: "PRM_TEST_PHOTOS",
              parents: { lmPcode: "KZN241" },
              media: [
                { tag: "propertyAdrPhoto", url: "https://example.com/addr.jpg" },
                { tag: "propertyTypePhoto", url: "https://example.com/type.jpg" },
              ],
              address: { strNo: "42", strName: "Main", strType: "Rd" },
              propertyType: { type: "Residential", name: "House" },
              qa: { status: "QA_PENDING" },
              metadata: { createdByUid: "FWR_OTHER" },
            }),
          };
        }
        return { exists: false };
      },
    }),
    collection: (path) => ({
      get: async () => ({ docs: [] }),
      orderBy: () => ({ get: async () => ({ docs: [] }) }),
    }),
  };

  const res = await getPremiseQaReview(mockDb, "USER_MNG", { premiseId: "PRM_TEST_PHOTOS" });
  assert.equal(res.premiseId, "PRM_TEST_PHOTOS");
  assert.equal(res.media.length, 2, "Returns both media items");
  assert.equal(res.media[0].tag, "propertyAdrPhoto");
  assert.equal(res.media[1].tag, "propertyTypePhoto");
  assert.ok(res.premise, "Returns premise details object");
  assert.equal(res.premise.propertyType.name, "House");
});

