import {
  BGO_CHILD_RELEASE_STATES,
  BGO_SOURCE,
  buildBgoChildTrnId,
  buildHistoryEvent,
  buildRootMetadata,
  getTrnShortCode,
  safeArray,
  safeJsonClone,
} from "./helpers.js";

import {
  buildLifecycleInstructionTrnPayload,
  buildTrnActiveLifecycle,
} from "../meterLifecycle/helpers.js";

function buildInstructionText(trnType) {
  switch (trnType) {
    case "METER_DISCONNECTION":
      return "Disconnect meter from BGO allocation";
    case "METER_RECONNECTION":
      return "Reconnect meter from BGO allocation";
    case "METER_REMOVAL":
      return "Remove meter from BGO allocation";
    case "METER_READING":
      return "Capture meter reading from BGO allocation";
    case "METER_INSPECTION":
      return "Inspect meter from BGO allocation";
    case "METER_DISCOVERY":
      return "Discover/register meter from BGO allocation";
    case "METER_INSTALLATION":
      return "Install/register meter from BGO allocation";
    default:
      return "Execute BGO work item";
  }
}

function normalizeFactoryText(value) {
  return String(value || "").trim();
}

function getBgoMeterType(rowData = {}, astDoc = {}) {
  return (
    normalizeFactoryText(rowData?.ast?.meterType) ||
    normalizeFactoryText(rowData?.input?.meterType) ||
    normalizeFactoryText(astDoc?.meterType) ||
    normalizeFactoryText(astDoc?.ast?.meterType) ||
    normalizeFactoryText(astDoc?.ast?.astData?.meterType) ||
    "NAv"
  );
}

function getBgoWardPcode(rowData = {}, astDoc = {}) {
  return (
    normalizeFactoryText(rowData?.ast?.wardPcode) ||
    normalizeFactoryText(rowData?.premise?.wardPcode) ||
    normalizeFactoryText(astDoc?.accessData?.parents?.wardPcode) ||
    normalizeFactoryText(astDoc?.parents?.wardPcode) ||
    "NAv"
  );
}

function getBgoErfNo(rowData = {}, astDoc = {}, premiseData = {}) {
  return (
    normalizeFactoryText(rowData?.ast?.erfNo) ||
    normalizeFactoryText(rowData?.premise?.erfNo) ||
    normalizeFactoryText(premiseData?.erfNo) ||
    normalizeFactoryText(astDoc?.accessData?.erfNo) ||
    normalizeFactoryText(astDoc?.accessData?.erf?.erfNo) ||
    "NAv"
  );
}

function buildEmptyLifecycleDraftSections(trnType) {
  const normalizedTrnType = String(trnType || "").toUpperCase();

  return {
    executionOutcome: null,

    disconnection:
      normalizedTrnType === "METER_DISCONNECTION"
        ? {
            level: {
              code: "",
              label: "",
              otherText: "",
            },
            meterReading: "",
            tokenReading: "",
            noReadingReason: "",
            safetyConfirmed: {
              answer: null,
              notes: "",
            },
            supplyDisconnected: {
              answer: null,
              notes: "",
            },
          }
        : null,

    reconnection:
      normalizedTrnType === "METER_RECONNECTION"
        ? {
            meterReading: "",
            tokenReading: "",
            noReadingReason: "",
            safetyConfirmed: {
              answer: null,
              notes: "",
            },
            supplyReconnected: {
              answer: null,
              notes: "",
            },
          }
        : null,

    removal:
      normalizedTrnType === "METER_REMOVAL"
        ? {
            meterReading: "",
            tokenReading: "",
            noReadingReason: "",
            safetyConfirmed: {
              answer: null,
              notes: "",
            },
            meterRemoved: {
              answer: null,
              notes: "",
            },
          }
        : null,

    meterReading:
      normalizedTrnType === "METER_READING"
        ? {
            reading: "",
            tokenReading: "",
            readingAt: null,
            noReadingReason: "",
            readingGps: null,
            executorNotes: "",
          }
        : null,

    inspection: normalizedTrnType === "METER_INSPECTION" ? {} : null,
  };
}

