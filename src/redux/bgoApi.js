import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  limit as limitQuery,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db, functions } from "../firebase";

const BGO_BATCHES_COLLECTION = "bgo_batches";
// BGO row truth now lives in trns. BGO row = BGO-created MLCT TRN.
const BGO_ROWS_COLLECTION = "trns";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function valueOrNav(value) {
  if (value === null || value === undefined || value === "") return "NAv";
  return value;
}

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeDateValue(value) {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  return String(value);
}

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeGeofenceRef(data = {}) {
  const geofenceRef =
    data.geofenceRef ||
    data.geofence ||
    data.bgo?.geofenceRef ||
    data.bgo?.geofence ||
    data.refs?.geofence ||
    null;

  const id =
    geofenceRef?.id ||
    geofenceRef?.geofenceId ||
    data.geofenceId ||
    data.bgo?.geofenceId ||
    data.refs?.geofenceId ||
    "";

  const name =
    geofenceRef?.name ||
    geofenceRef?.geofenceName ||
    data.geofenceName ||
    data.bgo?.geofenceName ||
    data.refs?.geofenceName ||
    id ||
    "NAv";

  return {
    id: valueOrNav(id),
    name: valueOrNav(name),
  };
}

function normalizeTarget(data = {}) {
  const target =
    data.target ||
    data.assignment?.target ||
    asArray(data.assignment?.targets)[0] ||
    data.bgo?.target ||
    null;

  return {
    type: valueOrNav(target?.type || data.targetType || data.bgo?.targetType),
    id: valueOrNav(target?.id || data.targetId || data.bgo?.targetId),
    name: valueOrNav(target?.name || data.targetName || data.bgo?.targetName),
  };
}

function getWorkflowState(data = {}) {
  return valueOrNav(
    data.workflow?.state ||
      data.workflowState ||
      data.state ||
      data.status ||
      data.bgo?.workflowState,
  );
}

function getReleaseState(data = {}) {
  return valueOrNav(data.bgo?.releaseState || data.releaseState || data.workflow?.releaseState);
}

function getTcId(data = {}, fallbackId = "") {
  return valueOrNav(
    data.tcId ||
      data.origin?.tcId ||
      data.bgo?.tcId ||
      data.refs?.tcId ||
      data.refs?.tcUploadId ||
      data.upload?.tcId ||
      fallbackId,
  );
}

function getBgoBatchId(data = {}, docId = "") {
  return valueOrNav(
    data.bgoBatchId ||
      data.batchId ||
      data.bgo?.batchId ||
      data.refs?.bgoBatchId ||
      data.refs?.batchId ||
      data.id ||
      docId,
  );
}

function getTrnId(data = {}) {
  return valueOrNav(
    data.trnId ||
      data.trn?.id ||
      data.childTrnId ||
      data.refs?.trnId ||
      data.bgo?.trnId,
  );
}

function normalizeBgoBatchDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const summary = data.summary || {};
  const batchReleaseSummary = data.batchReleaseSummary || {};
  const derivedExecutionSummary = data.derivedExecutionSummary || {};
  const metadata = data.metadata || {};
  const geofenceRef = normalizeGeofenceRef(data);
  const target = normalizeTarget(data);
  const bgoBatchId = getBgoBatchId(data, docSnap.id);

  return {
    id: data.id || docSnap.id,
    bgoBatchId,
    batchId: bgoBatchId,
    tcId: getTcId(data),
    trnType: valueOrNav(data.trnType || data.operationType || data.operationCode),
    operationType: valueOrNav(data.operationType || data.trnType),
    operationCode: valueOrNav(data.operationCode || data.trnCode),
    geofenceRef,
    geofenceId: geofenceRef.id,
    geofenceName: geofenceRef.name,
    target,
    targetType: target.type,
    targetId: target.id,
    targetName: target.name,
    workflowState: getWorkflowState(data),
    releaseState: getReleaseState(data),
    batchMode: valueOrNav(data.bgo?.batchMode),
    scope: getBatchScope(data),
    summary: {
      ...summary,
      totalRows: safeNumber(summary.totalRows ?? batchReleaseSummary.totalRows ?? data.totalRows),
      totalTrnsCreated: safeNumber(
        summary.totalTrnsCreated ??
          summary.totalChildTrns ??
          batchReleaseSummary.totalTrnsCreated ??
          data.totalTrnsCreated,
      ),
      totalAvailable: safeNumber(summary.totalAvailable),
      totalAccepted: safeNumber(summary.totalAccepted ?? derivedExecutionSummary.totalAccepted),
      totalInProgress: safeNumber(summary.totalInProgress ?? derivedExecutionSummary.totalInProgress),
      totalCompleted: safeNumber(summary.totalCompleted ?? derivedExecutionSummary.totalCompleted),
      totalSuccess: safeNumber(summary.totalSuccess ?? derivedExecutionSummary.totalSuccess),
      totalNoAccess: safeNumber(summary.totalNoAccess ?? derivedExecutionSummary.totalNoAccess),
      totalNoReading: safeNumber(summary.totalNoReading ?? derivedExecutionSummary.totalNoReading),
      totalRejected: safeNumber(summary.totalRejected ?? derivedExecutionSummary.totalRejected),
      totalCancelled: safeNumber(summary.totalCancelled ?? derivedExecutionSummary.totalCancelled),
    },
    metadata: {
      ...metadata,
      createdAt: normalizeDateValue(metadata.createdAt || data.createdAt),
      updatedAt: getBatchUpdatedAt(data),
    },
    raw: data,
  };
}

function normalizeBgoRowDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const metadata = data.metadata || {};
  const geofenceRef = normalizeGeofenceRef(data);
  const target = normalizeTarget(data);
  const bgoBatchId = getBgoBatchId(data, docSnap.id);
  const trnId = getTrnId(data);

  return {
    id: data.id || docSnap.id,
    bgoRowId: data.id || docSnap.id,
    bgoBatchId,
    batchId: bgoBatchId,
    tcId: getTcId(data),
    tcRowId: valueOrNav(
      data.tcRowId || data.origin?.tcRowId || data.bgo?.tcRowId || data.refs?.tcRowId,
    ),
    trnId,
    trnType: valueOrNav(data.trnType || data.operationType || data.trn?.type),
    workflowState: getWorkflowState(data),
    geofenceRef,
    geofenceId: geofenceRef.id,
    geofenceName: geofenceRef.name,
    target,
    targetType: target.type,
    targetId: target.id,
    targetName: target.name,
    ast: data.ast || {},
    premise: data.premise || {},
    trn: data.trn || null,
    executionOutcomeCode: valueOrNav(
      data.executionOutcome?.code ||
        data.executionOutcome?.outcome ||
        data.executionOutcome?.state ||
        data.executionOutcomeCode ||
        data.trn?.executionOutcomeCode ||
        data.trn?.executionOutcome?.code ||
        data.trn?.executionOutcome?.outcome,
    ),
    completedAt: normalizeDateValue(
      data.workflow?.completedAt || data.completedAt || data.trn?.completedAt,
    ),
    completedByUser: valueOrNav(
      data.workflow?.completedByUser || data.completedByUser || data.trn?.completedByUser,
    ),
    metadata: {
      ...metadata,
      createdAt: normalizeDateValue(metadata.createdAt || data.createdAt),
      updatedAt: normalizeDateValue(metadata.updatedAt || data.updatedAt),
    },
    raw: data,
  };
}

function sortByCreatedDesc(left, right) {
  const leftDate = String(left?.metadata?.createdAt || "");
  const rightDate = String(right?.metadata?.createdAt || "");

  if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function sortBgoRows(left, right) {
  const leftRow = Number(
    left?.raw?.bgo?.sourceRow?.rowNo ??
      left?.raw?.rowNo ??
      left?.raw?.tcRowNo ??
      Number.MAX_SAFE_INTEGER,
  );
  const rightRow = Number(
    right?.raw?.bgo?.sourceRow?.rowNo ??
      right?.raw?.rowNo ??
      right?.raw?.tcRowNo ??
      Number.MAX_SAFE_INTEGER,
  );

  if (Number.isFinite(leftRow) && Number.isFinite(rightRow) && leftRow !== rightRow) {
    return leftRow - rightRow;
  }

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function mergeUniqueDocs(snapshots, normalizer) {
  const byId = new Map();

  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docSnapshot) => {
      const normalized = normalizer(docSnapshot);
      if (!normalized?.id) return;
      byId.set(normalized.id, normalized);
    });
  });

  return Array.from(byId.values());
}

