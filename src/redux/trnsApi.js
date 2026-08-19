import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  collection,
  doc,
  getDoc,
  limit as limitQuery,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";

const TRNS_COLLECTION = "trns";

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

function normalizeStringCode(value) {
  if (value === null || value === undefined || value === "") return "NAv";

  if (typeof value === "string" || typeof value === "number") {
    return valueOrNav(value);
  }

  if (typeof value === "boolean") {
    return value ? "SUCCESS" : "UNSUCCESSFUL";
  }

  if (typeof value === "object") {
    return valueOrNav(
      value.outcome ||
        value.code ||
        value.id ||
        value.state ||
        value.status ||
        value.result ||
        value.answer ||
        value.label ||
        value.name,
    );
  }

  return valueOrNav(value);
}

function hasMeaningfulValue(value) {
  const text = String(value || "").trim();
  return Boolean(text && text !== "NAv" && text !== "NAV" && text !== "-");
}

function getWorkflowState(data = {}) {
  return valueOrNav(data.workflow?.state || data.workflowState || data.state);
}

function getTcId(data = {}) {
  return valueOrNav(
    data.origin?.tcId ||
      data.bgo?.tcId ||
      data.tcId ||
      data.refs?.tcId ||
      data.refs?.tcUploadId ||
      data.upload?.tcId,
  );
}

function getBgoBatchId(data = {}) {
  return valueOrNav(
    data.bgo?.batchId ||
      data.bgo?.bgoBatchId ||
      data.origin?.bgoBatchId ||
      data.bucket?.batchId ||
      data.bgoBatchId ||
      data.batchId ||
      data.refs?.bgoBatchId ||
      data.refs?.batchId,
  );
}

function getBgoRowId(data = {}) {
  return valueOrNav(
    data.bgo?.bgoRowId ||
      data.bgoRowId ||
      data.origin?.bgoRowId ||
      data.refs?.bgoRowId,
  );
}

function getTcRowId(data = {}) {
  return valueOrNav(
    data.origin?.tcRowId || data.bgo?.tcRowId || data.tcRowId || data.refs?.tcRowId,
  );
}

function getExecutionOutcome(data = {}) {
  const explicitOutcome = data.executionOutcome || data.executionOutcomeCode;
  const normalized = normalizeStringCode(explicitOutcome);

  if (normalized !== "NAv") return normalized;

  const hasAccess = data.accessData?.access?.hasAccess;

  if (String(hasAccess || "").trim().toLowerCase() === "no") {
    return "NO_ACCESS";
  }

  return "NAv";
}

function getOutcomeSuccess(data = {}) {
  if (typeof data.executionOutcome?.success === "boolean") {
    return data.executionOutcome.success;
  }

  const outcome = String(getExecutionOutcome(data) || "").trim().toUpperCase();
  if (!hasMeaningfulValue(outcome)) return null;

  return outcome === "SUCCESS";
}

function getIssuedAt(data = {}) {
  return normalizeDateValue(data.workflow?.issuedAt || data.metadata?.createdAt);
}

function getAcceptedAt(data = {}) {
  return normalizeDateValue(
    data.assignment?.acceptedRejectedAt ||
      data.assignment?.acceptedAt ||
      data.workflow?.acceptedAt,
  );
}

function getExecutionStartedAt(data = {}) {
  return normalizeDateValue(data.workflow?.executionStartedAt);
}

function getCompletedAt(data = {}) {
  return normalizeDateValue(data.workflow?.completedAt);
}

function getCancelledAt(data = {}) {
  return normalizeDateValue(data.assignment?.cancelledAt || data.workflow?.cancelledAt);
}

function getCompletedByUser(data = {}) {
  return valueOrNav(data.workflow?.completedByUser || data.metadata?.updatedByUser);
}

function getIssuedByUser(data = {}) {
  return valueOrNav(data.workflow?.issuedByUser || data.metadata?.createdByUser);
}

function getAssignedTarget(data = {}) {
  const targets = asArray(data.assignment?.targets);
  const target = targets[0] || data.assignment?.target || data.bgo?.target || {};

  return {
    type: valueOrNav(target.type || data.bgo?.targetType),
    id: valueOrNav(target.id || target.uid || data.bgo?.targetId),
    name: valueOrNav(target.name || target.displayName || data.bgo?.targetName),
  };
}

function getPrimaryGeofence(data = {}) {
  const refs = asArray(data.geofenceRefs);
  const ref = refs[0] || {};

  return {
    id: valueOrNav(ref.id || data.bgo?.geofenceId),
    name: valueOrNav(ref.name || data.bgo?.geofenceName),
  };
}


