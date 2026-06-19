import {
  MREAD_BILLING_READINESS,
  MREAD_OUTCOMES,
  MREAD_REVIEW_STATUS,
  MREAD_STREAM_TYPES,
  isCanonicalMreadOutcome,
} from "./constants.js";

const NAv = "NAv";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function readString(value, fallback = NAv) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function firstString(...values) {
  for (const value of values) {
    const text = readString(value, "");
    if (text) return text;
  }
  return NAv;
}

function isMeaningfulString(value) {
  const text = readString(value, "");
  if (!text) return false;
  return !["nav", "n/av", "n/a", "na", "null", "undefined"].includes(
    text.toLowerCase(),
  );
}

function firstMeaningfulString(...values) {
  for (const value of values) {
    if (isMeaningfulString(value)) return String(value).trim();
  }
  return NAv;
}

function readNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function readDateString(value, fallback = null) {
  if (!value) return fallback;

  if (typeof value === "string") return value;

  if (value instanceof Date) return value.toISOString();

  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (_error) {
      return fallback;
    }
  }

  if (typeof value?.seconds === "number") {
    try {
      return new Date(value.seconds * 1000).toISOString();
    } catch (_error) {
      return fallback;
    }
  }

  return fallback;
}


function readTimestampMillis(value) {
  const dateString = readDateString(value, "");
  if (!dateString) return null;

  const millis = Date.parse(dateString);
  return Number.isFinite(millis) ? millis : null;
}

function buildSincePreviousReading({ readingAt, previousReadingAt } = {}) {
  const currentMillis = readTimestampMillis(readingAt);
  const previousMillis = readTimestampMillis(previousReadingAt);

  if (currentMillis === null || previousMillis === null) return null;

  const diffMinutesRaw = (currentMillis - previousMillis) / 60000;
  if (!Number.isFinite(diffMinutesRaw) || diffMinutesRaw < 0) return null;

  const totalMinutes = Math.floor(diffMinutesRaw);
  let value = totalMinutes;
  let unit = "MINUTES";
  let display = `${value} min`;

  if (totalMinutes >= 1440) {
    value = Math.floor(totalMinutes / 1440);
    unit = "DAYS";
    display = `${value} ${value === 1 ? "day" : "days"}`;
  } else if (totalMinutes >= 60) {
    value = Math.floor(totalMinutes / 60);
    unit = "HOURS";
    display = `${value} ${value === 1 ? "hr" : "hrs"}`;
  }

  return {
    totalMinutes,
    value,
    unit,
    display,
  };
}

function readSincePreviousReading(value, { readingAt, previousReadingAt } = {}) {
  if (isPlainObject(value)) {
    const explicitDisplay = readString(value.display, "");
    const explicitTotalMinutes = readNumber(value.totalMinutes);
    const explicitValue = readNumber(value.value);
    const explicitUnit = readString(value.unit, "");

    if (explicitDisplay) {
      return {
        totalMinutes: explicitTotalMinutes,
        value: explicitValue,
        unit: explicitUnit || NAv,
        display: explicitDisplay,
      };
    }
  }

  return buildSincePreviousReading({ readingAt, previousReadingAt });
}

function selectWithOtherToText(value) {
  if (!isPlainObject(value)) return readString(value);

  const code = readString(value.code, "");
  const label = readString(value.label, "");
  const otherText = readString(value.otherText, "");

  if (code === "OTHER" && otherText) return otherText;
  return label || code || otherText || NAv;
}

function readReasonCode(value) {
  if (!isPlainObject(value)) return NAv;
  return firstString(value.code, value.id, value.value);
}

function readWorkflowState(trn = {}) {
  return firstString(trn?.workflow?.state, trn?.workflowState);
}

function readCompletedAt(trn = {}) {
  return readDateString(
    trn?.workflow?.completedAt ||
      trn?.executionOutcome?.completedAt ||
      trn?.meterReading?.readingAt ||
      trn?.metadata?.updatedAt ||
      trn?.metadata?.createdAt,
  );
}

function readMedia(trn = {}) {
  return Array.isArray(trn?.media) ? trn.media.filter(Boolean) : [];
}

function readMediaTags(media = []) {
  return Array.from(
    new Set(
      media
        .map((item) => readString(item?.tag, ""))
        .filter(Boolean),
    ),
  );
}