function buildTcIdQueries(collectionName, tcId, maxResults) {
  const collectionRef = collection(db, collectionName);

  return [
    query(collectionRef, where("tcId", "==", tcId), limitQuery(maxResults)),
    query(collectionRef, where("origin.tcId", "==", tcId), limitQuery(maxResults)),
    query(collectionRef, where("bgo.tcId", "==", tcId), limitQuery(maxResults)),
    query(collectionRef, where("refs.tcUploadId", "==", tcId), limitQuery(maxResults)),
  ];
}

function resolveLimit(arg, fallback = 500) {
  if (typeof arg === "number") return safeNumber(arg, fallback);
  return safeNumber(arg?.limit, fallback);
}

function isBmdBatchForScope(batch = {}, lmPcode = "", wardPcode = "") {
  const raw = batch.raw || {};
  const isBmd =
    normalizeUpper(raw?.bgo?.batchMode) === "BMD" ||
    (normalizeUpper(raw?.operationType) === "METER_DISCOVERY" &&
      normalizeUpper(raw?.origin?.sourceModule) === "BULK_METER_DISCOVERY");

  if (!isBmd) return false;

  const batchLmPcode = String(raw?.scope?.lmPcode || raw?.sourceUpload?.lmPcode || "").trim();
  const batchWardPcode = String(raw?.scope?.wardPcode || "").trim();

  return batchLmPcode === lmPcode && batchWardPcode === wardPcode;
}

function extractWardPcodeFromTrnIds(trnIds = []) {
  for (const trnId of asArray(trnIds)) {
    const match = String(trnId || "").match(/_(ZA\d{7})_/i);
    if (match?.[1]) return match[1].toUpperCase();
  }

  return "";
}

function getBatchScope(data = {}) {
  const scope = data.scope || {};
  const trnIds = data.refs?.trnIds || data.trnIds || data.bgo?.trnIds || [];

  return {
    lmPcode: valueOrNav(
      scope.lmPcode ||
        data.lmPcode ||
        data.sourceUpload?.lmPcode ||
        data.origin?.lmPcode,
    ),
    lmName: valueOrNav(scope.lmName || data.lmName || data.sourceUpload?.lmName),
    wardPcode: valueOrNav(
      scope.wardPcode ||
        data.wardPcode ||
        data.sourceUpload?.wardPcode ||
        data.origin?.wardPcode ||
        extractWardPcodeFromTrnIds(trnIds),
    ),
    wardName: valueOrNav(scope.wardName || data.wardName || data.sourceUpload?.wardName),
  };
}

function getBatchUpdatedAt(data = {}) {
  return normalizeDateValue(
    data.metadata?.updatedAt ||
      data.workflow?.completedAt ||
      data.workflow?.acceptedAt ||
      data.workflow?.rejectedAt ||
      data.workflow?.cancelledAt ||
      data.workflow?.issuedAt ||
      data.metadata?.createdAt ||
      data.updatedAt ||
      data.createdAt,
  );
}