function getWardNoFromPcode(wardPcode = "") {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);
  if (!match) return "NAv";

  const wardNo = Number(match[1]);
  return Number.isFinite(wardNo) ? wardNo : "NAv";
}

function normalizeRegistryCode(value) {
  const normalized = valueOrNav(value);
  if (normalized === "NAv") return "NAv";
  return String(normalized).trim().toUpperCase();
}

function getRegistryCreatedForName(data = {}) {
  const directName = data.assignment?.createdFor?.name;
  if (hasMeaningfulValue(directName)) return directName;

  const targets = asArray(data.assignment?.targets);
  const firstTarget = targets.find((target) =>
    hasMeaningfulValue(target?.name || target?.displayName),
  );

  return valueOrNav(firstTarget?.name || firstTarget?.displayName);
}

function getRegistryAssignedUserIds(data = {}) {
  const targets = [...asArray(data.assignment?.targets)];
  const singleTarget = data.assignment?.target || data.bgo?.target;

  if (singleTarget && typeof singleTarget === "object") {
    targets.push(singleTarget);
  }

  const userIds = targets
    .filter((target) => {
      const targetType = normalizeRegistryCode(
        target?.type || target?.targetType || data.bgo?.targetType,
      );

      return targetType === "USER";
    })
    .map((target) =>
      String(target?.id || target?.uid || data.bgo?.targetId || "").trim(),
    )
    .filter(Boolean);

  return Array.from(new Set(userIds));
}

function getRegistryOriginChannel(data = {}) {
  return normalizeRegistryCode(
    data.origin?.channel || data.workflow?.createdMode,
  );
}

function getRegistryAcceptedRejected(data = {}) {
  const workflowState = String(getWorkflowState(data) || "")
    .trim()
    .toUpperCase();
  const rejectReason = String(data.assignment?.rejectReason || "").trim();
  const hasExplicitRejected = Boolean(
    data.workflow?.rejectedAt ||
      data.workflow?.rejectedByUid ||
      data.workflow?.rejectedByUser ||
      hasMeaningfulValue(rejectReason),
  );
  const hasExplicitAccepted = Boolean(
    data.workflow?.acceptedAt ||
      data.workflow?.acceptedByUid ||
      data.workflow?.acceptedByUser ||
      data.assignment?.acceptedAt ||
      data.assignment?.acceptedRejectedAt,
  );

  if (workflowState === "REJECTED" || hasExplicitRejected) return "REJECTED";
  if (workflowState === "WAITING_BATCH_ACCEPTANCE") return "PENDING";
  if (workflowState === "ACCEPTED" || hasExplicitAccepted) return "ACCEPTED";

  return "NAv";
}

function getRegistryAnomalyInfo(data = {}) {
  const astAnomalies = data.ast?.anomalies || {};
  const inspectionAnomalies =
    data.inspection?.captured?.ast?.anomalies || {};

  return {
    anomaly: valueOrNav(astAnomalies.anomaly || inspectionAnomalies.anomaly),
    anomalyDetail: valueOrNav(
      astAnomalies.anomalyDetail || inspectionAnomalies.anomalyDetail,
    ),
  };
}

function normalizeTrnRegistryDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const metadata = data.metadata || {};
  const trnId = data.trnId || data.id || docSnap.id;
  const anomalyInfo = getRegistryAnomalyInfo(data);
  const meterNo = valueOrNav(data.ast?.astData?.astNo);

  return {
    trnId,
    trnType: normalizeRegistryCode(data.accessData?.trnType || data.trnType),
    wardPcode: valueOrNav(data.accessData?.parents?.wardPcode),
    wardNo: getWardNoFromPcode(data.accessData?.parents?.wardPcode),
    erfId: valueOrNav(data.accessData?.erfId),
    erfNo: valueOrNav(data.accessData?.erfNo),
    premiseAddress: valueOrNav(data.accessData?.premise?.address),
    hasAccess: normalizeRegistryCode(data.accessData?.access?.hasAccess),
    accessReason: valueOrNav(data.accessData?.access?.reason),
    meterNo,
    astNo: meterNo,
    meterType: normalizeRegistryCode(data.meterType),
    astState: normalizeRegistryCode(data.status?.state),
    anomaly: anomalyInfo.anomaly,
    anomalyDetail: anomalyInfo.anomalyDetail,
    mediaCount: asArray(data.media).length,
    originChannel: getRegistryOriginChannel(data),
    createdByUid: valueOrNav(metadata.createdByUid),
    createdByUser: valueOrNav(metadata.createdByUser),
    updatedByUid: valueOrNav(metadata.updatedByUid),
    createdAt: normalizeDateValue(metadata.createdAt || data.createdAt),
    lastUpdatedAt: normalizeDateValue(metadata.updatedAt || data.updatedAt),
    createdForName: getRegistryCreatedForName(data),
    assignedUserIds: getRegistryAssignedUserIds(data),
    issuedAt: normalizeDateValue(data.workflow?.issuedAt),
    acceptedRejected: getRegistryAcceptedRejected(data),
    executionStartedAt: normalizeDateValue(data.workflow?.executionStartedAt),
    completedAt: normalizeDateValue(data.workflow?.completedAt),
    completedByUser: valueOrNav(data.workflow?.completedByUser),
    workflowState: normalizeRegistryCode(getWorkflowState(data)),
  };
}

