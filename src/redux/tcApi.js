import { trnBgoProgress } from "./trnBgoProgress.js";
import { pendingStream, streamQueryHook, failStream } from "./streamReadiness.js";
import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  limit as limitQuery,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { auth, db, functions } from "../firebase";

const TC_UPLOADS_COLLECTION = "tc_uploads";
const TC_ROWS_COLLECTION = "tc_rows";

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

function normalizeGps(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function hasDisplayText(value) {
  const text = String(value || "").trim();

  return Boolean(text && text !== "NAv" && text !== "NAV" && text !== "-");
}

function buildAddress(address = {}) {
  if (typeof address === "string") {
    const addressText = address.trim();
    return hasDisplayText(addressText) ? addressText : "NAv";
  }

  const parts = [address?.strNo, address?.strName, address?.strType]
    .map((part) => String(part || "").trim())
    .filter(hasDisplayText);

  const suburbName = String(address?.suburbName || "").trim();

  if (hasDisplayText(suburbName)) {
    parts.push(suburbName);
  }

  return parts.length ? parts.join(" ") : "NAv";
}

function getWardNoFromPcode(value) {
  const text = String(valueOrNav(value));

  if (text === "NAv") return "NAv";

  const digits = text.replace(/\D/g, "");
  if (!digits) return text;

  const lastThree = digits.slice(-3);
  const wardNo = Number(lastThree);

  return Number.isFinite(wardNo) ? String(wardNo) : text;
}

function normalizeGeoFenceRefs(value) {
  const seen = new Set();

  return asArray(value)
    .map((item) => {
      const id = String(item?.id || "").trim();
      const name = String(item?.name || id || "").trim();

      if (!id && !name) return null;

      return {
        id: id || name,
        name: name || id,
      };
    })
    .filter((item) => {
      if (!item?.id) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeTcUploadDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const summary = data.summary || {};
  const metadata = data.metadata || {};

  return {
    id: data.id || docSnap.id,
    tcId: data.id || docSnap.id,
    sourceFileId: data.sourceFileId || null,
    contractVersion: data.contractVersion || null,
    requestId: data.requestId || null,
    fileName: valueOrNav(data.fileName),
    trnType: valueOrNav(data.trnType),
    trnCode: valueOrNav(data.trnCode),
    lmPcode: valueOrNav(data.lmPcode || data.parents?.lmPcode),
    wardPcode: valueOrNav(data.wardPcode || data.parents?.wardPcode),
    validationState: valueOrNav(data.validationState),
    bgoStatus: valueOrNav(data.bgoStatus),
    workflowState: valueOrNav(data.workflowState || data.workflow?.state),
    assignment: data.assignment || null,
    teamId: data.teamId || data.assignedTeamId || null,
    teamName: data.teamName || null,
    spId: data.spId || null,
    spName: data.spName || null,
    allocatedTo: data.allocatedTo || null,
    writeState: valueOrNav(data.writeState),
    totalRows: safeNumber(data.totalRows ?? summary.totalRows),
    validRows: safeNumber(data.validRows ?? summary.validRows),
    invalidRows: safeNumber(data.invalidRows ?? summary.invalidRows),
    foundRows: safeNumber(data.foundRows ?? summary.foundRows),
    notFoundRows: safeNumber(data.notFoundRows ?? summary.notFoundRows),
    withGeofenceRows: safeNumber(
      data.withGeofenceRows ?? summary.withGeofenceRows,
    ),
    withoutGeofenceRows: safeNumber(
      data.withoutGeofenceRows ?? summary.withoutGeofenceRows,
    ),
    readyRows: safeNumber(data.readyRows ?? summary.readyRows),
    inProgressRows: safeNumber(
      data.inProgressRows ??
        summary.inProgressRows ??
        summary.totalInProgress ??
        data.derivedExecutionSummary?.totalInProgress,
    ),
    completedRows: safeNumber(
      data.completedRows ??
        summary.completedRows ??
        summary.totalCompleted ??
        data.derivedExecutionSummary?.totalCompleted,
    ),
    remainingRows: safeNumber(data.remainingRows ?? summary.remainingRows),
    usedRows: safeNumber(data.usedRows ?? summary.usedRows),
    needsGeofenceRows: safeNumber(
      data.needsGeofenceRows ?? summary.needsGeofenceRows,
    ),
    notEligibleRows: safeNumber(
      data.notEligibleRows ?? summary.notEligibleRows,
    ),
    blockedActiveSameOperationRows: safeNumber(
      data.blockedActiveSameOperationRows ??
        summary.blockedActiveSameOperationRows,
    ),
    duplicateMeterRows: safeNumber(
      data.duplicateMeterRows ?? summary.duplicateMeterRows,
    ),
    summary: {
      ...summary,
      geofenceBreakdown: asArray(summary.geofenceBreakdown),
    },
    dedupe: data.dedupe || null,
    metadata: {
      ...metadata,
      createdAt: normalizeDateValue(metadata.createdAt),
      updatedAt: normalizeDateValue(metadata.updatedAt),
    },
    raw: data,
  };
}

function normalizeFrontend(frontend = {}) {
  return {
    ...frontend,
    valid: frontend.valid === true,
    errors: asArray(frontend.errors),
    warnings: asArray(frontend.warnings),
  };
}

function normalizeBackend(backend = {}) {
  return {
    ...backend,
    matched: backend.matched === true,
    notFound: backend.notFound === true,
    eligible: backend.eligible === true,
    notEligible: backend.notEligible === true,
    duplicateMeterInUpload: backend.duplicateMeterInUpload === true,
    alreadyHasActiveSameOperationTrn:
      backend.alreadyHasActiveSameOperationTrn === true,
    reasonCodes: asArray(backend.reasonCodes),
    errors: asArray(backend.errors),
    warnings: asArray(backend.warnings),
    message: valueOrNav(backend.message),
  };
}

function normalizeBgo(bgo = {}) {
  const readinessState = valueOrNav(bgo.readinessState);
  const used = bgo.used === true || Boolean(bgo.batchId);

  return {
    ...bgo,
    ready: bgo.ready === true,
    used,
    batchId: valueOrNav(bgo.batchId),
    readinessState,
    readinessReason: valueOrNav(bgo.readinessReason),
    usedAt: normalizeDateValue(bgo.usedAt),
  };
}

function normalizeAstSnapshot(ast = {}) {
  const accessData = ast.accessData || {};
  const parents = accessData.parents || ast.parents || {};
  const wardPcode =
    ast.wardPcode || parents.wardPcode || ast.ast?.parents?.wardPcode || "NAv";

  return {
    id: valueOrNav(ast.id || ast.astId || ast.sourceAstId),
    astId: valueOrNav(ast.id || ast.astId || ast.sourceAstId),
    astNo: valueOrNav(ast.astNo || ast.astData?.astNo || ast.ast?.astNo),
    premiseId: valueOrNav(
      ast.premiseId ||
        accessData.premiseId ||
        accessData.premise?.id ||
        ast.premise?.id,
    ),
    statusState: valueOrNav(
      ast.statusState || ast.status?.state || ast.status?.id || ast.state,
    ),
    meterType: valueOrNav(
      ast.meterType ||
        ast.serviceType ||
        ast.astData?.meter?.serviceType ||
        ast.astData?.meter?.type,
    ),
    erfNo: valueOrNav(ast.erfNo || accessData.erfNo || ast.erf?.erfNo),
    erfId: valueOrNav(ast.erfId || accessData.erfId || ast.erf?.id),
    wardPcode: valueOrNav(wardPcode),
    wardNo: valueOrNav(ast.wardNo || getWardNoFromPcode(wardPcode)),
    gps:
      normalizeGps(ast.gps) ||
      normalizeGps(ast.location?.gps) ||
      normalizeGps(ast.ast?.location?.gps) ||
      normalizeGps(ast.astData?.location?.gps),
  };
}

function normalizePremiseSnapshot(premise = {}) {
  const propertyType = premise.propertyType || {};
  const parents = premise.parents || {};
  const wardPcode = premise.wardPcode || parents.wardPcode;

  return {
    id: valueOrNav(premise.id || premise.premiseId),
    premiseId: valueOrNav(premise.premiseId || premise.id),
    address: valueOrNav(premise.addressText || buildAddress(premise.address)),
    propertyType: {
      name: valueOrNav(propertyType.name),
      type: valueOrNav(propertyType.type),
      unitNo: valueOrNav(propertyType.unitNo),
    },
    gps:
      normalizeGps(premise.gps) ||
      normalizeGps(premise.location?.gps) ||
      normalizeGps(premise.geometry?.centroid),
    erfNo: valueOrNav(premise.erfNo),
    wardPcode: valueOrNav(wardPcode),
    wardNo: valueOrNav(premise.wardNo || getWardNoFromPcode(wardPcode)),
  };
}

function normalizeTcRowDoc(docSnap) {
  const data = docSnap.data() || {};
  const input = data.input || data.frontend?.input || {};
  const upload = data.upload || {};
  const frontend = normalizeFrontend(data.frontend || {});
  const backend = normalizeBackend(data.backend || {});
  const bgo = normalizeBgo(data.bgo || {});
  const geofenceRefs = normalizeGeoFenceRefs(data.geofenceRefs);
  const ast = normalizeAstSnapshot({ ...(data.ast || {}) });

  return {
    id: data.id || docSnap.id,
    tcId: valueOrNav(data.tcId || upload.tcId),
    rowNo: safeNumber(data.rowNo ?? input.rowNo ?? data.frontend?.rowNo),
    input: {
      ...input,
      rowNo: safeNumber(input.rowNo ?? data.rowNo),
      meterNo: valueOrNav(input.meterNo || data.meterNo),
      accountNo: valueOrNav(
        input.accountNo || input.linkedAccountNo || data.accountNo || data.linkedAccountNo,
      ),
      reason: valueOrNav(input.reason || data.reason),
      notes: valueOrNav(input.notes || data.notes),
      cycleCode: valueOrNav(input.cycleCode || data.cycleCode),
    },
    frontend,
    backend,
    bgo,
    ast: {
      ...ast,
      geofenceRefs,
    },
    premise: normalizePremiseSnapshot(data.premise || {}),
    geofenceRefs,
    upload,
    raw: data,
  };
}

function sortTcRows(left, right) {
  const leftRowNo = safeNumber(left?.rowNo, Number.MAX_SAFE_INTEGER);
  const rightRowNo = safeNumber(right?.rowNo, Number.MAX_SAFE_INTEGER);

  if (leftRowNo !== rightRowNo) return leftRowNo - rightRowNo;

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function resolveLimit(arg) {
  if (typeof arg === "number") return arg;
  return safeNumber(arg?.limit, 50);
}

export const tcApi = createApi({
  reducerPath: "tcApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getTrnBgoProgress: builder.query({
      queryFn: () => ({ data: { counts: {}, ready: false, error: "" } }),
      async onCacheEntryAdded({ batchIds = [] }, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        const ids = [...new Set(batchIds)].sort();
        const stops = [];
        const latest = new Map();
        const chunks = [];
        for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
        try {
          await cacheDataLoaded;
          if (!ids.length) updateCachedData(draft => { draft.ready = true; });
          chunks.forEach((ids, index) => {
            stops.push(onSnapshot(query(collection(db, "trns"), where("origin.trnBgo.batchId", "in", ids)), snapshot => {
              latest.set(index, snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
              updateCachedData(draft => {
                draft.counts = trnBgoProgress([...latest.values()].flat());
                draft.ready = latest.size === chunks.length;
              });
            }, error => updateCachedData(draft => { draft.ready = true; draft.error = error.message || "Could not load batch progress."; })));
          });
          await cacheEntryRemoved;
        } finally { stops.forEach(stop => stop()); }
      },
    }),

    getTcUploads: builder.query({
      queryFn: () => ({ data: pendingStream([]) }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          if (!auth.currentUser) { updateCachedData(draft => { draft.ready = true; }); return; }
          let epoch = 0;
          let stopQueries = [];
          const stopProfile = onSnapshot(doc(db, "users", auth.currentUser.uid), snapshot => {
            const current = ++epoch;
            stopQueries.forEach(stop => stop()); stopQueries = [];
            const profile = snapshot.data();
            updateCachedData(draft => { draft.value.splice(0, draft.value.length); draft.ready = false; draft.error = null; });
            if (profile?.accountStatus !== "ACTIVE") { updateCachedData(draft => { draft.ready = true; }); return; }
            const pc = value => typeof value === "string" ? value : value?.lmPcode || value?.pcode || value?.id;
            const grants = [...new Set([profile.access?.activeWorkbase, ...(profile.access?.workbases || [])].map(pc).filter(Boolean))];
            const requested = typeof arg === "object" ? arg.lmPcode : null;
            const scopes = requested ? grants.filter(lm => lm === requested) : grants;
            const latest = new Map();
            if (!scopes.length) updateCachedData(draft => { draft.ready = true; });
            scopes.forEach(lm => {
              const uploadsQuery = query(collection(db, TC_UPLOADS_COLLECTION), where("lmPcode", "==", lm), orderBy("metadata.createdAt", "desc"), limitQuery(resolveLimit(arg)));
              stopQueries.push(onSnapshot(uploadsQuery, docs => {
                if (current !== epoch) return;
                latest.set(lm, docs.docs.map(normalizeTcUploadDoc).filter(row=>row && row.workflowState!=="DELETED"));
                const rows = [...latest.values()].flat().sort((a,b)=>String(b.metadata?.createdAt||"").localeCompare(String(a.metadata?.createdAt||"")));
                updateCachedData(draft => { draft.value.splice(0, draft.value.length, ...rows); draft.ready = latest.size === scopes.length; });
              }, error => { if (current !== epoch) return; latest.delete(lm); updateCachedData(draft => { draft.value.splice(0, draft.value.length, ...[...latest.values()].flat()); failStream(draft, error); }); }));
            });
          }, error => updateCachedData(draft => { draft.value.splice(0, draft.value.length); failStream(draft, error); }));
          unsubscribe = () => { epoch++; stopProfile(); stopQueries.forEach(stop => stop()); };

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) unsubscribe();
        }
      },
    }),

    getTcUploadById: builder.query({
      queryFn: () => ({ data: pendingStream(null) }),
      async onCacheEntryAdded(
        tcId,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!tcId) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          unsubscribe = onSnapshot(
            doc(db, TC_UPLOADS_COLLECTION, tcId),
            (docSnapshot) => {
              const upload = normalizeTcUploadDoc(docSnapshot);

              updateCachedData(draft => { draft.value = upload; draft.ready = true; draft.error = null; });
            },
            (error) => {
              updateCachedData(draft => { draft.value = null; failStream(draft, error); });
              console.error("tcApi getTcUploadById stream error:", error);
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) unsubscribe();
        }
      },
    }),

    getTcRowsByTcId: builder.query({
      queryFn: () => ({ data: pendingStream([]) }),
      async onCacheEntryAdded(
        tcId,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        if (!tcId) return;

        let unsubscribe = null;

        try {
          await cacheDataLoaded;

          const rowsQuery = query(
            collection(db, TC_ROWS_COLLECTION),
            where("tcId", "==", tcId),
          );

          unsubscribe = onSnapshot(
            rowsQuery,
            (snapshot) => {
              const rows = snapshot.docs
                .map((docSnapshot) => normalizeTcRowDoc(docSnapshot))
                .sort(sortTcRows);

              updateCachedData((draft) => {
                draft.value.splice(0, draft.value.length, ...rows); draft.ready = true;
              });
            },
            (error) => {
              updateCachedData(draft => { draft.value = []; failStream(draft, error); });
              console.error("tcApi getTcRowsByTcId stream error:", error);
            },
          );

          await cacheEntryRemoved;
        } finally {
          if (unsubscribe) unsubscribe();
        }
      },
    }),

    createTrnBgoWardBatches: builder.mutation({
      async queryFn(payload) {
        try {
          const callable = httpsCallable(
            functions,
            "onCreateTrnBgoWardBatchesCallable",
          );
          const response = await callable(payload || {});
          return { data: response.data };
        } catch (error) {
          return {
            error: {
              message:
                error?.message || "Failed to create TRN BGO ward batches.",
              code: error?.code || "unknown",
              details: error?.details || null,
            },
          };
        }
      },
    }),

    allocateTrnBgoWardBatches: builder.mutation({
      async queryFn(payload) {
        try {
          const callable = httpsCallable(
            functions,
            "onAllocateTrnBgoWardBatchesCallable",
          );
          const response = await callable(payload || {});
          return { data: response.data };
        } catch (error) {
          return {
            error: {
              message:
                error?.message || "Failed to allocate TRN BGO ward batches.",
              code: error?.code || "unknown",
              details: error?.details || null,
            },
          };
        }
      },
    }),

    uploadAndValidateTc: builder.mutation({
      async queryFn(payload) {
        try {
          const callable = httpsCallable(
            functions,
            "onUploadAndValidateTcCallable",
          );
          const response = await callable(payload || {});

          return { data: response.data };
        } catch (error) {
          return {
            error: {
              message:
                error?.message || "Failed to upload and validate TC file.",
              code: error?.code || "unknown",
              details: error?.details || null,
            },
          };
        }
      },
    }),

    deleteTcUpload: builder.mutation({
      async queryFn(payload) {
        try {
          const callable = httpsCallable(functions, "onDeleteTcUploadCallable");
          const response = await callable(payload || {});

          return { data: response.data };
        } catch (error) {
          return {
            error: {
              message: error?.message || "Failed to delete TC upload.",
              code: error?.code || "unknown",
              details: error?.details || null,
            },
          };
        }
      },
    }),

    refreshTcUploadGeofenceReadiness: builder.mutation({
      async queryFn(payload) {
        try {
          const callable = httpsCallable(
            functions,
            "onRefreshTcUploadGeofenceReadinessCallable",
          );
          const response = await callable(payload || {});

          return { data: response.data };
        } catch (error) {
          return {
            error: {
              message:
                error?.message ||
                "Failed to refresh TC geofence readiness.",
              code: error?.code || "unknown",
              details: error?.details || null,
            },
          };
        }
      },
    }),
  }),
});

export const {
  useGetTrnBgoProgressQuery,
  useGetTcUploadsQuery: useGetTcUploadsQueryRaw,
  useGetTcUploadByIdQuery: useGetTcUploadByIdQueryRaw,
  useGetTcRowsByTcIdQuery: useGetTcRowsByTcIdQueryRaw,
  useCreateTrnBgoWardBatchesMutation,
  useAllocateTrnBgoWardBatchesMutation,
  useUploadAndValidateTcMutation,
  useDeleteTcUploadMutation,
  useRefreshTcUploadGeofenceReadinessMutation,
} = tcApi;

export const useGetTcUploadsQuery = streamQueryHook(useGetTcUploadsQueryRaw);

export const useGetTcUploadByIdQuery = streamQueryHook(useGetTcUploadByIdQueryRaw);

export const useGetTcRowsByTcIdQuery = streamQueryHook(useGetTcRowsByTcIdQueryRaw);