function readEvidenceMediaRefs(media = []) {
  return media
    .filter((item) => isPlainObject(item))
    .map((item) => {
      const url = firstString(
        item?.url,
        item?.uri,
        item?.href,
        item?.link,
        item?.mediaUrl,
        item?.imageUrl,
        item?.downloadUrl,
        item?.storageUrl,
      );

      if (url === NAv) return null;

      return {
        tag: firstString(item?.tag, "meterReadingEvidence"),
        type: firstString(item?.type, "image"),
        url,
        gps: item?.gps || null,
        created: item?.created || null,
        updated: item?.updated || null,
        createdAt: readDateString(item?.createdAt || item?.created?.at, null),
        updatedAt: readDateString(item?.updatedAt || item?.updated?.at, null),
      };
    })
    .filter(Boolean);
}

function readGps(trn = {}, media = []) {
  const directGps =
    trn?.meterReading?.readingGps ||
    trn?.executionOutcome?.readingGps ||
    trn?.readingGps ||
    null;

  const mediaGps = media.find((item) => item?.gps?.lat && item?.gps?.lng)?.gps;
  const gps = directGps || mediaGps || {};

  return {
    lat: readNumber(gps?.lat),
    lng: readNumber(gps?.lng),
    accuracy: readNumber(gps?.accuracy),
    source: directGps ? "meterReading.readingGps" : mediaGps ? "media.gps" : NAv,
  };
}

function readWardNo(wardPcode) {
  const text = readString(wardPcode, "");
  if (!text) return null;
  const suffix = text.slice(-3);
  const num = Number(suffix);
  return Number.isFinite(num) ? num : null;
}

function readAccessDecision(trn = {}, outcome) {
  const raw = readString(trn?.accessData?.access?.hasAccess, "").toLowerCase();

  if (raw === "no") return "NO";
  if (raw === "yes") return "YES";

  if (outcome === MREAD_OUTCOMES.NO_ACCESS) return "NO";
  if (
    outcome === MREAD_OUTCOMES.SUCCESSFUL_READING ||
    outcome === MREAD_OUTCOMES.UNSUCCESSFUL_READING
  ) {
    return "YES";
  }

  return NAv;
}

function readReadingObtained(outcome) {
  if (outcome === MREAD_OUTCOMES.SUCCESSFUL_READING) return "YES";
  if (outcome === MREAD_OUTCOMES.UNSUCCESSFUL_READING) return "NO";
  if (outcome === MREAD_OUTCOMES.NO_ACCESS) return NAv;
  return NAv;
}

function readStream(trn = {}) {
  const streamType = firstString(
    trn?.stream?.streamType,
    trn?.origin?.streamType,
    trn?.origin?.sourceType,
  );

  const hasBgo = Boolean(
    trn?.bgoId ||
      trn?.bgoRowId ||
      trn?.batchId ||
      trn?.origin?.bgoId ||
      trn?.origin?.bgoRowId ||
      trn?.origin?.batchId,
  );

  let resolvedStreamType = MREAD_STREAM_TYPES.UNKNOWN_REVIEW;

  if (hasBgo) {
    resolvedStreamType = MREAD_STREAM_TYPES.CONTROLLED_BGO;
  } else if (streamType !== NAv) {
    resolvedStreamType = streamType;
  } else if (trn?.assignment?.createdFor || trn?.assignment?.targets) {
    resolvedStreamType = MREAD_STREAM_TYPES.CONTROLLED_INDIVIDUAL;
  } else {
    resolvedStreamType = MREAD_STREAM_TYPES.UNCONTROLLED;
  }

  return {
    streamType: resolvedStreamType,
    bgoId: firstString(trn?.bgoId, trn?.origin?.bgoId, trn?.stream?.bgoId),
    bgoRowId: firstString(
      trn?.bgoRowId,
      trn?.origin?.bgoRowId,
      trn?.stream?.bgoRowId,
    ),
    batchId: firstString(
      trn?.batchId,
      trn?.origin?.batchId,
      trn?.stream?.batchId,
    ),
  };
}

