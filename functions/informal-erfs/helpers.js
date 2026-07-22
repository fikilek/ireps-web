const ALLOWED_ROLES = new Set(["MNG", "SPV", "FWR"]);

const REASON_LABELS = Object.freeze({
  NO_FORMAL_ERF: "No formal ERF exists at this location",
  UNMAPPED_INFORMAL_AREA: "Structure is in an unmapped informal area",
  METER_OUTSIDE_MAPPED_ERF: "Meter is outside mapped ERFs",
  SERVICE_CONNECTION_WITHOUT_ERF:
    "Service connection has no matching ERF",
  CADASTRAL_DATA_INCOMPLETE: "Cadastral information is incomplete",
  FORMAL_ERF_NOT_IDENTIFIABLE:
    "Correct formal ERF cannot be identified",
  OTHER: "Other",
});

const INFORMAL_ERF_ID_PATTERN =
  /^erf_inf__([A-Z0-9]+)__(\d{8})__(\d{9})$/;

export function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

export function asTrimmedString(value) {
  return String(value ?? "").trim();
}

export function asFiniteNumber(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }

  return parsed;
}

export function asNullableFiniteNumber(value, fieldName) {
  if (value == null || value === "") return null;
  return asFiniteNumber(value, fieldName);
}

export function assertPositiveEpochMs(value, fieldName) {
  const parsed = asFiniteNumber(value, fieldName);

  if (parsed <= 0) {
    throw new Error(`${fieldName} must be a positive epoch millisecond value.`);
  }

  return Math.trunc(parsed);
}