export function buildBgoBatchDoc({
  bgoBatchId,
  tcId,
  tcUpload,
  trnType,
  geofenceRef,
  target,
  rowCount,
  trnIds,
  now,
  actorUid,
  actorName,
}) {
  const operationCode = getTrnShortCode(trnType);

  return {
    id: bgoBatchId,
    tcId,
    trnType: "BULK_GEOFENCE_ORIGIN",
    operationType: trnType,
    operationCode,

    origin: {
      channel: "OFFICE",
      source: "BGO",
      sourceModule: BGO_SOURCE,
      tcId,
      createdMode: "OFFICE",
    },

    assignment: {
      targets: [target],
      instruction: {
        code: trnType,
        text: `${trnType} bulk geofence allocation`,
        notes: "NAv",
        mediaRequired: true,
      },
    },

    geofenceRef,

    workflow: {
      state: "ISSUED",
      createdMode: "OFFICE",
      issuedAt: now,
      issuedByUid: actorUid || "NAv",
      issuedByUser: actorName || "NAv",
      acceptedAt: null,
      acceptedByUid: null,
      acceptedByUser: null,
      rejectedAt: null,
      rejectedByUid: null,
      rejectedByUser: null,
      rejectReason: "",
      cancelledAt: null,
      cancelledByUid: null,
      cancelledByUser: null,
      completedAt: null,
      completedByUid: null,
      completedByUser: null,
    },

    summary: {
      totalRows: rowCount,
      totalTrnsCreated: trnIds.length,
      totalWaitingBatchAcceptance: rowCount,
      totalReleased: 0,
      totalAccepted: 0,
      totalInProgress: 0,
      totalCompleted: 0,
      totalSuccess: 0,
      totalNoAccess: 0,
      totalNoReading: 0,
      totalRejected: 0,
      totalCancelled: 0,
    },

    bgo: {
      kind: "BGO_BATCH",
      tcId,
      batchId: bgoBatchId,
      targetType: target.type,
      targetId: target.id,
      geofenceId: geofenceRef.id,
      releaseState: BGO_CHILD_RELEASE_STATES.waiting,
    },

    refs: {
      tcUploadId: tcId,
      trnIds,
    },

    sourceUpload: {
      id: tcId,
      fileName: tcUpload?.fileName || "NAv",
      trnType: tcUpload?.trnType || trnType,
      lmPcode: tcUpload?.lmPcode || "NAv",
    },

    metadata: buildRootMetadata({ now, actorUid, actorName }),
  };
}

export function buildBgoRowAndChildTrnDocs({
  tcId,
  rowDoc,
  rowData,
  astId,
  astDoc,
  premiseId,
  premiseData,
  trnType,
  geofenceRef,
  target,
  bgoBatchId,
  trnTimestampMs,
  now,
  actorUid,
  actorName,
}) {
  const tcRowId = rowDoc.id;
  const trnId = buildBgoChildTrnId({
    trnType,
    timestampMs: trnTimestampMs,
    meterType: getBgoMeterType(rowData, astDoc),
    wardPcode: getBgoWardPcode(rowData, astDoc),
    erfNo: getBgoErfNo(rowData, astDoc, premiseData),
  });
  const sourceRowNo = rowData?.rowNo || rowData?.frontend?.rowNo || "NAv";
  const lifecycleDraftSections = buildEmptyLifecycleDraftSections(trnType);

  const baseInstructionPayload = {
    id: trnId,
    trnType,
    astId,
    premiseId,

    assignment: {
      targets: [target],
      instruction: {
        code: trnType,
        text: buildInstructionText(trnType),
        notes: "NAv",
        mediaRequired: true,
      },
    },

    media: [],

    origin: {
      channel: "OFFICE",
      source: "BGO",
      sourceModule: BGO_SOURCE,
      tcId,
      tcRowId,
      bgoBatchId,
      createdMode: "OFFICE",
    },

    bucket: {
      type: "BULK_GEOFENCE",
      createdMode: "OFFICE",
      batchId: bgoBatchId,
      tcUploadId: tcId,
      geofenceId: geofenceRef.id,
      geofenceName: geofenceRef.name,
      targetType: target.type,
      targetId: target.id,
      targetName: target.name,
    },

    bgo: {
      kind: "BGO_TRN",
      trnId,
      tcId,
      tcUploadId: tcId,
      tcRowId,
      batchId: bgoBatchId,
      bgoBatchId,
      geofenceId: geofenceRef.id,
      geofenceName: geofenceRef.name,
      targetType: target.type,
      targetId: target.id,
      targetName: target.name,
      releaseState: BGO_CHILD_RELEASE_STATES.waiting,
      hiddenUntilBatchAccepted: true,
      sourceRow: {
        rowNo: sourceRowNo,
        upload: rowData?.upload || {},
        frontend: rowData?.frontend || {},
      },
    },

    refs: {
      astId,
      premiseId,
      tcUploadId: tcId,
      tcRowId,
      bgoBatchId,
      batchId: bgoBatchId,
      trnId,
    },

    geofenceRefs: [geofenceRef],
  };

  const cleanInstructionTrn = buildLifecycleInstructionTrnPayload({
    data: baseInstructionPayload,
    astDoc,
    premiseData,
    now,
    actorUid,
    actorName,
  });

  const childTrnDoc = safeJsonClone({
    ...cleanInstructionTrn,

    id: trnId,
    trnType,
    astId,
    premiseId,

    origin: {
      ...(cleanInstructionTrn?.origin || {}),
      ...baseInstructionPayload.origin,
    },

    bucket: baseInstructionPayload.bucket,

    bgo: baseInstructionPayload.bgo,

    refs: {
      ...(cleanInstructionTrn?.refs || {}),
      ...baseInstructionPayload.refs,
    },

    geofenceRefs: [geofenceRef],

    ...lifecycleDraftSections,

    workflow: {
      ...(cleanInstructionTrn?.workflow || {}),
      state: BGO_CHILD_RELEASE_STATES.waiting,
      createdMode: "OFFICE",
      issuedAt: now,
      issuedByUid: actorUid || "NAv",
      issuedByUser: actorName || "NAv",
      acceptedAt: null,
      acceptedByUid: null,
      acceptedByUser: null,
      executionStartedAt: null,
      completedAt: null,
      completedByUid: null,
      completedByUser: null,
    },

    metadata: buildRootMetadata({ now, actorUid, actorName }),
  });

  const childHistoryDoc = buildHistoryEvent({
    trnId,
    trnType,
    astId,
    event: "ISSUED",
    workflowState: BGO_CHILD_RELEASE_STATES.waiting,
    outcome: "NAv",
    actorUid,
    actorName,
    now,
    note: "BGO MLCT TRN created and waiting for batch acceptance",
  });

  const astActiveLifecycle = buildTrnActiveLifecycle({
    trnId,
    trnType,
    workflowState: BGO_CHILD_RELEASE_STATES.waiting,
    outcome: "NAv",
    assignedTo: target,
    updatedAt: now,
    updatedByUser: actorName,
  });

  return {
    tcRowId,
    trnId,
    // BGO row = the MLCT TRN. Keep this alias so existing UI/result code can
    // still talk about "BGO rows" without creating a second truth collection.
    bgoRowId: trnId,
    childTrnDoc,
    childHistoryDoc,
    astActiveLifecycle,
  };
}