function readAssignment(trn = {}) {
  const targets = Array.isArray(trn?.assignment?.targets)
    ? trn.assignment.targets
    : [];

  const firstTarget = targets[0] || trn?.assignment?.createdFor || {};

  return {
    assignedToType: firstString(firstTarget?.type),
    assignedToId: firstString(firstTarget?.id, firstTarget?.uid),
    assignedToName: firstString(firstTarget?.name, firstTarget?.displayName),
    issuedByUid: firstString(
      trn?.assignment?.issuedByUid,
      trn?.assignment?.createdByUid,
      trn?.metadata?.createdByUid,
    ),
    issuedByName: firstString(
      trn?.assignment?.issuedByName,
      trn?.assignment?.createdByUser,
      trn?.metadata?.createdByUser,
    ),
    acceptedAt: readDateString(
      trn?.assignment?.acceptedAt || trn?.assignment?.acceptedRejectedAt,
      null,
    ),
  };
}

function readActor(trn = {}) {
  return {
    capturedByUid: firstString(
      trn?.workflow?.completedByUid,
      trn?.metadata?.updatedByUid,
      trn?.metadata?.createdByUid,
    ),
    capturedByName: firstString(
      trn?.workflow?.completedByUser,
      trn?.metadata?.updatedByUser,
      trn?.metadata?.createdByUser,
    ),
    capturedByRole: firstString(
      trn?.actor?.role,
      trn?.capturedByRole,
      trn?.metadata?.createdByRole,
    ),
    teamId: firstString(trn?.team?.id, trn?.assignment?.teamId),
    teamName: firstString(trn?.team?.name, trn?.assignment?.teamName),
    spId: firstString(
      trn?.serviceProvider?.id,
      trn?.actor?.spId,
      trn?.assignment?.spId,
    ),
    spName: firstString(
      trn?.serviceProvider?.name,
      trn?.actor?.spName,
      trn?.assignment?.spName,
    ),
  };
}

function readReading(trn = {}, outcome) {
  const isSuccessful = outcome === MREAD_OUTCOMES.SUCCESSFUL_READING;

  const currentReading = isSuccessful
    ? readNumber(
        trn?.executionOutcome?.currentReading ??
          trn?.meterReading?.reading ??
          trn?.meterReading?.currentReading ??
          trn?.executionOutcome?.reading ??
          trn?.reading,
      )
    : null;

  const previousReading = isSuccessful
    ? readNumber(
        trn?.executionOutcome?.previousReading ??
          trn?.meterReading?.previousReading ??
          trn?.previousReading,
      )
    : null;

  const explicitConsumption = readNumber(
    trn?.executionOutcome?.consumption ??
      trn?.meterReading?.consumption ??
      trn?.consumption,
  );

  const consumption = isSuccessful
    ? explicitConsumption !== null
      ? explicitConsumption
      : currentReading !== null && previousReading !== null
        ? currentReading - previousReading
        : null
    : null;

  const readingAt = isSuccessful ? readDateString(trn?.meterReading?.readingAt) : null;
  const previousReadingAt = isSuccessful
    ? readDateString(trn?.executionOutcome?.previousReadingAt)
    : null;
  const sincePreviousReading = isSuccessful
    ? readSincePreviousReading(trn?.executionOutcome?.sincePreviousReading, {
        readingAt,
        previousReadingAt,
      })
    : null;

  return {
    currentReading,
    readingAt,
    previousReading,
    previousReadingAt,
    previousReadingTrnId: isSuccessful
      ? firstString(trn?.executionOutcome?.previousReadingTrnId)
      : NAv,
    consumption,
    sincePreviousReading,
  };
}

function readMeter(trn = {}) {
  const astData = trn?.ast?.astData || {};
  const meter = astData?.meter || {};
  const rawKind = firstString(meter?.type, trn?.meterKind);
  const meterKind = rawKind === NAv ? NAv : rawKind.toUpperCase();

  return {
    astId: firstString(astData?.astId, trn?.sourceAstId, trn?.astId),
    astNo: firstString(astData?.astNo, trn?.astNo, trn?.meterNo),
    meterType: firstString(trn?.meterType, trn?.ast?.meterType),
    meterKind,
    statusState: firstString(trn?.status?.state, trn?.ast?.status?.state),
    visibility: firstString(
      trn?.master?.visibility,
      trn?.derived?.master?.visibility,
      trn?.ast?.master?.visibility,
    ),
  };
}