export function assertValidLatLng(value, fieldName) {
  if (!isPlainObject(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const lat = asFiniteNumber(value.lat, `${fieldName}.lat`);
  const lng = asFiniteNumber(value.lng, `${fieldName}.lng`);

  if (lat < -90 || lat > 90) {
    throw new Error(`${fieldName}.lat must be between -90 and 90.`);
  }

  if (lng < -180 || lng > 180) {
    throw new Error(`${fieldName}.lng must be between -180 and 180.`);
  }

  if (lat === 0 && lng === 0) {
    throw new Error(`${fieldName} cannot be 0,0.`);
  }

  return { lat, lng };
}

export function assertValidDeviceLocation(value) {
  if (!isPlainObject(value)) {
    throw new Error("deviceLocation must be an object.");
  }

  const latitude = asFiniteNumber(
    value.latitude,
    "deviceLocation.latitude",
  );
  const longitude = asFiniteNumber(
    value.longitude,
    "deviceLocation.longitude",
  );

  if (latitude < -90 || latitude > 90) {
    throw new Error(
      "deviceLocation.latitude must be between -90 and 90.",
    );
  }

  if (longitude < -180 || longitude > 180) {
    throw new Error(
      "deviceLocation.longitude must be between -180 and 180.",
    );
  }

  if (latitude === 0 && longitude === 0) {
    throw new Error("deviceLocation cannot be 0,0.");
  }

  return {
    latitude,
    longitude,
    accuracyM: asNullableFiniteNumber(
      value.accuracyM,
      "deviceLocation.accuracyM",
    ),
    altitudeM: asNullableFiniteNumber(
      value.altitudeM,
      "deviceLocation.altitudeM",
    ),
    headingDegrees: asNullableFiniteNumber(
      value.headingDegrees,
      "deviceLocation.headingDegrees",
    ),
    speedMps: asNullableFiniteNumber(
      value.speedMps,
      "deviceLocation.speedMps",
    ),
    capturedAtMs: assertPositiveEpochMs(
      value.capturedAtMs,
      "deviceLocation.capturedAtMs",
    ),
  };
}

export function assertInformalErfId(erfId, wardPcode) {
  const cleanErfId = asTrimmedString(erfId);
  const cleanWardPcode = asTrimmedString(wardPcode).toUpperCase();
  const match = cleanErfId.match(INFORMAL_ERF_ID_PATTERN);

  if (!match) {
    throw new Error(
      "erfId must follow erf_inf__{wardPcode}__{YYYYMMDD}__{HHmmssSSS}.",
    );
  }

  const wardPcodeFromId = match[1];

  if (wardPcodeFromId !== cleanWardPcode) {
    throw new Error(
      "The ward code inside erfId must match wardPcode.",
    );
  }

  return cleanErfId;
}

export function normalizeReason(reasonCode, reasonOther) {
  const code = asTrimmedString(reasonCode).toUpperCase();
  const label = REASON_LABELS[code];

  if (!label) {
    throw new Error("reasonCode is not an approved Informal ERF reason.");
  }

  const otherText = asTrimmedString(reasonOther);

  if (code === "OTHER" && !otherText) {
    throw new Error("reasonOther is required when reasonCode is OTHER.");
  }

  if (otherText.length > 250) {
    throw new Error("reasonOther cannot exceed 250 characters.");
  }

  return {
    code,
    label,
    otherText: code === "OTHER" ? otherText : null,
  };
}

export function normalizeSitePhotos(media, erfId) {
  if (!Array.isArray(media)) {
    throw new Error("media must be an array.");
  }

  const expectedPrefix = `informal_erfs/${erfId}/`;

  const sitePhotos = media
    .filter((item) => item?.tag === "informalErfSitePhoto")
    .map((item, index) => {
      const storagePath = asTrimmedString(item?.storagePath);

      if (!storagePath) {
        throw new Error(
          `media[${index}].storagePath is required before server submission.`,
        );
      }

      if (!storagePath.startsWith(expectedPrefix)) {
        throw new Error(
          `media[${index}].storagePath must start with ${expectedPrefix}.`,
        );
      }

      let gps = null;

      if (item?.gps != null) {
        gps = assertValidLatLng(item.gps, `media[${index}].gps`);
      }

      let capturedAtMs = null;

      if (item?.capturedAtMs != null) {
        capturedAtMs = assertPositiveEpochMs(
          item.capturedAtMs,
          `media[${index}].capturedAtMs`,
        );
      }

      return {
        tag: "informalErfSitePhoto",
        type: "image",
        storagePath,
        capturedAtMs,
        gps,
      };
    });

  if (sitePhotos.length === 0) {
    throw new Error(
      "At least one uploaded informalErfSitePhoto is required.",
    );
  }

  return sitePhotos;
}

export function getActorContext(userData, authToken = {}) {
  const role = asTrimmedString(
    userData?.employment?.role ||
      userData?.role ||
      authToken?.role,
  ).toUpperCase();

  if (!ALLOWED_ROLES.has(role)) {
    throw new Error("Only MNG, SPV, or FWR may create an Informal ERF.");
  }

  const accountStatus = asTrimmedString(
    userData?.accountStatus ||
      userData?.status?.state ||
      userData?.status?.lifecycle ||
      userData?.status,
  ).toUpperCase();

  if (accountStatus !== "ACTIVE") {
    throw new Error("The user account is not active.");
  }

  const activeWorkbase = userData?.access?.activeWorkbase;
  const activeWorkbaseId = asTrimmedString(
    typeof activeWorkbase === "string"
      ? activeWorkbase
      : activeWorkbase?.id ||
          activeWorkbase?.pcode ||
          activeWorkbase?.lmPcode,
  );

  if (!activeWorkbaseId) {
    throw new Error("The user has no active workbase.");
  }

  const profile = userData?.profile || {};
  const displayName =
    asTrimmedString(profile?.displayName) ||
    asTrimmedString(
      [profile?.name, profile?.surname].filter(Boolean).join(" "),
    ) ||
    asTrimmedString(authToken?.name) ||
    asTrimmedString(authToken?.email) ||
    "iREPS User";

  return {
    role,
    accountStatus,
    activeWorkbaseId,
    displayName,
  };
}

export function buildAdminHierarchy({
  lmPcode,
  wardPcode,
  lmData,
  wardData,
}) {
  const lmParents = lmData?.parents || {};
  const lmParentNames = lmData?.parentNames || {};
  const wardParents = wardData?.parents || {};

  const countryPcode = asTrimmedString(
    lmParents?.countryId || wardParents?.countryId,
  );
  const provincePcode = asTrimmedString(
    lmParents?.provinceId || wardParents?.provinceId,
  );
  const districtPcode = asTrimmedString(
    lmParents?.districtId || wardParents?.districtId,
  );

  const countryName =
    asTrimmedString(lmParentNames?.country) || "South Africa";
  const provinceName = asTrimmedString(lmParentNames?.province);
  const districtName = asTrimmedString(lmParentNames?.district);
  const lmName = asTrimmedString(lmData?.name);
  const wardName =
    asTrimmedString(wardData?.name) ||
    (wardData?.code != null ? `Ward ${wardData.code}` : "");

  if (
    !countryPcode ||
    !provincePcode ||
    !districtPcode ||
    !provinceName ||
    !districtName ||
    !lmName ||
    !wardName
  ) {
    throw new Error(
      "The LM or ward document is missing canonical admin hierarchy fields.",
    );
  }

  return {
    country: {
      name: countryName,
      pcode: countryPcode,
    },
    province: {
      name: provinceName,
      pcode: provincePcode,
    },
    district: {
      name: districtName,
      pcode: districtPcode,
    },
    localMunicipality: {
      name: lmName,
      pcode: lmPcode,
    },
    ward: {
      name: wardName,
      pcode: wardPcode,
    },
  };
}

export function buildInformalErfDocument({
  erfId,
  admin,
  proposedErfLocation,
  reason,
  deviceLocation,
  sitePhotos,
  clientSubmittedAtMs,
  actorUid,
  actorName,
  nowIso,
}) {
  const { lat, lng } = proposedErfLocation;

  return {
    erfId,

    admin,

    bbox: {
      minLat: lat,
      minLng: lng,
      maxLat: lat,
      maxLng: lng,
    },

    centroid: {
      lat,
      lng,
    },

    erf: {
      area: 0,
      source: "IREPS",
      status: "ACTIVE",
      type: "INFORMAL",
    },

    sg: {
      dateStamp: nowIso.slice(0, 10),
      majRegion: "NAv",
      minRegion: "NAv",
      parcelNo: 0,
      portion: 0,
      erfNo: erfId,
      prclKey: erfId,
      prclType: "INFORMAL",
    },

    geometry: JSON.stringify({
      type: "Point",
      coordinates: [lng, lat],
    }),

    premises: [],

    geofenceRefs: [],

    informalErfCreation: {
      reason,
      deviceLocation,
      sitePhotos,
      submission: {
        schemaVersion: 1,
        formType: "INFORMAL_ERF_CREATE",
        channel: "IREPS_MOBILE",
        clientSubmittedAtMs,
        receivedAt: nowIso,
      },
    },

    metadata: {
      createdAt: nowIso,
      createdByUid: actorUid,
      createdByUser: actorName,
      updatedAt: nowIso,
      updatedByUid: actorUid,
      updatedByUser: actorName,
    },
  };
}