function sortByUpdatedDesc(left, right) {
  const leftDate = String(left?.metadata?.updatedAt || left?.metadata?.createdAt || "");
  const rightDate = String(right?.metadata?.updatedAt || right?.metadata?.createdAt || "");

  if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

export const bgoApi = createApi({
  reducerPath: "bgoApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    createBgo: builder.mutation({
      async queryFn(payload) {
        try {
          const callable = httpsCallable(functions, "onCreateBgoCallable");
          const result = await callable(payload || {});
          const data = result?.data || {};

          if (data?.success === false) {
            return {
              error: {
                status: data?.code || "BGO_CREATE_FAILED",
                data,
                message: data?.message || "Failed to create BGO",
              },
            };
          }

          return { data };
        } catch (error) {
          return {
            error: {
              status: error?.code || "BGO_CREATE_ERROR",
              data: error,
              message: error?.message || "Failed to create BGO",
            },
          };
        }
      },
    }),

    deleteUnacceptedBgo: builder.mutation({
      async queryFn(payload) {
        try {
          const callable = httpsCallable(functions, "onDeleteUnacceptedBgoCallable");
          const result = await callable(payload || {});
          const data = result?.data || {};

          if (data?.success === false) {
            return {
              error: {
                status: data?.code || "BGO_DELETE_FAILED",
                data,
                message: data?.message || "Failed to delete BGO",
              },
            };
          }

          return { data };
        } catch (error) {
          return {
            error: {
              status: error?.code || "BGO_DELETE_ERROR",
              data: error,
              message: error?.message || "Failed to delete BGO",
            },
          };
        }
      },
    }),

    getBgoBatchesByLm: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const lmPcode = String(arg?.lmPcode || "").trim();
        if (!lmPcode) return;

        const maxResults = resolveLimit(arg, 1000);
        const latestSnapshots = new globalThis.Map();
        const unsubscribes = [];

        try {
          await cacheDataLoaded;

          const collectionRef = collection(db, BGO_BATCHES_COLLECTION);
          const queries = [
            query(collectionRef, where("scope.lmPcode", "==", lmPcode), limitQuery(maxResults)),
            query(
              collectionRef,
              where("sourceUpload.lmPcode", "==", lmPcode),
              limitQuery(maxResults),
            ),
            query(collectionRef, where("origin.lmPcode", "==", lmPcode), limitQuery(maxResults)),
            query(collectionRef, where("lmPcode", "==", lmPcode), limitQuery(maxResults)),
          ];

          queries.forEach((bgoQuery, index) => {
            const unsubscribe = onSnapshot(
              bgoQuery,
              (snapshot) => {
                latestSnapshots.set(index, snapshot);

                const batches = mergeUniqueDocs(
                  Array.from(latestSnapshots.values()),
                  normalizeBgoBatchDoc,
                ).sort(sortByUpdatedDesc);

                updateCachedData((draft) => {
                  draft.splice(0, draft.length, ...batches);
                });
              },
              (error) => {
                console.error("bgoApi getBgoBatchesByLm stream error:", error);
              },
            );

            unsubscribes.push(unsubscribe);
          });

          await cacheEntryRemoved;
        } finally {
          unsubscribes.forEach((unsubscribe) => unsubscribe());
        }
      },
    }),

    getBmdBgoBatchesByWard: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const lmPcode = String(arg?.lmPcode || "").trim();
        const wardPcode = String(arg?.wardPcode || "").trim();
        if (!lmPcode || !wardPcode) return;

        const maxResults = resolveLimit(arg, 500);
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const collectionRef = collection(db, BGO_BATCHES_COLLECTION);
          const bmdQuery = query(
            collectionRef,
            where("operationType", "==", "METER_DISCOVERY"),
            limitQuery(maxResults),
          );

          unsubscribe = onSnapshot(
            bmdQuery,
            (snapshot) => {
              const batches = snapshot.docs
                .map((docSnapshot) => normalizeBgoBatchDoc(docSnapshot))
                .filter(Boolean)
                .filter((batch) => isBmdBatchForScope(batch, lmPcode, wardPcode))
                .sort(sortByCreatedDesc);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...batches);
              });
            },
            (error) => {
              console.error("bgoApi getBmdBgoBatchesByWard stream error:", error);
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) unsubscribe();
        }
      },
    }),

    getBgoBatchesByTcId: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const tcId = typeof arg === "string" ? arg : arg?.tcId;
        if (!tcId) return;

        const maxResults = resolveLimit(arg, 300);
        const latestSnapshots = new globalThis.Map();
        const unsubscribes = [];

        try {
          await cacheDataLoaded;

          buildTcIdQueries(BGO_BATCHES_COLLECTION, tcId, maxResults).forEach(
            (bgoQuery, index) => {
              const unsubscribe = onSnapshot(
                bgoQuery,
                (snapshot) => {
                  latestSnapshots.set(index, snapshot);

                  const batches = mergeUniqueDocs(
                    Array.from(latestSnapshots.values()),
                    normalizeBgoBatchDoc,
                  ).sort(sortByCreatedDesc);

                  updateCachedData((draft) => {
                    draft.splice(0, draft.length, ...batches);
                  });
                },
                (error) => {
                  console.error("bgoApi getBgoBatchesByTcId stream error:", error);
                },
              );

              unsubscribes.push(unsubscribe);
            },
          );

          await cacheEntryRemoved;
        } finally {
          unsubscribes.forEach((unsubscribe) => unsubscribe());
        }
      },
    }),

    getBgoRowsByTcId: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const tcId = typeof arg === "string" ? arg : arg?.tcId;
        if (!tcId) return;

        const maxResults = resolveLimit(arg, 1000);
        const latestSnapshots = new globalThis.Map();
        const unsubscribes = [];

        try {
          await cacheDataLoaded;

          buildTcIdQueries(BGO_ROWS_COLLECTION, tcId, maxResults).forEach(
            (bgoQuery, index) => {
              const unsubscribe = onSnapshot(
                bgoQuery,
                (snapshot) => {
                  latestSnapshots.set(index, snapshot);

                  const rows = mergeUniqueDocs(
                    Array.from(latestSnapshots.values()),
                    normalizeBgoRowDoc,
                  ).sort(sortBgoRows);

                  updateCachedData((draft) => {
                    draft.splice(0, draft.length, ...rows);
                  });
                },
                (error) => {
                  console.error("bgoApi getBgoRowsByTcId stream error:", error);
                },
              );

              unsubscribes.push(unsubscribe);
            },
          );

          await cacheEntryRemoved;
        } finally {
          unsubscribes.forEach((unsubscribe) => unsubscribe());
        }
      },
    }),

    getBgoRowsByBatchId: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const bgoBatchId = typeof arg === "string" ? arg : arg?.bgoBatchId;
        if (!bgoBatchId) return;

        const maxResults = resolveLimit(arg, 1000);
        const latestSnapshots = new globalThis.Map();
        const unsubscribes = [];

        try {
          await cacheDataLoaded;

          const rowsCollection = collection(db, BGO_ROWS_COLLECTION);
          const queries = [
            query(
              rowsCollection,
              where("bgo.batchId", "==", bgoBatchId),
              limitQuery(maxResults),
            ),
            query(
              rowsCollection,
              where("bgo.bgoBatchId", "==", bgoBatchId),
              limitQuery(maxResults),
            ),
            query(
              rowsCollection,
              where("refs.bgoBatchId", "==", bgoBatchId),
              limitQuery(maxResults),
            ),
            query(
              rowsCollection,
              where("refs.batchId", "==", bgoBatchId),
              limitQuery(maxResults),
            ),
            query(
              rowsCollection,
              where("bucket.batchId", "==", bgoBatchId),
              limitQuery(maxResults),
            ),
          ];

          queries.forEach((bgoQuery, index) => {
            const unsubscribe = onSnapshot(
              bgoQuery,
              (snapshot) => {
                latestSnapshots.set(index, snapshot);

                const rows = mergeUniqueDocs(
                  Array.from(latestSnapshots.values()),
                  normalizeBgoRowDoc,
                ).sort(sortBgoRows);

                updateCachedData((draft) => {
                  draft.splice(0, draft.length, ...rows);
                });
              },
              (error) => {
                console.error("bgoApi getBgoRowsByBatchId stream error:", error);
              },
            );

            unsubscribes.push(unsubscribe);
          });

          await cacheEntryRemoved;
        } finally {
          unsubscribes.forEach((unsubscribe) => unsubscribe());
        }
      },
    }),
  }),
});

export const {
  useCreateBgoMutation,
  useDeleteUnacceptedBgoMutation,
  useGetBmdBgoBatchesByWardQuery,
  useGetBgoBatchesByLmQuery,
  useGetBgoBatchesByTcIdQuery,
  useGetBgoRowsByTcIdQuery,
  useGetBgoRowsByBatchIdQuery,
} = bgoApi;