export function buildBgoBatchHistoryDoc({
  bgoBatchId,
  trnType,
  geofenceRef,
  rowCount,
  trnCount,
  actorUid,
  actorName,
  now,
}) {
  return {
    event: "ISSUED",
    workflowState: "ISSUED",
    outcome: "NAv",
    bgoBatchId,
    trnType,
    geofenceRef,
    rowCount,
    trnCount,
    note: "BGO batch issued",
    actor: {
      uid: actorUid || "NAv",
      name: actorName || "NAv",
    },
    metadata: buildRootMetadata({ now, actorUid, actorName }),
  };
}

export function buildBgoNotificationRecord({
  bgoBatchId,
  trnType,
  target,
  geofenceRef,
  rowCount,
  actorUid,
  actorName,
  now,
}) {
  return {
    type: "BGO_BATCH_ISSUED",
    channelPreference: ["IN_APP", "EMAIL", "WHATSAPP"],

    recipient: {
      type: target.type,
      id: target.id,
      name: target.name,
      email: String(target?.email || "").trim(),
      phone: String(target?.phone || "").trim(),
    },

    bgo: {
      batchId: bgoBatchId,
      trnType,
      geofenceRef,
      rowCount,
      workflowState: "ISSUED",
    },

    message: {
      title: "New BGO batch issued",
      body: `${rowCount} ${trnType} work item(s) have been issued for ${geofenceRef.name}.`,
    },

    delivery: {
      status: "PENDING",
      attempts: 0,
      lastAttemptAt: null,
      deliveredAt: null,
      error: "",
    },

    metadata: buildRootMetadata({ now, actorUid, actorName }),
  };
}

export function buildTcRowBgoPatch({
  bgoBatchId,
  bgoRowId,
  trnId,
  geofenceRef,
  target,
  now,
  actorUid,
  actorName,
}) {
  return {
    bgo: {
      ready: false,
      readinessState: "USED_BY_BGO",
      readinessReason: "USED_BY_BGO",
      used: true,
      usedAt: now,
      usedByUid: actorUid || "NAv",
      usedByUser: actorName || "NAv",
      batchId: bgoBatchId,
      bgoBatchId,
      bgoRowId: bgoRowId || trnId,
      trnId,
      selectedGeofenceRef: geofenceRef,
      target: {
        type: target.type,
        id: target.id,
        name: target.name,
      },
    },

    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid || "NAv",
    "metadata.updatedByUser": actorName || "NAv",
  };
}

export function getInstructionMedia(media = []) {
  return safeArray(media).filter((item) => item?.tag === "instructionMedia");
}
