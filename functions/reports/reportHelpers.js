export const normalizeText = (value) => {
  if (value === undefined || value === null) return "NAv";

  const text = String(value).trim();

  if (!text) return "NAv";

  return text;
};

export const slugify = (value) => {
  const text = normalizeText(value);

  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
};

export const isNoAccessTrn = (trn) => {
  return trn?.accessData?.access?.hasAccess === "no";
};

export const getNormalisationBucket = (trn) => {
  const actions = trn?.ast?.normalisation?.actionTaken || [];
  const activityDate = getActivityDate(trn);

  const clean = actions
    .map((action) => normalizeText(action))
    .filter((action) => action !== "NAv");

  if (!clean.length || activityDate === "NAv") return null;

  const unique = [...new Set(clean)];
  const sorted = unique.sort((a, b) => a.localeCompare(b));

  const combinationKey = sorted.map((action) => slugify(action)).join("__");

  return {
    actions: sorted,
    combinationKey,
    activityDate,
  };
};

export const getUserActivityContribution = (trn) => {
  const counts = {
    totalTrns: 1,
    noAccessTrns: 0,

    meterDiscoveryTrns: 0,
    meterInstallationTrns: 0,
    meterDisconnectionTrns: 0,
    meterReconnectionTrns: 0,
    meterInspectionTrns: 0,
    meterRemovalTrns: 0,

    otherTrns: 0,
  };

  const trnType = normalizeText(trn?.accessData?.trnType);

  if (isNoAccessTrn(trn)) {
    counts.noAccessTrns += 1;
  }

  switch (trnType) {
    case "METER_DISCOVERY":
      counts.meterDiscoveryTrns += 1;
      break;

    case "METER_INSTALLATION":
      counts.meterInstallationTrns += 1;
      break;

    case "METER_DISCONNECTION":
      counts.meterDisconnectionTrns += 1;
      break;

    case "METER_RECONNECTION":
      counts.meterReconnectionTrns += 1;
      break;

    case "METER_INSPECTION":
      counts.meterInspectionTrns += 1;
      break;

    case "METER_REMOVAL":
      counts.meterRemovalTrns += 1;
      break;

    default:
      counts.otherTrns += 1;
      break;
  }

  return counts;
};

export const getActivityDate = (trn) => {
  const iso = trn?.metadata?.updatedAt || trn?.metadata?.createdAt || null;

  if (!iso) return "NAv";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "NAv";
  }

  return date.toISOString().slice(0, 10);
};

export const getAnomalyBucket = (trn) => {
  const anomaly = normalizeText(trn?.ast?.anomalies?.anomaly);
  const detail = normalizeText(trn?.ast?.anomalies?.anomalyDetail);
  const activityDate = getActivityDate(trn);

  if (anomaly === "NAv" || activityDate === "NAv") {
    return null;
  }

  const anomalyKey = slugify(anomaly);
  const detailKey = slugify(detail);

  return {
    name: anomaly,
    detail,
    anomalyKey,
    detailKey,
    activityDate,
  };
};