function readPremise(trn = {}) {
  const accessData = trn?.accessData || {};
  const premise = accessData?.premise || {};

  return {
    premiseId: firstString(premise?.id, trn?.premiseId),
    erfId: firstString(accessData?.erfId, trn?.erfId),
    erfNo: firstString(accessData?.erfNo, trn?.erfNo),
    address: firstString(premise?.address, trn?.premiseAddress),
    propertyType: firstString(premise?.propertyType, premise?.premiseType),
    suburbName: firstString(premise?.suburbName, premise?.suburb),
  };
}

function readGeography(trn = {}, ast = {}) {
  const parents = trn?.accessData?.parents || {};
  const geofence =
    (Array.isArray(trn?.geofenceRefs) && trn.geofenceRefs[0]) ||
    (Array.isArray(trn?.ast?.geofenceRefs) && trn.ast.geofenceRefs[0]) ||
    (Array.isArray(ast?.geofenceRefs) && ast.geofenceRefs[0]) ||
    (Array.isArray(ast?.ast?.geofenceRefs) && ast.ast.geofenceRefs[0]) ||
    trn?.geofence ||
    ast?.geofence ||
    ast?.geofenceRef ||
    {};

  const wardPcode = firstString(parents?.wardPcode, trn?.wardPcode, ast?.accessData?.parents?.wardPcode);

  return {
    countryPcode: firstString(parents?.countryPcode, trn?.countryPcode),
    provincePcode: firstString(parents?.provincePcode, trn?.provincePcode),
    dmPcode: firstString(parents?.dmPcode, trn?.dmPcode),
    dmName: firstString(parents?.dmName, trn?.dmName),
    lmPcode: firstString(parents?.lmPcode, trn?.lmPcode),
    lmName: firstString(parents?.lmName, trn?.lmName),
    wardPcode,
    wardNo: readWardNo(wardPcode),
    geofenceId: firstString(geofence?.id, geofence?.geofenceId),
    geofenceName: firstString(geofence?.name, geofence?.geofenceName),
  };
}

function readOutcomeBlock(trn = {}, outcome) {
  const noAccessReasonSelect =
    trn?.accessData?.access?.reasonSelect ||
    trn?.accessData?.access?.noAccessReasonSelect ||
    trn?.executionOutcome?.noAccessReasonSelect ||
    trn?.executionOutcome?.reasonSelect;
  const unsuccessfulReasonSelect =
    trn?.meterReading?.unsuccessfulReadingReason ||
    trn?.meterReading?.noReadingReason ||
    trn?.executionOutcome?.unsuccessfulReadingReason ||
    trn?.executionOutcome?.noReadingReason;

  const noAccessReason =
    outcome === MREAD_OUTCOMES.NO_ACCESS
      ? firstMeaningfulString(
          selectWithOtherToText(noAccessReasonSelect),
          trn?.executionOutcome?.noAccessReason,
          trn?.executionOutcome?.reasonText,
          trn?.executionOutcome?.reason,
          trn?.meterReading?.noAccessReason,
          trn?.accessData?.access?.noAccessReason,
          trn?.accessData?.access?.reasonText,
          trn?.accessData?.access?.reason,
          trn?.access?.noAccessReason,
          trn?.noAccessReason,
          trn?.executionOutcome?.reasonCode,
          trn?.accessData?.access?.reasonCode,
        )
      : NAv;

  const unsuccessfulReason =
    outcome === MREAD_OUTCOMES.UNSUCCESSFUL_READING
      ? firstMeaningfulString(
          selectWithOtherToText(unsuccessfulReasonSelect),
          trn?.meterReading?.unsuccessfulReadingReasonText,
          trn?.meterReading?.noReadingReasonText,
          trn?.executionOutcome?.unsuccessfulReason,
          trn?.executionOutcome?.unsuccessfulReadingReason,
          trn?.executionOutcome?.noReadingReason,
          trn?.executionOutcome?.reasonText,
          trn?.executionOutcome?.reason,
        )
      : NAv;

  const reasonCode =
    outcome === MREAD_OUTCOMES.NO_ACCESS
      ? firstMeaningfulString(
          readReasonCode(noAccessReasonSelect),
          trn?.executionOutcome?.reasonCode,
          trn?.accessData?.access?.reasonCode,
        )
      : outcome === MREAD_OUTCOMES.UNSUCCESSFUL_READING
        ? firstMeaningfulString(
            readReasonCode(unsuccessfulReasonSelect),
            trn?.executionOutcome?.reasonCode,
            trn?.meterReading?.reasonCode,
          )
        : NAv;

  return {
    access: readAccessDecision(trn, outcome),
    readingObtained: readReadingObtained(outcome),
    outcome,
    noAccessReason,
    unsuccessfulReason,
    reasonCode,
    reasonText:
      outcome === MREAD_OUTCOMES.NO_ACCESS
        ? noAccessReason
        : outcome === MREAD_OUTCOMES.UNSUCCESSFUL_READING
          ? unsuccessfulReason
          : NAv,
    validationStatus: isCanonicalMreadOutcome(outcome) ? "PASSED" : "FAILED",
    validationMessages: [],
  };
}