function normalizeTrnDoc(docSnap) {
  if (!docSnap || !docSnap.exists()) return null;

  const data = docSnap.data() || {};
  const metadata = data.metadata || {};
  const workflowState = getWorkflowState(data);
  const tcId = getTcId(data);
  const bgoBatchId = getBgoBatchId(data);
  const bgoRowId = getBgoRowId(data);
  const tcRowId = getTcRowId(data);
  const target = getAssignedTarget(data);
  const geofenceRef = getPrimaryGeofence(data);
  const executionOutcomeCode = getExecutionOutcome(data);

  return {
    id: data.id || data.trnId || docSnap.id,
    trnId: data.trnId || data.id || docSnap.id,
    tcId,
    bgoBatchId,
    batchId: bgoBatchId,
    bgoRowId,
    tcRowId,
    bgoKind: valueOrNav(data.bgo?.kind),
    releaseState: valueOrNav(data.bgo?.releaseState),
    hiddenUntilBatchAccepted: data.bgo?.hiddenUntilBatchAccepted === true,
    trnType: valueOrNav(data.trnType || data.accessData?.trnType),
    workflowState,
    state: workflowState,
    executionOutcomeCode,
    outcome: executionOutcomeCode,
    executionSuccess: getOutcomeSuccess(data),
    target,
    targetType: target.type,
    targetId: target.id,
    targetName: target.name,
    geofenceRef,
    geofenceId: geofenceRef.id,
    geofenceName: geofenceRef.name,
    meterType: valueOrNav(data.meterType),
    astId: valueOrNav(data.astId || data.ast?.astData?.astId),
    astNo: valueOrNav(data.ast?.astData?.astNo),
    premiseId: valueOrNav(data.premiseId || data.accessData?.premise?.id),
    erfNo: valueOrNav(data.accessData?.erfNo),
    address: valueOrNav(data.accessData?.premise?.address),
    statusState: valueOrNav(data.status?.state),
    issuedAt: getIssuedAt(data),
    acceptedAt: getAcceptedAt(data),
    executionStartedAt: getExecutionStartedAt(data),
    completedAt: getCompletedAt(data),
    cancelledAt: getCancelledAt(data),
    issuedByUser: getIssuedByUser(data),
    completedByUser: getCompletedByUser(data),
    workflow: {
      ...(data.workflow || {}),
      state: workflowState,
      issuedAt: getIssuedAt(data),
      acceptedAt: getAcceptedAt(data),
      executionStartedAt: getExecutionStartedAt(data),
      completedAt: getCompletedAt(data),
      cancelledAt: getCancelledAt(data),
      issuedByUser: getIssuedByUser(data),
      completedByUser: getCompletedByUser(data),
    },
    metadata: {
      ...metadata,
      createdAt: normalizeDateValue(metadata.createdAt || data.createdAt),
      updatedAt: normalizeDateValue(metadata.updatedAt || data.updatedAt),
    },
    raw: data,
  };
}

function mergeUniqueDocs(snapshots, normalizer) {
  const byId = new Map();

  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docSnapshot) => {
      const normalized = normalizer(docSnapshot);
      const normalizedId = normalized?.id || normalized?.trnId;
      if (!normalizedId) return;
      byId.set(normalizedId, normalized);
    });
  });

  return Array.from(byId.values());
}

