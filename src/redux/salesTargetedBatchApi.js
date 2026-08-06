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
  buildTargetedBatchHeaders,
  buildTargetedBatchReport,
  cleanText,
  getSalesOperationalPremiseIds,
  getTargetedBatchPremiseIds,
  getTargetedBatchSalesIds,
} from "../pages/sales/models/salesTargetedBatchReadModel";

const TARGETED_BATCH_UPLOADS_COLLECTION = "tb_uploads";
const TARGETED_BATCH_ROWS_COLLECTION = "tb_rows";
const SALES_COLLECTION = "demo_sales_meters";
const REPORTING_PREMISES_COLLECTION = "registry_premises";
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
  }),
});

export const {
  useGetSalesOperationalStatsByLmQuery,
  useGetTargetedBatchHeadersByLmQuery,
  useGetTargetedBatchReportByIdQuery,
} = salesTargetedBatchApi;