function readEvidence(trn = {}) {
  const media = readMedia(trn);
  const mediaTags = readMediaTags(media);
  const mediaRefs = readEvidenceMediaRefs(media);

  return {
    gps: readGps(trn, media),
    hasPhoto: mediaRefs.length > 0 || media.length > 0,
    photoCount: mediaRefs.length || media.length,
    hasMeterReadingEvidence: mediaTags.includes("meterReadingEvidence"),
    hasNoAccessPhoto: mediaTags.includes("noAccessPhoto"),
    hasUnsuccessfulReadingEvidence:
      mediaTags.includes("unsuccessfulReadingEvidence") ||
      mediaTags.includes("noReadingEvidence"),
    mediaTags,
    mediaRefs,
    notes: firstString(
      trn?.meterReading?.executorNotes,
      trn?.executionOutcome?.notes,
      trn?.notes,
    ),
  };
}

function buildDataQuality({ trnId, source, outcome, meter, premise, reading }) {
  const missingFields = [];
  const warnings = [];

  if (!trnId || trnId === NAv) missingFields.push("source.trnId");
  if (source?.workflowState !== "COMPLETED") {
    missingFields.push("source.workflowState");
  }
  if (!isCanonicalMreadOutcome(outcome)) missingFields.push("outcome.outcome");
  if (!meter?.astId || meter.astId === NAv) missingFields.push("meter.astId");
  if (!meter?.astNo || meter.astNo === NAv) warnings.push("meter.astNo_missing");
  if (!premise?.premiseId || premise.premiseId === NAv) {
    missingFields.push("premise.premiseId");
  }

  if (
    outcome === MREAD_OUTCOMES.SUCCESSFUL_READING &&
    reading?.currentReading === null
  ) {
    missingFields.push("reading.currentReading");
  }

  if (
    outcome === MREAD_OUTCOMES.SUCCESSFUL_READING &&
    reading?.previousReading === null
  ) {
    warnings.push("reading.previousReading_missing");
  }

  if (
    outcome === MREAD_OUTCOMES.SUCCESSFUL_READING &&
    reading?.previousReading !== null &&
    !reading?.sincePreviousReading?.display
  ) {
    warnings.push("reading.sincePreviousReading_missing");
  }

  if (
    outcome === MREAD_OUTCOMES.SUCCESSFUL_READING &&
    reading?.consumption !== null &&
    reading.consumption < 0
  ) {
    warnings.push("reading.consumption_negative");
  }

  return {
    hasRequiredSourceRefs: missingFields.length === 0,
    missingFields,
    warnings,
    requiresDataFix: missingFields.length > 0,
  };
}

function buildBillingReadiness({ outcome, dataQuality, reading }) {
  if (outcome !== MREAD_OUTCOMES.SUCCESSFUL_READING) {
    return {
      status: MREAD_BILLING_READINESS.NOT_BILLING_READY,
      reasonCode: "MREAD_OUTCOME_NOT_SUCCESSFUL_READING",
      reasonText: "Only successful readings can become billing-ready candidates.",
    };
  }

  if (dataQuality?.requiresDataFix || reading?.currentReading === null) {
    return {
      status: MREAD_BILLING_READINESS.BILLING_REVIEW_REQUIRED,
      reasonCode: "MREAD_DATA_QUALITY_REVIEW_REQUIRED",
      reasonText: "Successful reading requires review before billing staging.",
    };
  }

  if (reading?.previousReading === null) {
    return {
      status: MREAD_BILLING_READINESS.BILLING_REVIEW_REQUIRED,
      reasonCode: "MREAD_PREVIOUS_READING_MISSING",
      reasonText: "Previous reading is missing; consumption cannot be confirmed.",
    };
  }

  if (reading?.consumption !== null && reading.consumption < 0) {
    return {
      status: MREAD_BILLING_READINESS.BILLING_REVIEW_REQUIRED,
      reasonCode: "MREAD_NEGATIVE_CONSUMPTION",
      reasonText: "Consumption is negative and requires review before billing staging.",
    };
  }

  return {
    status: MREAD_BILLING_READINESS.BILLING_READY_CANDIDATE,
    reasonCode: NAv,
    reasonText: NAv,
  };
}