function sortTrns(left, right) {
  const leftCreated = String(left?.issuedAt || left?.metadata?.createdAt || "");
  const rightCreated = String(right?.issuedAt || right?.metadata?.createdAt || "");

  if (leftCreated !== rightCreated) return rightCreated.localeCompare(leftCreated);

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function sortRegistryTrns(left, right) {
  const leftCreated = String(left?.createdAt || "");
  const rightCreated = String(right?.createdAt || "");

  if (leftCreated !== rightCreated) return rightCreated.localeCompare(leftCreated);

  return String(left?.trnId || "").localeCompare(String(right?.trnId || ""));
}

function buildTcIdQueries(tcId, maxResults) {
  const collectionRef = collection(db, TRNS_COLLECTION);

  return [
    query(collectionRef, where("origin.tcId", "==", tcId), limitQuery(maxResults)),
    query(collectionRef, where("bgo.tcId", "==", tcId), limitQuery(maxResults)),
  ];
}

function resolveLimit(arg, fallback = 1000) {
  if (typeof arg === "number") return safeNumber(arg, fallback);
  return safeNumber(arg?.limit, fallback);
}

export const trnsApi = createApi({
  reducerPath: "trnsApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (builder) => ({
    getTrnById: builder.query({
      async queryFn(arg) {
        const trnId = String(
          typeof arg === "string" ? arg : arg?.trnId || "",
        ).trim();

        if (!trnId) return { data: null };

        try {
          const trnSnapshot = await getDoc(doc(db, TRNS_COLLECTION, trnId));
          return { data: normalizeTrnDoc(trnSnapshot) };
        } catch (error) {
          console.error("trnsApi getTrnById read error:", error);
          return {
            error: {
              status: "TRN_READ_FAILED",
              error: error?.message || String(error),
            },
          };
        }
      },
    }),

    getTrnsByTcId: builder.query({
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

          buildTcIdQueries(tcId, maxResults).forEach((trnsQuery, index) => {
            const unsubscribe = onSnapshot(
              trnsQuery,
              (snapshot) => {
                latestSnapshots.set(index, snapshot);

                const trns = mergeUniqueDocs(
                  Array.from(latestSnapshots.values()),
                  normalizeTrnDoc,
                ).sort(sortTrns);

                updateCachedData((draft) => {
                  draft.splice(0, draft.length, ...trns);
                });
              },
              (error) => {
                console.error("trnsApi getTrnsByTcId stream error:", error);
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

    getRegistryTrnsByLmPcode: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const lmPcode = String(
          typeof arg === "string" ? arg : arg?.lmPcode || "",
        ).trim();

        if (!lmPcode) return;

        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          const trnsQuery = query(
            collection(db, TRNS_COLLECTION),
            where("accessData.parents.lmPcode", "==", lmPcode),
          );

          unsubscribe = onSnapshot(
            trnsQuery,
            (snapshot) => {
              const trns = mergeUniqueDocs(
                [snapshot],
                normalizeTrnRegistryDoc,
              ).sort(sortRegistryTrns);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...trns);
              });
            },
            (error) => {
              console.error(
                "trnsApi getRegistryTrnsByLmPcode stream error:",
                error,
              );
            },
          );

          await cacheEntryRemoved;
        } finally {
          unsubscribe();
        }
      },
    }),

    getTrnsByLmPcodeWardPcode: builder.query({
      queryFn: () => ({ data: [] }),
      async onCacheEntryAdded(
        arg,
        { updateCachedData, cacheDataLoaded, cacheEntryRemoved },
      ) {
        const lmPcode = String(arg?.lmPcode || "").trim();
        const wardPcode = String(arg?.wardPcode || "").trim();

        if (!lmPcode || !wardPcode) return;

        const maxResults = resolveLimit(arg, 2000);
        let unsubscribe = () => {};

        try {
          await cacheDataLoaded;

          const trnsQuery = query(
            collection(db, TRNS_COLLECTION),
            where("accessData.parents.lmPcode", "==", lmPcode),
            where("accessData.parents.wardPcode", "==", wardPcode),
            limitQuery(maxResults),
          );

          unsubscribe = onSnapshot(
            trnsQuery,
            (snapshot) => {
              const trns = mergeUniqueDocs([snapshot], normalizeTrnDoc).sort(sortTrns);

              updateCachedData((draft) => {
                draft.splice(0, draft.length, ...trns);
              });
            },
            (error) => {
              console.error(
                "trnsApi getTrnsByLmPcodeWardPcode stream error:",
                error,
              );
            },
          );

          await cacheEntryRemoved;
        } finally {
          unsubscribe();
        }
      },
    }),
  }),
});

export const {
  useGetTrnByIdQuery,
  useGetTrnsByTcIdQuery,
  useGetRegistryTrnsByLmPcodeQuery,
  useGetTrnsByLmPcodeWardPcodeQuery,
} = trnsApi;
