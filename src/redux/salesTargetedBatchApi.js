import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  doc,
  documentId,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";
import {
  buildSalesOperationalStatsReadModel,
  buildTargetedBatchDashboardReadModel,
  buildTargetedBatchHeaders,
  buildTargetedBatchMapReadModel,
  buildTargetedBatchReport,
  cleanText,
  getSalesOperationalPremiseIds,
  getTargetedBatchMapMembership,
  getTargetedBatchPremiseIds,
  getTargetedBatchSalesIds,
} from "../pages/sales/models/salesTargetedBatchReadModel";

const TARGETED_BATCH_UPLOADS_COLLECTION = "tb_uploads";
const TARGETED_BATCH_ROWS_COLLECTION = "tb_rows";
const SALES_COLLECTION = "sales-all-meters";
const REPORTING_PREMISES_COLLECTION = "registry_premises";
const MAP_ERFS_COLLECTION = "ireps_erfs";
const MAP_PREMISES_COLLECTION = "premises";
const MAP_METERS_COLLECTION = "asts";
const TRNS_COLLECTION = "trns";
const FIRESTORE_IN_CHUNK_SIZE = 30;

function createTargetedBatchHeadersStreamState(status = "idle") {
  return {
    items: [],
    sync: {
      status,
      source: "firestore-stream",
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function createTargetedBatchReportStreamState(status = "idle") {
  return {
    batch: null,
    rows: [],
    summary: {
      total: 0,
      notStarted: 0,
      inProgress: 0,
      completed: 0,
      metersDiscovered: 0,
      noAccessAttempts: 0,
    },
    sync: {
      status,
      source: "firestore-stream",
      sources: {
        batch: status,
        rows: status,
        sales: status === "ready" ? "ready" : "idle",
        premises: status === "ready" ? "ready" : "idle",
        trns: status,
      },
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function createSalesOperationalStatsStreamState(status = "idle") {
  return {
    batches: [],
    rows: [],
    sync: {
      status,
      source: "firestore-stream",
      sources: {
        batches: status,
        rows: status,
        sales: status === "ready" ? "ready" : "idle",
        premises: status === "ready" ? "ready" : "idle",
      },
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function createTargetedBatchDashboardStreamState(status = "idle") {
  return {
    batches: [],
    rows: [],
    metricsByTbId: {},
    integrityByTbId: {},
    sync: {
      status,
      source: "firestore-stream",
      sources: {
        batches: status,
        rows: status,
        sales: status === "ready" ? "ready" : "idle",
      },
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function createTargetedBatchAllocationMatrixStreamState(status = "idle") {
  return {
    batches: [],
    rows: [],
    sync: {
      status,
      source: "firestore-stream",
      sources: { batches: status, rows: status },
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function createTargetedBatchAllocationRowsStreamState(status = "idle") {
  return {
    rows: [],
    sync: {
      status,
      source: "firestore-stream",
      sources: { rows: status },
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function createTargetedBatchAllocationContextStreamState(status = "idle") {
  return {
    batch: null,
    rows: [],
    sync: {
      status,
      source: "firestore-stream",
      sources: { batch: status, rows: status },
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function createTargetedBatchAllocationDirectoryStreamState(status = "idle") {
  return {
    teams: [],
    serviceProviders: [],
    sync: {
      status,
      source: "firestore-stream",
      sources: { teams: status, serviceProviders: status },
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function needsAllocationMatrixIntegrityRows(batch = {}) {
  const sourceType = cleanText(batch?.source?.type).toUpperCase();
  if (!["PREPAID_SALES", "PREPAID_SALES_NON_GPS"].includes(sourceType)) {
    return false;
  }

  const allocationStatus = cleanText(batch?.allocation?.status).toUpperCase();
  const executionStatus = cleanText(batch?.execution?.status).toUpperCase();

  return allocationStatus === "ALLOCATED" && executionStatus !== "COMPLETED";
}

function normalizeUpperText(value) {
  return cleanText(value).toUpperCase();
}

function safeArrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAllocationTeamSnapshot(snapshot) {
  const data = snapshot?.data?.() || {};
  const team = data?.team || {};
  const scope = data?.scope || {};
  const ownership = data?.ownership || {};
  const status = normalizeUpperText(team?.status || data?.status);
  const name = cleanText(team?.name || data?.name || snapshot?.id) || snapshot?.id;

  if (status !== "ACTIVE") return null;

  return {
    id: cleanText(data?.id || snapshot?.id),
    type: "TEAM",
    name,
    label: name,
    status,
    eligible: true,
    memberUserIds: safeArrayValue(scope?.memberUserIds),
    serviceProviderIds: safeArrayValue(scope?.serviceProviderIds),
    memberCount: safeArrayValue(scope?.memberUserIds).length,
    serviceProviderCount: safeArrayValue(scope?.serviceProviderIds).length,
    mncServiceProviderId: cleanText(ownership?.mncServiceProviderId),
    mncServiceProviderName: cleanText(ownership?.mncServiceProviderName),
    raw: data,
  };
}

function findAllocationSubcontractorClient(serviceProvider = {}, actorMncId = "") {
  const normalizedActorMncId = cleanText(actorMncId);
  return safeArrayValue(serviceProvider?.clients).find((client) =>
    normalizeUpperText(client?.clientType) === "SP" &&
    normalizeUpperText(client?.relationshipType) === "SUBC" &&
    cleanText(client?.id) === normalizedActorMncId,
  );
}

function normalizeAllocationServiceProviderSnapshot(snapshot, actorMncId) {
  const data = snapshot?.data?.() || {};
  const profile = data?.profile || {};
  const status = normalizeUpperText(data?.status || data?.lifecycleStatus);
  const mncClient = findAllocationSubcontractorClient(data, actorMncId);

  if (status !== "ACTIVE" || !mncClient) return null;

  const name = cleanText(
    profile?.tradingName || profile?.registeredName || data?.name || snapshot?.id,
  ) || snapshot?.id;

  return {
    id: cleanText(data?.id || snapshot?.id),
    type: "SP",
    name,
    label: name,
    status,
    eligible: true,
    parentServiceProviderId: cleanText(mncClient?.id),
    parentServiceProviderName: cleanText(mncClient?.name),
    relationshipType: normalizeUpperText(mncClient?.relationshipType),
    clientType: normalizeUpperText(mncClient?.clientType),
    raw: data,
  };
}

function sortAllocationTargets(left, right) {
  return cleanText(left?.name || left?.id).localeCompare(
    cleanText(right?.name || right?.id),
    undefined,
    { numeric: true, sensitivity: "base" },
  );
}

function createTargetedBatchMapStreamState(status = "idle") {
  return {
    batch: null,
    membership: {
      rowCount: 0,
      links: [],
      erfIds: [],
      premiseIds: [],
      meterIds: [],
    },
    erfs: [],
    premises: [],
    meters: [],
    diagnostics: {
      rows: 0,
      erfRefs: 0,
      erfsFound: 0,
      erfsWithGeometry: 0,
      erfsWithCentroid: 0,
      rowsMissingErfRef: 0,
      missingErfCount: 0,
      missingErfIds: [],
      missingErfIdsTruncated: false,
      rowIdsMissingErfRef: [],
      rowIdsMissingErfRefTruncated: false,
      premiseRefs: 0,
      premisesFound: 0,
      premisesWithGps: 0,
      rowsMissingPremiseRef: 0,
      missingPremiseCount: 0,
      missingPremiseIds: [],
      missingPremiseIdsTruncated: false,
      rowIdsMissingPremiseRef: [],
      rowIdsMissingPremiseRefTruncated: false,
      meterRefs: 0,
      metersFound: 0,
      metersWithGps: 0,
      metersWithAmbiguousPremiseLinks: 0,
      metersWithAmbiguousErfLinks: 0,
      rowsMissingMeterRef: 0,
      missingMeterCount: 0,
      missingMeterIds: [],
      missingMeterIdsTruncated: false,
      rowIdsMissingMeterRef: [],
      rowIdsMissingMeterRefTruncated: false,
      expectedLmPcode: null,
      batchLmPcode: null,
      lmPcodeMatches: null,
    },
    sync: {
      status,
      source: "firestore-stream",
      sources: {
        batch: status,
        rows: status,
        erfs: status === "ready" ? "ready" : "idle",
        premises: status === "ready" ? "ready" : "idle",
        meters: status === "ready" ? "ready" : "idle",
      },
      firstSnapshotAtMs: null,
      lastSyncAtMs: null,
      error: null,
    },
  };
}

function resolveTargetedBatchMapArgs(arg) {
  if (typeof arg === "string") {
    return {
      tbId: cleanText(arg),
      lmPcode: "",
    };
  }

  return {
    tbId: cleanText(arg?.tbId),
    lmPcode: cleanText(arg?.lmPcode),
  };
}

function resolveTargetedBatchDashboardArgs(arg = {}) {
  if (typeof arg === "string") {
    return {
      tbId: cleanText(arg),
      lmPcode: "",
    };
  }

  return {
    tbId: cleanText(arg?.tbId),
    lmPcode: cleanText(arg?.lmPcode),
  };
}

function normalizeStreamError(error, source) {
  return {
    source: cleanText(source) || "unknown",
    code: cleanText(error?.code) || "TARGETED_BATCH_STREAM_ERROR",
    message:
      cleanText(error?.message) ||
      "The live Targeted Batch reporting stream could not be opened.",
  };
}

function chunkValues(values, size = FIRESTORE_IN_CHUNK_SIZE) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function combineChunkMaps(chunkResults) {
  const combined = {};

  chunkResults.forEach((rows) => {
    Object.assign(combined, rows);
  });

  return combined;
}

function getOverallReportStatus(sourceStatuses) {
  const values = Object.values(sourceStatuses);

  if (values.some((status) => status === "syncing" || status === "idle")) {
    return "syncing";
  }

  if (values.some((status) => status === "error")) return "error";
  return "ready";
}

export const salesTargetedBatchApi = createApi({
  reducerPath: "salesTargetedBatchApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getTargetedBatchHeadersByLm: builder.query({
      queryFn: (lmPcode) => ({
        data: createTargetedBatchHeadersStreamState(
          cleanText(lmPcode) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedLmPcode = cleanText(lmPcode);
        if (!normalizedLmPcode) return;

        let active = true;
        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          const batchesQuery = query(
            collection(db, TARGETED_BATCH_UPLOADS_COLLECTION),
            where("scope.lmPcode", "==", normalizedLmPcode),
          );

          unsubscribe = onSnapshot(
            batchesQuery,
            (snapshot) => {
              if (!active) return;

              const syncedAtMs = Date.now();
              const items = buildTargetedBatchHeaders(snapshot.docs);

              updateCachedData((draft) => {
                draft.items = items;
                draft.sync.status = "ready";
                draft.sync.firstSnapshotAtMs ??= syncedAtMs;
                draft.sync.lastSyncAtMs = syncedAtMs;
                draft.sync.error = null;
              });
            },
            (error) => {
              if (!active) return;

              console.error(
                "[SALES TARGETED BATCH API][HEADER STREAM]",
                error,
              );

              updateCachedData((draft) => {
                draft.sync.status = "error";
                draft.sync.lastSyncAtMs = Date.now();
                draft.sync.error = normalizeStreamError(error, "headers");
              });
            },
          );
        } catch (error) {
          console.error(
            "[SALES TARGETED BATCH API][HEADER SETUP]",
            error,
          );

          updateCachedData((draft) => {
            draft.sync.status = "error";
            draft.sync.lastSyncAtMs = Date.now();
            draft.sync.error = normalizeStreamError(error, "headers");
          });
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribe();
        }
      },

      keepUnusedDataFor: 300,
    }),

    getTargetedBatchDashboard: builder.query({
      queryFn: (arg) => {
        const { tbId, lmPcode } = resolveTargetedBatchDashboardArgs(arg);
        return {
          data: createTargetedBatchDashboardStreamState(
            tbId || lmPcode ? "syncing" : "ready",
          ),
        };
      },

      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const { tbId, lmPcode } = resolveTargetedBatchDashboardArgs(arg);
        if (!tbId && !lmPcode) return;

        let active = true;
        let unsubscribeBatches = () => {};
        let unsubscribeRows = () => {};
        let salesUnsubscribes = [];
        let salesIdsKey = null;

        const sourceStatuses = {
          batches: "syncing",
          rows: "syncing",
          sales: "idle",
        };
        const sourceErrors = {};
        const rawState = {
          batches: [],
          rows: [],
          salesById: {},
        };

        const clearUnsubscribes = (unsubscribes) => {
          unsubscribes.forEach((unsubscribe) => {
            try {
              unsubscribe();
            } catch (error) {
              console.warn(
                "[SALES TARGETED BATCH API][DASHBOARD LISTENER CLEANUP]",
                error,
              );
            }
          });
        };

        const markSource = (source, status, error = null) => {
          sourceStatuses[source] = status;

          if (error) {
            sourceErrors[source] = normalizeStreamError(error, source);
          } else {
            delete sourceErrors[source];
          }
        };

        const publish = () => {
          if (!active) return;

          const syncedAtMs = Date.now();
          const readModel = buildTargetedBatchDashboardReadModel({
            batches: rawState.batches,
            rows: rawState.rows,
            salesById: rawState.salesById,
          });
          const firstError = Object.values(sourceErrors)[0] || null;

          updateCachedData((draft) => {
            draft.batches = readModel.batches;
            draft.rows = readModel.rows;
            draft.metricsByTbId = readModel.metricsByTbId;
            draft.integrityByTbId = readModel.integrityByTbId;
            draft.sync.status = getOverallReportStatus(sourceStatuses);
            draft.sync.sources = { ...sourceStatuses };
            draft.sync.firstSnapshotAtMs ??= syncedAtMs;
            draft.sync.lastSyncAtMs = syncedAtMs;
            draft.sync.error = firstError;
          });
        };

        const handleSourceError = (source, error) => {
          console.error(
            `[SALES TARGETED BATCH API][DASHBOARD ${source.toUpperCase()} STREAM]`,
            error,
          );
          markSource(source, "error", error);
          publish();
        };

        const restartSalesListeners = () => {
          if (!active) return;

          const salesIds = getTargetedBatchSalesIds(rawState.rows);
          const nextSalesIdsKey = salesIds.join("|");

          if (nextSalesIdsKey === salesIdsKey) {
            publish();
            return;
          }

          salesIdsKey = nextSalesIdsKey;
          clearUnsubscribes(salesUnsubscribes);
          salesUnsubscribes = [];
          rawState.salesById = {};

          if (salesIds.length === 0) {
            markSource("sales", "ready");
            publish();
            return;
          }

          markSource("sales", "syncing");
          const chunks = chunkValues(salesIds);
          const chunkResults = new Map();
          const chunkErrors = new Set();

          chunks.forEach((salesIdChunk, chunkIndex) => {
            const unsubscribe = onSnapshot(
              query(
                collection(db, SALES_COLLECTION),
                where(documentId(), "in", salesIdChunk),
              ),
              (snapshot) => {
                if (!active || nextSalesIdsKey !== salesIdsKey) return;

                const rows = {};
                snapshot.docs.forEach((salesSnapshot) => {
                  rows[salesSnapshot.id] = {
                    id: salesSnapshot.id,
                    ...salesSnapshot.data(),
                  };
                });

                chunkResults.set(chunkIndex, rows);
                chunkErrors.delete(chunkIndex);
                rawState.salesById = combineChunkMaps(chunkResults);

                if (chunkResults.size === chunks.length) {
                  markSource(
                    "sales",
                    chunkErrors.size > 0 ? "error" : "ready",
                    chunkErrors.size > 0
                      ? new Error(
                          "One or more Targeted Batch Dashboard Sales streams failed.",
                        )
                      : null,
                  );
                }

                publish();
              },
              (error) => {
                if (!active || nextSalesIdsKey !== salesIdsKey) return;

                console.error(
                  "[SALES TARGETED BATCH API][DASHBOARD SALES JOIN]",
                  error,
                );
                chunkResults.set(chunkIndex, {});
                chunkErrors.add(chunkIndex);
                rawState.salesById = combineChunkMaps(chunkResults);
                markSource("sales", "error", error);
                publish();
              },
            );

            salesUnsubscribes.push(unsubscribe);
          });

          publish();
        };

        try {
          await cacheDataLoaded;

          if (tbId) {
            unsubscribeBatches = onSnapshot(
              doc(db, TARGETED_BATCH_UPLOADS_COLLECTION, tbId),
              (snapshot) => {
                if (!active) return;

                rawState.batches = snapshot.exists()
                  ? [{ id: snapshot.id, ...snapshot.data() }]
                  : [];
                markSource("batches", "ready");
                publish();
              },
              (error) => handleSourceError("batches", error),
            );

            unsubscribeRows = onSnapshot(
              query(
                collection(db, TARGETED_BATCH_ROWS_COLLECTION),
                where("tbId", "==", tbId),
              ),
              (snapshot) => {
                if (!active) return;

                rawState.rows = snapshot.docs.map((rowSnapshot) => ({
                  id: rowSnapshot.id,
                  ...rowSnapshot.data(),
                }));
                markSource("rows", "ready");
                restartSalesListeners();
              },
              (error) => {
                markSource("sales", "error", error);
                handleSourceError("rows", error);
              },
            );
          } else {
            unsubscribeBatches = onSnapshot(
              query(
                collection(db, TARGETED_BATCH_UPLOADS_COLLECTION),
                where("scope.lmPcode", "==", lmPcode),
              ),
              (snapshot) => {
                if (!active) return;

                rawState.batches = snapshot.docs.map((batchSnapshot) => ({
                  id: batchSnapshot.id,
                  ...batchSnapshot.data(),
                }));
                markSource("batches", "ready");
                publish();
              },
              (error) => handleSourceError("batches", error),
            );

            unsubscribeRows = onSnapshot(
              query(
                collection(db, TARGETED_BATCH_ROWS_COLLECTION),
                where("scope.lmPcode", "==", lmPcode),
              ),
              (snapshot) => {
                if (!active) return;

                rawState.rows = snapshot.docs.map((rowSnapshot) => ({
                  id: rowSnapshot.id,
                  ...rowSnapshot.data(),
                }));
                markSource("rows", "ready");
                restartSalesListeners();
              },
              (error) => {
                markSource("sales", "error", error);
                handleSourceError("rows", error);
              },
            );
          }
        } catch (error) {
          console.error(
            "[SALES TARGETED BATCH API][DASHBOARD SETUP]",
            error,
          );

          Object.keys(sourceStatuses).forEach((source) => {
            if (sourceStatuses[source] !== "ready") {
              markSource(source, "error", error);
            }
          });
          publish();
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribeBatches();
          unsubscribeRows();
          clearUnsubscribes(salesUnsubscribes);
        }
      },

      keepUnusedDataFor: 0,
    }),

    getTargetedBatchReportById: builder.query({
      queryFn: (tbId) => ({
        data: createTargetedBatchReportStreamState(
          cleanText(tbId) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        tbId,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedTbId = cleanText(tbId);
        if (!normalizedTbId) return;

        let active = true;
        let unsubscribeBatch = () => {};
        let unsubscribeRows = () => {};
        let unsubscribeTrns = () => {};
        let salesUnsubscribes = [];
        let premiseUnsubscribes = [];
        let salesIdsKey = null;
        let premiseIdsKey = null;

        const sourceStatuses = {
          batch: "syncing",
          rows: "syncing",
          sales: "idle",
          premises: "idle",
          trns: "syncing",
        };
        const sourceErrors = {};
        const rawState = {
          batch: null,
          rows: [],
          salesById: {},
          premiseById: {},
          noAccessTrns: [],
        };

        const clearUnsubscribes = (unsubscribes) => {
          unsubscribes.forEach((unsubscribe) => {
            try {
              unsubscribe();
            } catch (error) {
              console.warn(
                "[SALES TARGETED BATCH API][LISTENER CLEANUP]",
                error,
              );
            }
          });
        };

        const publish = () => {
          if (!active) return;

          const syncedAtMs = Date.now();
          const report = buildTargetedBatchReport({
            tbId: normalizedTbId,
            batch: rawState.batch,
            rows: rawState.rows,
            salesById: rawState.salesById,
            premiseById: rawState.premiseById,
            noAccessTrns: rawState.noAccessTrns,
          });
          const firstError = Object.values(sourceErrors)[0] || null;

          updateCachedData((draft) => {
            draft.batch = report.batch;
            draft.rows = report.rows;
            draft.summary = report.summary;
            draft.sync.status = getOverallReportStatus(sourceStatuses);
            draft.sync.sources = { ...sourceStatuses };
            draft.sync.firstSnapshotAtMs ??= syncedAtMs;
            draft.sync.lastSyncAtMs = syncedAtMs;
            draft.sync.error = firstError;
          });
        };

        const markSource = (source, status, error = null) => {
          sourceStatuses[source] = status;

          if (error) {
            sourceErrors[source] = normalizeStreamError(error, source);
          } else {
            delete sourceErrors[source];
          }
        };

        const handleSourceError = (source, error) => {
          console.error(
            `[SALES TARGETED BATCH API][${source.toUpperCase()} STREAM]`,
            error,
          );
          markSource(source, "error", error);
          publish();
        };

        const restartPremiseListeners = () => {
          if (!active) return;

          const premiseIds = getTargetedBatchPremiseIds({
            rows: rawState.rows,
            salesById: rawState.salesById,
            tbId: normalizedTbId,
          });
          const nextPremiseIdsKey = premiseIds.join("|");

          if (nextPremiseIdsKey === premiseIdsKey) return;

          premiseIdsKey = nextPremiseIdsKey;
          clearUnsubscribes(premiseUnsubscribes);
          premiseUnsubscribes = [];
          rawState.premiseById = {};

          if (premiseIds.length === 0) {
            markSource("premises", "ready");
            publish();
            return;
          }

          markSource("premises", "syncing");
          const chunks = chunkValues(premiseIds);
          const chunkResults = new Map();
          const chunkErrors = new Set();

          chunks.forEach((premiseIdChunk, chunkIndex) => {
            const unsubscribe = onSnapshot(
              query(
                collection(db, REPORTING_PREMISES_COLLECTION),
                where(documentId(), "in", premiseIdChunk),
              ),
              (snapshot) => {
                if (!active || nextPremiseIdsKey !== premiseIdsKey) return;

                const rows = {};
                snapshot.docs.forEach((premiseSnapshot) => {
                  rows[premiseSnapshot.id] = {
                    id: premiseSnapshot.id,
                    ...premiseSnapshot.data(),
                  };
                });

                chunkResults.set(chunkIndex, rows);
                chunkErrors.delete(chunkIndex);
                rawState.premiseById = combineChunkMaps(chunkResults);

                if (chunkResults.size === chunks.length) {
                  markSource(
                    "premises",
                    chunkErrors.size > 0 ? "error" : "ready",
                    chunkErrors.size > 0
                      ? new Error("One or more premise join streams failed.")
                      : null,
                  );
                }

                publish();
              },
              (error) => {
                if (!active || nextPremiseIdsKey !== premiseIdsKey) return;

                console.error(
                  "[SALES TARGETED BATCH API][PREMISE JOIN]",
                  error,
                );
                chunkResults.set(chunkIndex, {});
                chunkErrors.add(chunkIndex);
                rawState.premiseById = combineChunkMaps(chunkResults);
                markSource("premises", "error", error);
                publish();
              },
            );

            premiseUnsubscribes.push(unsubscribe);
          });

          publish();
        };

        const restartSalesListeners = () => {
          if (!active) return;

          const salesIds = getTargetedBatchSalesIds(rawState.rows);
          const nextSalesIdsKey = salesIds.join("|");

          if (nextSalesIdsKey === salesIdsKey) {
            restartPremiseListeners();
            return;
          }

          salesIdsKey = nextSalesIdsKey;
          clearUnsubscribes(salesUnsubscribes);
          salesUnsubscribes = [];
          rawState.salesById = {};

          if (salesIds.length === 0) {
            markSource("sales", "ready");
            restartPremiseListeners();
            publish();
            return;
          }

          markSource("sales", "syncing");
          const chunks = chunkValues(salesIds);
          const chunkResults = new Map();
          const chunkErrors = new Set();

          chunks.forEach((salesIdChunk, chunkIndex) => {
            const unsubscribe = onSnapshot(
              query(
                collection(db, SALES_COLLECTION),
                where(documentId(), "in", salesIdChunk),
              ),
              (snapshot) => {
                if (!active || nextSalesIdsKey !== salesIdsKey) return;

                const rows = {};
                snapshot.docs.forEach((salesSnapshot) => {
                  rows[salesSnapshot.id] = {
                    id: salesSnapshot.id,
                    ...salesSnapshot.data(),
                  };
                });

                chunkResults.set(chunkIndex, rows);
                chunkErrors.delete(chunkIndex);
                rawState.salesById = combineChunkMaps(chunkResults);

                if (chunkResults.size === chunks.length) {
                  markSource(
                    "sales",
                    chunkErrors.size > 0 ? "error" : "ready",
                    chunkErrors.size > 0
                      ? new Error("One or more Sales join streams failed.")
                      : null,
                  );
                  restartPremiseListeners();
                }

                publish();
              },
              (error) => {
                if (!active || nextSalesIdsKey !== salesIdsKey) return;

                console.error(
                  "[SALES TARGETED BATCH API][SALES JOIN]",
                  error,
                );
                chunkResults.set(chunkIndex, {});
                chunkErrors.add(chunkIndex);
                rawState.salesById = combineChunkMaps(chunkResults);
                markSource("sales", "error", error);
                if (chunkResults.size === chunks.length) {
                  restartPremiseListeners();
                }
                publish();
              },
            );

            salesUnsubscribes.push(unsubscribe);
          });

          publish();
        };

        try {
          await cacheDataLoaded;

          unsubscribeBatch = onSnapshot(
            doc(db, TARGETED_BATCH_UPLOADS_COLLECTION, normalizedTbId),
            (snapshot) => {
              if (!active) return;

              rawState.batch = snapshot.exists()
                ? {
                    id: snapshot.id,
                    ...snapshot.data(),
                  }
                : null;
              markSource("batch", "ready");
              publish();
            },
            (error) => handleSourceError("batch", error),
          );

          unsubscribeRows = onSnapshot(
            query(
              collection(db, TARGETED_BATCH_ROWS_COLLECTION),
              where("tbId", "==", normalizedTbId),
            ),
            (snapshot) => {
              if (!active) return;

              rawState.rows = snapshot.docs
                .map((rowSnapshot) => ({
                  id: rowSnapshot.id,
                  ...rowSnapshot.data(),
                }))
                .sort(
                  (left, right) =>
                    Number(left?.rowNo || 0) - Number(right?.rowNo || 0),
                );
              markSource("rows", "ready");
              restartSalesListeners();
              publish();
            },
            (error) => {
              markSource("sales", "error", error);
              markSource("premises", "error", error);
              handleSourceError("rows", error);
            },
          );

          unsubscribeTrns = onSnapshot(
            query(
              collection(db, TRNS_COLLECTION),
              where("targetedBatchContext.tbId", "==", normalizedTbId),
            ),
            (snapshot) => {
              if (!active) return;

              rawState.noAccessTrns = snapshot.docs.map((trnSnapshot) => ({
                id: trnSnapshot.id,
                ...trnSnapshot.data(),
              }));
              markSource("trns", "ready");
              publish();
            },
            (error) => handleSourceError("trns", error),
          );
        } catch (error) {
          console.error(
            "[SALES TARGETED BATCH API][REPORT SETUP]",
            error,
          );

          Object.keys(sourceStatuses).forEach((source) => {
            if (sourceStatuses[source] !== "ready") {
              markSource(source, "error", error);
            }
          });
          publish();
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribeBatch();
          unsubscribeRows();
          unsubscribeTrns();
          clearUnsubscribes(salesUnsubscribes);
          clearUnsubscribes(premiseUnsubscribes);
        }
      },

      keepUnusedDataFor: 300,
    }),

    getSalesOperationalStatsByLm: builder.query({
      queryFn: (lmPcode) => ({
        data: createSalesOperationalStatsStreamState(
          cleanText(lmPcode) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedLmPcode = cleanText(lmPcode);
        if (!normalizedLmPcode) return;

        let active = true;
        let unsubscribeBatches = () => {};
        let unsubscribeRows = () => {};
        let salesUnsubscribes = [];
        let premiseUnsubscribes = [];
        let salesIdsKey = null;
        let premiseIdsKey = null;

        const sourceStatuses = {
          batches: "syncing",
          rows: "syncing",
          sales: "idle",
          premises: "idle",
        };
        const sourceErrors = {};
        const rawState = {
          batches: [],
          rows: [],
          salesById: {},
          premiseById: {},
        };

        const clearUnsubscribes = (unsubscribes) => {
          unsubscribes.forEach((unsubscribe) => {
            try {
              unsubscribe();
            } catch (error) {
              console.warn(
                "[SALES TARGETED BATCH API][STATS LISTENER CLEANUP]",
                error,
              );
            }
          });
        };

        const publish = () => {
          if (!active) return;

          const syncedAtMs = Date.now();
          const readModel = buildSalesOperationalStatsReadModel({
            batches: rawState.batches,
            rows: rawState.rows,
            salesById: rawState.salesById,
            premiseById: rawState.premiseById,
          });
          const firstError = Object.values(sourceErrors)[0] || null;

          updateCachedData((draft) => {
            draft.batches = readModel.batches;
            draft.rows = readModel.rows;
            draft.sync.status = getOverallReportStatus(sourceStatuses);
            draft.sync.sources = { ...sourceStatuses };
            draft.sync.firstSnapshotAtMs ??= syncedAtMs;
            draft.sync.lastSyncAtMs = syncedAtMs;
            draft.sync.error = firstError;
          });
        };

        const markSource = (source, status, error = null) => {
          sourceStatuses[source] = status;

          if (error) {
            sourceErrors[source] = normalizeStreamError(error, source);
          } else {
            delete sourceErrors[source];
          }
        };

        const handleSourceError = (source, error) => {
          console.error(
            `[SALES TARGETED BATCH API][STATS ${source.toUpperCase()} STREAM]`,
            error,
          );
          markSource(source, "error", error);
          publish();
        };

        const restartPremiseListeners = () => {
          if (!active) return;

          const premiseIds = getSalesOperationalPremiseIds({
            rows: rawState.rows,
            salesById: rawState.salesById,
          });
          const nextPremiseIdsKey = premiseIds.join("|");

          if (nextPremiseIdsKey === premiseIdsKey) return;

          premiseIdsKey = nextPremiseIdsKey;
          clearUnsubscribes(premiseUnsubscribes);
          premiseUnsubscribes = [];
          rawState.premiseById = {};

          if (premiseIds.length === 0) {
            markSource("premises", "ready");
            publish();
            return;
          }

          markSource("premises", "syncing");
          const chunks = chunkValues(premiseIds);
          const chunkResults = new Map();
          const chunkErrors = new Set();

          chunks.forEach((premiseIdChunk, chunkIndex) => {
            const unsubscribe = onSnapshot(
              query(
                collection(db, REPORTING_PREMISES_COLLECTION),
                where(documentId(), "in", premiseIdChunk),
              ),
              (snapshot) => {
                if (!active || nextPremiseIdsKey !== premiseIdsKey) return;

                const rows = {};
                snapshot.docs.forEach((premiseSnapshot) => {
                  rows[premiseSnapshot.id] = {
                    id: premiseSnapshot.id,
                    ...premiseSnapshot.data(),
                  };
                });

                chunkResults.set(chunkIndex, rows);
                chunkErrors.delete(chunkIndex);
                rawState.premiseById = combineChunkMaps(chunkResults);

                if (chunkResults.size === chunks.length) {
                  markSource(
                    "premises",
                    chunkErrors.size > 0 ? "error" : "ready",
                    chunkErrors.size > 0
                      ? new Error("One or more Sales Stats premise streams failed.")
                      : null,
                  );
                }

                publish();
              },
              (error) => {
                if (!active || nextPremiseIdsKey !== premiseIdsKey) return;

                console.error(
                  "[SALES TARGETED BATCH API][STATS PREMISE JOIN]",
                  error,
                );
                chunkResults.set(chunkIndex, {});
                chunkErrors.add(chunkIndex);
                rawState.premiseById = combineChunkMaps(chunkResults);
                markSource("premises", "error", error);
                publish();
              },
            );

            premiseUnsubscribes.push(unsubscribe);
          });

          publish();
        };

        const restartSalesListeners = () => {
          if (!active) return;

          const salesIds = getTargetedBatchSalesIds(rawState.rows);
          const nextSalesIdsKey = salesIds.join("|");

          if (nextSalesIdsKey === salesIdsKey) {
            restartPremiseListeners();
            return;
          }

          salesIdsKey = nextSalesIdsKey;
          clearUnsubscribes(salesUnsubscribes);
          salesUnsubscribes = [];
          rawState.salesById = {};

          if (salesIds.length === 0) {
            markSource("sales", "ready");
            restartPremiseListeners();
            publish();
            return;
          }

          markSource("sales", "syncing");
          const chunks = chunkValues(salesIds);
          const chunkResults = new Map();
          const chunkErrors = new Set();

          chunks.forEach((salesIdChunk, chunkIndex) => {
            const unsubscribe = onSnapshot(
              query(
                collection(db, SALES_COLLECTION),
                where(documentId(), "in", salesIdChunk),
              ),
              (snapshot) => {
                if (!active || nextSalesIdsKey !== salesIdsKey) return;

                const rows = {};
                snapshot.docs.forEach((salesSnapshot) => {
                  rows[salesSnapshot.id] = {
                    id: salesSnapshot.id,
                    ...salesSnapshot.data(),
                  };
                });

                chunkResults.set(chunkIndex, rows);
                chunkErrors.delete(chunkIndex);
                rawState.salesById = combineChunkMaps(chunkResults);

                if (chunkResults.size === chunks.length) {
                  markSource(
                    "sales",
                    chunkErrors.size > 0 ? "error" : "ready",
                    chunkErrors.size > 0
                      ? new Error("One or more Sales Stats Sales streams failed.")
                      : null,
                  );
                  restartPremiseListeners();
                }

                publish();
              },
              (error) => {
                if (!active || nextSalesIdsKey !== salesIdsKey) return;

                console.error(
                  "[SALES TARGETED BATCH API][STATS SALES JOIN]",
                  error,
                );
                chunkResults.set(chunkIndex, {});
                chunkErrors.add(chunkIndex);
                rawState.salesById = combineChunkMaps(chunkResults);
                markSource("sales", "error", error);
                if (chunkResults.size === chunks.length) {
                  restartPremiseListeners();
                }
                publish();
              },
            );

            salesUnsubscribes.push(unsubscribe);
          });

          publish();
        };

        try {
          await cacheDataLoaded;

          unsubscribeBatches = onSnapshot(
            query(
              collection(db, TARGETED_BATCH_UPLOADS_COLLECTION),
              where("scope.lmPcode", "==", normalizedLmPcode),
            ),
            (snapshot) => {
              if (!active) return;

              rawState.batches = snapshot.docs.map((batchSnapshot) => ({
                id: batchSnapshot.id,
                ...batchSnapshot.data(),
              }));
              markSource("batches", "ready");
              publish();
            },
            (error) => handleSourceError("batches", error),
          );

          unsubscribeRows = onSnapshot(
            query(
              collection(db, TARGETED_BATCH_ROWS_COLLECTION),
              where("scope.lmPcode", "==", normalizedLmPcode),
            ),
            (snapshot) => {
              if (!active) return;

              rawState.rows = snapshot.docs.map((rowSnapshot) => ({
                id: rowSnapshot.id,
                ...rowSnapshot.data(),
              }));
              markSource("rows", "ready");
              restartSalesListeners();
              publish();
            },
            (error) => {
              markSource("sales", "error", error);
              markSource("premises", "error", error);
              handleSourceError("rows", error);
            },
          );
        } catch (error) {
          console.error(
            "[SALES TARGETED BATCH API][STATS SETUP]",
            error,
          );

          Object.keys(sourceStatuses).forEach((source) => {
            if (sourceStatuses[source] !== "ready") {
              markSource(source, "error", error);
            }
          });
          publish();
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribeBatches();
          unsubscribeRows();
          clearUnsubscribes(salesUnsubscribes);
          clearUnsubscribes(premiseUnsubscribes);
        }
      },

      keepUnusedDataFor: 300,
    }),

    getTargetedBatchAllocationMatrixByLm: builder.query({
      queryFn: (lmPcode) => ({
        data: createTargetedBatchAllocationMatrixStreamState(
          cleanText(lmPcode) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedLmPcode = cleanText(lmPcode);
        if (!normalizedLmPcode) return;

        let active = true;
        let unsubscribeBatches = () => {};
        let rowUnsubscribes = [];
        let rowGeneration = 0;
        const statuses = { batches: "syncing", rows: "syncing" };
        const errors = {};
        const raw = { batches: [], rows: [] };

        const publish = () => {
          if (!active) return;
          const syncedAtMs = Date.now();
          const status = getOverallReportStatus(statuses);

          updateCachedData((draft) => {
            draft.batches = raw.batches;
            draft.rows = raw.rows;
            draft.sync.status = status;
            draft.sync.sources = { ...statuses };
            draft.sync.firstSnapshotAtMs ??= syncedAtMs;
            draft.sync.lastSyncAtMs = syncedAtMs;
            draft.sync.error = Object.values(errors)[0] || null;
          });
        };

        const mark = (source, status, error = null) => {
          statuses[source] = status;
          if (error) errors[source] = normalizeStreamError(error, source);
          else delete errors[source];
          publish();
        };

        const clearRowListeners = () => {
          rowGeneration += 1;
          rowUnsubscribes.forEach((unsubscribe) => unsubscribe());
          rowUnsubscribes = [];
        };

        const restartIntegrityRowStreams = (batches) => {
          clearRowListeners();
          const generation = rowGeneration;
          const tbIds = Array.from(
            new Set(
              safeArrayValue(batches)
                .filter(needsAllocationMatrixIntegrityRows)
                .map((batch) => cleanText(batch?.id || batch?.tbId))
                .filter(Boolean),
            ),
          );

          raw.rows = [];
          delete errors.rows;

          if (tbIds.length === 0) {
            statuses.rows = "ready";
            publish();
            return;
          }

          statuses.rows = "syncing";
          publish();

          const chunks = chunkValues(tbIds);
          const chunkRows = new Map();
          const readyChunks = new Set();

          const publishRows = () => {
            if (!active || generation !== rowGeneration) return;
            raw.rows = Array.from(chunkRows.values()).flat();
            statuses.rows =
              readyChunks.size === chunks.length ? "ready" : "syncing";
            publish();
          };

          chunks.forEach((chunk, chunkIndex) => {
            const unsubscribe = onSnapshot(
              query(
                collection(db, TARGETED_BATCH_ROWS_COLLECTION),
                where("tbId", "in", chunk),
              ),
              (snapshot) => {
                if (!active || generation !== rowGeneration) return;
                chunkRows.set(
                  chunkIndex,
                  snapshot.docs.map((rowSnapshot) => ({
                    id: rowSnapshot.id,
                    ...rowSnapshot.data(),
                  })),
                );
                readyChunks.add(chunkIndex);
                delete errors.rows;
                publishRows();
              },
              (error) => {
                if (!active || generation !== rowGeneration) return;
                console.error(
                  "[SALES TARGETED BATCH API][ALLOCATION MATRIX INTEGRITY ROW STREAM]",
                  error,
                );
                statuses.rows = "error";
                errors.rows = normalizeStreamError(error, "rows");
                publish();
              },
            );
            rowUnsubscribes.push(unsubscribe);
          });
        };

        try {
          await cacheDataLoaded;

          unsubscribeBatches = onSnapshot(
            query(
              collection(db, TARGETED_BATCH_UPLOADS_COLLECTION),
              where("scope.lmPcode", "==", normalizedLmPcode),
            ),
            (snapshot) => {
              if (!active) return;
              raw.batches = snapshot.docs.map((batchSnapshot) => ({
                id: batchSnapshot.id,
                ...batchSnapshot.data(),
              }));
              statuses.batches = "ready";
              delete errors.batches;
              restartIntegrityRowStreams(raw.batches);
            },
            (error) => {
              if (!active) return;
              console.error(
                "[SALES TARGETED BATCH API][ALLOCATION MATRIX BATCH STREAM]",
                error,
              );
              mark("batches", "error", error);
            },
          );
        } catch (error) {
          console.error(
            "[SALES TARGETED BATCH API][ALLOCATION MATRIX SETUP]",
            error,
          );
          mark("batches", "error", error);
          mark("rows", "error", error);
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribeBatches();
          clearRowListeners();
        }
      },

      keepUnusedDataFor: 30,
    }),

    getTargetedBatchAllocationRowsByLm: builder.query({
      queryFn: (lmPcode) => ({
        data: createTargetedBatchAllocationRowsStreamState(
          cleanText(lmPcode) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        lmPcode,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedLmPcode = cleanText(lmPcode);
        if (!normalizedLmPcode) return;

        let active = true;
        let unsubscribeRows = () => {};

        try {
          await cacheDataLoaded;

          unsubscribeRows = onSnapshot(
            query(
              collection(db, TARGETED_BATCH_ROWS_COLLECTION),
              where("scope.lmPcode", "==", normalizedLmPcode),
            ),
            (snapshot) => {
              if (!active) return;
              const syncedAtMs = Date.now();
              const rows = snapshot.docs.map((rowSnapshot) => ({
                id: rowSnapshot.id,
                ...rowSnapshot.data(),
              }));

              updateCachedData((draft) => {
                draft.rows = rows;
                draft.sync.status = "ready";
                draft.sync.sources = { rows: "ready" };
                draft.sync.firstSnapshotAtMs ??= syncedAtMs;
                draft.sync.lastSyncAtMs = syncedAtMs;
                draft.sync.error = null;
              });
            },
            (error) => {
              console.error(
                "[SALES TARGETED BATCH API][ALLOCATION MATRIX USER ROW STREAM]",
                error,
              );
              updateCachedData((draft) => {
                draft.sync.status = "error";
                draft.sync.sources = { rows: "error" };
                draft.sync.lastSyncAtMs = Date.now();
                draft.sync.error = normalizeStreamError(error, "rows");
              });
            },
          );
        } catch (error) {
          console.error(
            "[SALES TARGETED BATCH API][ALLOCATION MATRIX USER ROW SETUP]",
            error,
          );
          updateCachedData((draft) => {
            draft.sync.status = "error";
            draft.sync.sources = { rows: "error" };
            draft.sync.lastSyncAtMs = Date.now();
            draft.sync.error = normalizeStreamError(error, "rows");
          });
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribeRows();
        }
      },

      keepUnusedDataFor: 10,
    }),

    getTargetedBatchAllocationContextById: builder.query({
      queryFn: (tbId) => ({
        data: createTargetedBatchAllocationContextStreamState(
          cleanText(tbId) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        tbId,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const normalizedTbId = cleanText(tbId);
        if (!normalizedTbId) return;

        let active = true;
        let unsubscribeBatch = () => {};
        let unsubscribeRows = () => {};
        const statuses = { batch: "syncing", rows: "syncing" };
        const errors = {};
        const raw = { batch: null, rows: [] };

        const publish = () => {
          if (!active) return;
          const syncedAtMs = Date.now();
          const values = Object.values(statuses);
          const status = values.some((value) => value === "syncing")
            ? "syncing"
            : values.some((value) => value === "error")
              ? "error"
              : "ready";
          updateCachedData((draft) => {
            draft.batch = raw.batch;
            draft.rows = raw.rows;
            draft.sync.status = status;
            draft.sync.sources = { ...statuses };
            draft.sync.firstSnapshotAtMs ??= syncedAtMs;
            draft.sync.lastSyncAtMs = syncedAtMs;
            draft.sync.error = Object.values(errors)[0] || null;
          });
        };

        const mark = (source, status, error = null) => {
          statuses[source] = status;
          if (error) errors[source] = normalizeStreamError(error, source);
          else delete errors[source];
          publish();
        };

        try {
          await cacheDataLoaded;

          unsubscribeBatch = onSnapshot(
            doc(db, TARGETED_BATCH_UPLOADS_COLLECTION, normalizedTbId),
            (snapshot) => {
              if (!active) return;
              raw.batch = snapshot.exists()
                ? { id: snapshot.id, ...snapshot.data() }
                : null;
              mark("batch", "ready");
            },
            (error) => mark("batch", "error", error),
          );

          unsubscribeRows = onSnapshot(
            query(
              collection(db, TARGETED_BATCH_ROWS_COLLECTION),
              where("tbId", "==", normalizedTbId),
            ),
            (snapshot) => {
              if (!active) return;
              raw.rows = snapshot.docs.map((rowSnapshot) => ({
                id: rowSnapshot.id,
                ...rowSnapshot.data(),
              }));
              mark("rows", "ready");
            },
            (error) => mark("rows", "error", error),
          );
        } catch (error) {
          mark("batch", "error", error);
          mark("rows", "error", error);
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribeBatch();
          unsubscribeRows();
        }
      },

      keepUnusedDataFor: 10,
    }),

    getTargetedBatchAllocationDirectory: builder.query({
      queryFn: (mncServiceProviderId) => ({
        data: createTargetedBatchAllocationDirectoryStreamState(
          cleanText(mncServiceProviderId) ? "syncing" : "ready",
        ),
      }),

      async onCacheEntryAdded(
        mncServiceProviderId,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const actorMncId = cleanText(mncServiceProviderId);
        if (!actorMncId) return;

        let active = true;
        let unsubscribeTeams = () => {};
        let unsubscribeServiceProviders = () => {};
        const statuses = { teams: "syncing", serviceProviders: "syncing" };
        const errors = {};
        const raw = { teams: [], serviceProviders: [] };

        const publish = () => {
          if (!active) return;
          const syncedAtMs = Date.now();
          const values = Object.values(statuses);
          const status = values.some((value) => value === "syncing")
            ? "syncing"
            : values.some((value) => value === "error")
              ? "error"
              : "ready";

          updateCachedData((draft) => {
            draft.teams = raw.teams;
            draft.serviceProviders = raw.serviceProviders;
            draft.sync.status = status;
            draft.sync.sources = { ...statuses };
            draft.sync.firstSnapshotAtMs ??= syncedAtMs;
            draft.sync.lastSyncAtMs = syncedAtMs;
            draft.sync.error = Object.values(errors)[0] || null;
          });
        };

        const mark = (source, status, error = null) => {
          statuses[source] = status;
          if (error) errors[source] = normalizeStreamError(error, source);
          else delete errors[source];
          publish();
        };

        try {
          await cacheDataLoaded;

          unsubscribeTeams = onSnapshot(
            query(
              collection(db, "teams"),
              where("ownership.mncServiceProviderId", "==", actorMncId),
            ),
            (snapshot) => {
              if (!active) return;
              raw.teams = snapshot.docs
                .map(normalizeAllocationTeamSnapshot)
                .filter(Boolean)
                .sort(sortAllocationTargets);
              mark("teams", "ready");
            },
            (error) => {
              console.error(
                "[SALES TARGETED BATCH API][ALLOCATION TEAM DIRECTORY]",
                error,
              );
              mark("teams", "error", error);
            },
          );

          // Service Provider relationships are stored in the clients array and
          // cannot be safely queried by a partial map. Stream the uncapped
          // directory once, then retain only ACTIVE SP/SUBC relationships to
          // the actor's MNC. Backend allocation repeats this eligibility check.
          unsubscribeServiceProviders = onSnapshot(
            collection(db, "serviceProviders"),
            (snapshot) => {
              if (!active) return;
              raw.serviceProviders = snapshot.docs
                .map((serviceProviderSnapshot) =>
                  normalizeAllocationServiceProviderSnapshot(
                    serviceProviderSnapshot,
                    actorMncId,
                  ),
                )
                .filter(Boolean)
                .sort(sortAllocationTargets);
              mark("serviceProviders", "ready");
            },
            (error) => {
              console.error(
                "[SALES TARGETED BATCH API][ALLOCATION SP DIRECTORY]",
                error,
              );
              mark("serviceProviders", "error", error);
            },
          );
        } catch (error) {
          mark("teams", "error", error);
          mark("serviceProviders", "error", error);
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribeTeams();
          unsubscribeServiceProviders();
        }
      },

      keepUnusedDataFor: 30,
    }),

    getTargetedBatchMapById: builder.query({
      queryFn: (arg) => {
        const { tbId, lmPcode } = resolveTargetedBatchMapArgs(arg);
        const data = createTargetedBatchMapStreamState(
          tbId ? "syncing" : "ready",
        );

        data.diagnostics.expectedLmPcode = lmPcode || null;

        return { data };
      },

      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const { tbId: normalizedTbId, lmPcode: expectedLmPcode } =
          resolveTargetedBatchMapArgs(arg);

        if (!normalizedTbId) return;

        let active = true;
        let unsubscribeBatch = () => {};
        let unsubscribeRows = () => {};
        let diagnosticLogCount = 0;
        let lastDiagnosticKey = "";

        const sourceStatuses = {
          batch: "syncing",
          rows: "syncing",
          erfs: "idle",
          premises: "idle",
          meters: "idle",
        };
        const sourceErrors = {};
        const rawState = {
          batch: null,
          rows: [],
          erfById: {},
          premiseById: {},
          meterById: {},
        };
        const assetStreams = {
          erfs: {
            collectionName: MAP_ERFS_COLLECTION,
            rawStateKey: "erfById",
            idsKey: null,
            unsubscribes: [],
          },
          premises: {
            collectionName: MAP_PREMISES_COLLECTION,
            rawStateKey: "premiseById",
            idsKey: null,
            unsubscribes: [],
          },
          meters: {
            collectionName: MAP_METERS_COLLECTION,
            rawStateKey: "meterById",
            idsKey: null,
            unsubscribes: [],
          },
        };

        const clearUnsubscribes = (unsubscribes) => {
          unsubscribes.forEach((unsubscribe) => {
            try {
              unsubscribe();
            } catch (error) {
              console.warn(
                "[SALES TARGETED BATCH API][MAP LISTENER CLEANUP]",
                error,
              );
            }
          });
        };

        const markSource = (source, status, error = null) => {
          sourceStatuses[source] = status;

          if (error) {
            sourceErrors[source] = normalizeStreamError(error, source);
          } else {
            delete sourceErrors[source];
          }
        };

        const publish = () => {
          if (!active) return;

          const syncedAtMs = Date.now();
          const readModel = buildTargetedBatchMapReadModel({
            tbId: normalizedTbId,
            expectedLmPcode,
            batch: rawState.batch,
            rows: rawState.rows,
            erfById: rawState.erfById,
            premiseById: rawState.premiseById,
            meterById: rawState.meterById,
          });
          const firstError = Object.values(sourceErrors)[0] || null;
          const overallStatus = getOverallReportStatus(sourceStatuses);

          updateCachedData((draft) => {
            draft.batch = readModel.batch;
            draft.membership = readModel.membership;
            draft.erfs = readModel.erfs;
            draft.premises = readModel.premises;
            draft.meters = readModel.meters;
            draft.diagnostics = readModel.diagnostics;
            draft.sync.status = overallStatus;
            draft.sync.sources = { ...sourceStatuses };
            draft.sync.firstSnapshotAtMs ??= syncedAtMs;
            draft.sync.lastSyncAtMs = syncedAtMs;
            draft.sync.error = firstError;
          });

          if (
            diagnosticLogCount < 10 &&
            ["ready", "error"].includes(overallStatus)
          ) {
            const diagnostics = readModel.diagnostics;
            const diagnosticKey = JSON.stringify({
              rows: diagnostics.rows,
              erfRefs: diagnostics.erfRefs,
              erfsFound: diagnostics.erfsFound,
              erfsWithGeometry: diagnostics.erfsWithGeometry,
              premiseRefs: diagnostics.premiseRefs,
              premisesFound: diagnostics.premisesFound,
              premisesWithGps: diagnostics.premisesWithGps,
              meterRefs: diagnostics.meterRefs,
              metersFound: diagnostics.metersFound,
              metersWithGps: diagnostics.metersWithGps,
              missingErfCount: diagnostics.missingErfCount,
              missingPremiseCount: diagnostics.missingPremiseCount,
              missingMeterCount: diagnostics.missingMeterCount,
              status: overallStatus,
            });

            if (diagnosticKey !== lastDiagnosticKey) {
              lastDiagnosticKey = diagnosticKey;
              diagnosticLogCount += 1;

              console.info(
                "[SALES TARGETED BATCH API][MAP DIAGNOSTICS]",
                {
                  tbId: normalizedTbId,
                  status: overallStatus,
                  rows: diagnostics.rows,
                  erfRefs: diagnostics.erfRefs,
                  erfsFound: diagnostics.erfsFound,
                  erfsWithGeometry: diagnostics.erfsWithGeometry,
                  premiseRefs: diagnostics.premiseRefs,
                  premisesFound: diagnostics.premisesFound,
                  premisesWithGps: diagnostics.premisesWithGps,
                  meterRefs: diagnostics.meterRefs,
                  metersFound: diagnostics.metersFound,
                  metersWithGps: diagnostics.metersWithGps,
                  rowsMissingErfRef: diagnostics.rowsMissingErfRef,
                  rowsMissingPremiseRef:
                    diagnostics.rowsMissingPremiseRef,
                  rowsMissingMeterRef: diagnostics.rowsMissingMeterRef,
                  missingErfCount: diagnostics.missingErfCount,
                  missingPremiseCount: diagnostics.missingPremiseCount,
                  missingMeterCount: diagnostics.missingMeterCount,
                  missingErfIds: diagnostics.missingErfIds,
                  missingPremiseIds: diagnostics.missingPremiseIds,
                  missingMeterIds: diagnostics.missingMeterIds,
                  lmPcodeMatches: diagnostics.lmPcodeMatches,
                },
              );
            }
          }
        };

        const handleSourceError = (source, error) => {
          console.error(
            `[SALES TARGETED BATCH API][MAP ${source.toUpperCase()} STREAM]`,
            error,
          );
          markSource(source, "error", error);
          publish();
        };

        const restartAssetListeners = (source, ids) => {
          if (!active) return;

          const assetStream = assetStreams[source];
          const nextIdsKey = ids.join("|");

          if (nextIdsKey === assetStream.idsKey) return;

          assetStream.idsKey = nextIdsKey;
          clearUnsubscribes(assetStream.unsubscribes);
          assetStream.unsubscribes = [];
          rawState[assetStream.rawStateKey] = {};

          if (ids.length === 0) {
            markSource(source, "ready");
            publish();
            return;
          }

          markSource(source, "syncing");
          const chunks = chunkValues(ids);
          const chunkResults = new Map();
          const chunkErrors = new Set();

          chunks.forEach((idChunk, chunkIndex) => {
            const unsubscribe = onSnapshot(
              query(
                collection(db, assetStream.collectionName),
                where(documentId(), "in", idChunk),
              ),
              (snapshot) => {
                if (
                  !active ||
                  nextIdsKey !== assetStream.idsKey
                ) {
                  return;
                }

                const documents = {};
                snapshot.docs.forEach((documentSnapshot) => {
                  documents[documentSnapshot.id] = {
                    id: documentSnapshot.id,
                    ...documentSnapshot.data(),
                  };
                });

                chunkResults.set(chunkIndex, documents);
                chunkErrors.delete(chunkIndex);
                rawState[assetStream.rawStateKey] =
                  combineChunkMaps(chunkResults);

                if (chunkResults.size === chunks.length) {
                  markSource(
                    source,
                    chunkErrors.size > 0 ? "error" : "ready",
                    chunkErrors.size > 0
                      ? new Error(
                          `One or more Targeted Batch Map ${source} streams failed.`,
                        )
                      : null,
                  );
                }

                publish();
              },
              (error) => {
                if (
                  !active ||
                  nextIdsKey !== assetStream.idsKey
                ) {
                  return;
                }

                console.error(
                  `[SALES TARGETED BATCH API][MAP ${source.toUpperCase()} JOIN]`,
                  error,
                );
                chunkErrors.add(chunkIndex);
                markSource(source, "error", error);
                publish();
              },
            );

            assetStream.unsubscribes.push(unsubscribe);
          });

          publish();
        };

        const restartAllAssetListeners = () => {
          const membership = getTargetedBatchMapMembership(rawState.rows);

          restartAssetListeners("erfs", membership.erfIds);
          restartAssetListeners("premises", membership.premiseIds);
          restartAssetListeners("meters", membership.meterIds);
        };

        try {
          await cacheDataLoaded;

          unsubscribeBatch = onSnapshot(
            doc(db, TARGETED_BATCH_UPLOADS_COLLECTION, normalizedTbId),
            (snapshot) => {
              if (!active) return;

              rawState.batch = snapshot.exists()
                ? {
                    id: snapshot.id,
                    ...snapshot.data(),
                  }
                : null;
              markSource("batch", "ready");
              publish();
            },
            (error) => handleSourceError("batch", error),
          );

          unsubscribeRows = onSnapshot(
            query(
              collection(db, TARGETED_BATCH_ROWS_COLLECTION),
              where("tbId", "==", normalizedTbId),
            ),
            (snapshot) => {
              if (!active) return;

              rawState.rows = snapshot.docs
                .map((rowSnapshot) => ({
                  id: rowSnapshot.id,
                  ...rowSnapshot.data(),
                }))
                .sort(
                  (left, right) =>
                    Number(left?.rowNo || 0) -
                    Number(right?.rowNo || 0),
                );
              markSource("rows", "ready");
              restartAllAssetListeners();
              publish();
            },
            (error) => {
              markSource("erfs", "error", error);
              markSource("premises", "error", error);
              markSource("meters", "error", error);
              handleSourceError("rows", error);
            },
          );
        } catch (error) {
          console.error(
            "[SALES TARGETED BATCH API][MAP SETUP]",
            error,
          );

          Object.keys(sourceStatuses).forEach((source) => {
            if (sourceStatuses[source] !== "ready") {
              markSource(source, "error", error);
            }
          });
          publish();
        }

        try {
          await cacheEntryRemoved;
        } finally {
          active = false;
          unsubscribeBatch();
          unsubscribeRows();

          Object.values(assetStreams).forEach((assetStream) => {
            clearUnsubscribes(assetStream.unsubscribes);
          });
        }
      },

      keepUnusedDataFor: 300,
    }),
  }),
});

export const {
  useGetSalesOperationalStatsByLmQuery,
  useGetTargetedBatchAllocationContextByIdQuery,
  useGetTargetedBatchAllocationDirectoryQuery,
  useGetTargetedBatchAllocationMatrixByLmQuery,
  useGetTargetedBatchAllocationRowsByLmQuery,
  useGetTargetedBatchDashboardQuery,
  useGetTargetedBatchHeadersByLmQuery,
  useGetTargetedBatchMapByIdQuery,
  useGetTargetedBatchReportByIdQuery,
} = salesTargetedBatchApi;