function buildReview({ outcome, billingReadiness }) {
  const actionRequired =
    outcome !== MREAD_OUTCOMES.SUCCESSFUL_READING ||
    billingReadiness?.status === MREAD_BILLING_READINESS.BILLING_REVIEW_REQUIRED;

  return {
    status: actionRequired ? MREAD_REVIEW_STATUS.REVIEW_REQUIRED : MREAD_REVIEW_STATUS.NAv,
    reviewedByUid: NAv,
    reviewedByName: NAv,
    reviewedAt: null,
    reviewNotes: NAv,
    actionRequired,
    actionType:
      outcome === MREAD_OUTCOMES.NO_ACCESS
        ? "FOLLOW_UP_ACCESS"
        : outcome === MREAD_OUTCOMES.UNSUCCESSFUL_READING
          ? "FOLLOW_UP_READING"
          : billingReadiness?.status === MREAD_BILLING_READINESS.BILLING_REVIEW_REQUIRED
            ? "BILLING_REVIEW"
            : NAv,
  };
}

function readMetadata(trn = {}, now = new Date()) {
  const nowIso = readDateString(now) || new Date().toISOString();
  const metadata = trn?.metadata || {};

  return {
    createdAt: readDateString(metadata?.createdAt, nowIso),
    createdByUid: firstString(metadata?.createdByUid),
    createdByUser: firstString(metadata?.createdByUser),
    updatedAt: readDateString(metadata?.updatedAt, nowIso),
    updatedByUid: firstString(metadata?.updatedByUid, metadata?.createdByUid),
    updatedByUser: firstString(metadata?.updatedByUser, metadata?.createdByUser),
  };
}

export function mapTrnMreadToRegistryMread({
  trn,
  trnId,
  trnPath = `trns/${trnId}`,
  now = new Date(),
  ast = null,
} = {}) {
  if (!isPlainObject(trn)) {
    throw new Error("MAP_REGISTRY_MREAD_TRN_REQUIRED");
  }

  const safeTrnId = firstString(trnId, trn?.id);
  const outcome = readString(trn?.executionOutcome?.outcome, "");

  if (!isCanonicalMreadOutcome(outcome)) {
    throw new Error(
      `MAP_REGISTRY_MREAD_NON_CANONICAL_OUTCOME:${safeTrnId}:${outcome || "MISSING"}`,
    );
  }

  const workflowState = readWorkflowState(trn);
  const completedAt = readCompletedAt(trn);
  const media = readMedia(trn);

  const source = {
    trnId: safeTrnId,
    trnType: "MREAD",
    trnPath,
    workflowState,
    completedAt,
    sourceSystem: "iREPS",
    sourceVersion: "v1",
  };

  const meter = readMeter(trn);
  const premise = readPremise(trn);
  const geography = readGeography(trn, ast);
  const reading = readReading(trn, outcome);
  const evidence = readEvidence({ ...trn, media });
  const outcomeBlock = readOutcomeBlock(trn, outcome);

  const dataQuality = buildDataQuality({
    trnId: safeTrnId,
    source,
    outcome,
    meter,
    premise,
    reading,
  });

  const billingReadiness = buildBillingReadiness({
    outcome,
    dataQuality,
    reading,
  });

  const review = buildReview({ outcome, billingReadiness });

  return {
    id: safeTrnId,
    source,
    stream: readStream(trn),
    outcome: outcomeBlock,
    reading,
    meter,
    premise,
    geography,
    actor: readActor(trn),
    assignment: readAssignment(trn),
    evidence,
    billingReadiness,
    review,
    dataQuality,
    metadata: readMetadata(trn, now),
  };
}
