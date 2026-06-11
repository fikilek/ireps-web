import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useGetAstsByLmPcodeWardPcodeQuery } from "../../redux/astsApi";
import { useGetPremisesByWardQuery } from "../../redux/mapPremisesApi";
import { useGetTrnsByLmPcodeWardPcodeQuery } from "../../redux/trnsApi";
import DownloadButtons from "../../components/DownloadButtons";

const TAB_PREMISES = "PREMISES";
const TAB_METERS = "METERS";
const TAB_TRNS = "TRNS";
const DATE_ALL = "ALL";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function valueOrNav(value) {
  const clean = String(value ?? "").trim();
  return clean || "NAv";
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMillis(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "NAv";

  return date.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value) {
  return safeNumber(value).toLocaleString("en-ZA");
}

function getRawBatch(batch = {}) {
  return batch?.raw || batch || {};
}

function getBatchId(batch = {}) {
  const raw = getRawBatch(batch);

  return readFirstString(
    batch?.bgoBatchId,
    batch?.batchId,
    batch?.id,
    raw?.id,
    raw?.bgo?.batchId,
  );
}

function getBatchWorkflowState(batch = {}) {
  const raw = getRawBatch(batch);

  return valueOrNav(
    batch?.workflowState || raw?.workflow?.state || raw?.workflowState,
  );
}

function getBatchReleaseState(batch = {}) {
  const raw = getRawBatch(batch);

  return valueOrNav(
    batch?.releaseState || raw?.bgo?.releaseState || raw?.releaseState,
  );
}

function getBatchGeofence(batch = {}) {
  const raw = getRawBatch(batch);
  const refs = asArray(raw?.geofenceRefs);
  const ref =
    batch?.geofenceRef ||
    raw?.geofenceRef ||
    raw?.bgo?.geofenceRef ||
    raw?.geofence ||
    raw?.refs?.geofenceRef ||
    refs[0] ||
    {};

  return {
    id: readFirstString(
      batch?.geofenceId,
      ref?.id,
      ref?.geofenceId,
      ref?.geoFenceId,
    ),
    name: valueOrNav(
      readFirstString(
        batch?.geofenceName,
        ref?.name,
        ref?.label,
        ref?.description,
      ),
    ),
  };
}

function getBatchTarget(batch = {}) {
  const raw = getRawBatch(batch);
  const targets = asArray(raw?.assignment?.targets);
  const target =
    batch?.target ||
    raw?.target ||
    raw?.bgo?.target ||
    raw?.refs?.target ||
    raw?.assignment?.target ||
    targets[0] ||
    {};

  return {
    type: valueOrNav(target?.type || raw?.bgo?.targetType),
    id: valueOrNav(target?.id || target?.uid || raw?.bgo?.targetId),
    name: valueOrNav(
      target?.name ||
        target?.displayName ||
        target?.title ||
        raw?.bgo?.targetName,
    ),
  };
}

function getBatchScope(batch = {}) {
  const raw = getRawBatch(batch);
  const geography =
    raw?.geography || raw?.scope || raw?.parents || raw?.bgo?.scope || {};

  return {
    lmPcode: readFirstString(
      batch?.lmPcode,
      geography?.lmPcode,
      raw?.lmPcode,
      raw?.bgo?.lmPcode,
    ),
    wardPcode: readFirstString(
      batch?.wardPcode,
      geography?.wardPcode,
      raw?.wardPcode,
      raw?.bgo?.wardPcode,
    ),
    wardName: valueOrNav(
      geography?.wardName || raw?.wardName || raw?.bgo?.wardName,
    ),
  };
}

function getBatchUpdatedAt(batch = {}) {
  const raw = getRawBatch(batch);

  return (
    batch?.updatedAt ||
    raw?.metadata?.updatedAt ||
    raw?.updatedAt ||
    batch?.issuedAt ||
    raw?.metadata?.createdAt ||
    raw?.createdAt
  );
}

function getBatchSnapshotErfCount(batch = {}) {
  const raw = getRawBatch(batch);

  return safeNumber(
    raw?.summary?.erfCount ??
      raw?.batchReleaseSummary?.totalRows ??
      raw?.counts?.erfCount ??
      raw?.counts?.totalErfs,
  );
}

function isMdBgoBatch(batch = {}) {
  const raw = getRawBatch(batch);
  const operationType = normalize(
    batch?.operationType ||
      raw?.operationType ||
      raw?.bgo?.operationType ||
      raw?.trnType,
  );
  const batchMode = normalize(
    raw?.bgo?.batchMode || raw?.batchMode || raw?.origin?.sourceModule,
  );

  return (
    operationType === "METER_DISCOVERY" ||
    batchMode === "BMD" ||
    batchMode === "BULK_METER_DISCOVERY"
  );
}

function getEntityGeofenceRefs(entity = {}) {
  return asArray(
    entity?.geofenceRefs ||
      entity?.__geofenceRefs ||
      entity?.ast?.geofenceRefs ||
      entity?.premise?.geofenceRefs ||
      entity?.accessData?.geofenceRefs ||
      entity?.refs?.geofenceRefs ||
      [],
  )
    .map((ref) => ({
      id: readFirstString(ref?.id, ref?.geofenceId, ref?.geoFenceId),
      name: readFirstString(ref?.name, ref?.label, ref?.description),
    }))
    .filter((ref) => ref.id);
}

function hasGeofenceRef(entity = {}, geofenceId = "") {
  const cleanId = String(geofenceId || "").trim();
  if (!cleanId) return false;

  return getEntityGeofenceRefs(entity).some((ref) => ref.id === cleanId);
}

function getPremiseId(premise = {}) {
  return readFirstString(premise?.premiseId, premise?.id, premise?.__premiseId);
}

function getPremiseAddress(premise = {}) {
  const address = premise?.address || {};
  const built = [address?.strNo, address?.strName, address?.strType]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  return valueOrNav(
    premise?.premiseAddress ||
      premise?.addressSnapshot ||
      premise?.accessData?.premise?.address ||
      premise?.premise?.address ||
      built,
  );
}

function getPremiseErfNo(premise = {}) {
  return valueOrNav(
    premise?.erfNo || premise?.erf?.erfNo || premise?.accessData?.erfNo,
  );
}

function getPremisePropertyType(premise = {}) {
  return valueOrNav(
    premise?.propertyTypeLabel ||
      premise?.propertyType?.type ||
      premise?.premise?.propertyType ||
      premise?.accessData?.premise?.propertyType,
  );
}

function getPremisePropertyName(premise = {}) {
  return valueOrNav(premise?.propertyName || premise?.propertyType?.name);
}

function getPremiseUnitNo(premise = {}) {
  return valueOrNav(premise?.unitNo || premise?.propertyType?.unitNo);
}

function getCreatedBy(entity = {}) {
  return valueOrNav(
    entity?.metadata?.createdByUser ||
      entity?.metadata?.created?.byUser ||
      entity?.createdByUser ||
      entity?.issuedByUser,
  );
}

function getCreatedAt(entity = {}) {
  return (
    entity?.metadata?.createdAt ||
    entity?.metadata?.created?.at ||
    entity?.createdAt ||
    entity?.issuedAt ||
    entity?.workflow?.issuedAt
  );
}

function getLatestActivity(entity = {}) {
  return (
    entity?.metadata?.updatedAt ||
    entity?.metadata?.updated?.at ||
    entity?.updatedAt ||
    entity?.workflow?.completedAt ||
    getCreatedAt(entity)
  );
}

function getMeterId(meter = {}) {
  return readFirstString(
    meter?.ast?.astData?.astId,
    meter?.astData?.astId,
    meter?.meterId,
    meter?.id,
  );
}

function getMeterAstLookupKeys(meter = {}) {
  const source = meter?.source || meter;

  return [
    meter?.id,
    meter?.astId,
    meter?.derived?.astId,
    source?.id,
    source?.astId,
    source?.derived?.astId,
    source?.ast?.astData?.astId,
    source?.astData?.astId,
    source?.meterId,
  ]
    .map((value) => normalize(value))
    .filter(Boolean);
}

function getMeterNo(meter = {}) {
  return valueOrNav(
    readFirstString(
      meter?.ast?.astData?.astNo,
      meter?.astData?.astNo,
      meter?.meterNo,
      meter?.master?.id,
    ),
  );
}

function getMeterPremiseId(meter = {}) {
  return readFirstString(
    meter?.accessData?.premise?.id,
    meter?.premiseId,
    meter?.premise?.id,
    meter?.premise?.premiseId,
  );
}

function getMeterPremiseAddress(meter = {}) {
  return valueOrNav(
    meter?.accessData?.premise?.address ||
      meter?.premiseAddress ||
      meter?.premise?.address,
  );
}

function getMeterErfNo(meter = {}) {
  return valueOrNav(meter?.accessData?.erfNo || meter?.erfNo);
}

function getMeterType(meter = {}) {
  return valueOrNav(meter?.meterType || meter?.accessData?.meterType);
}

function getMeterKind(meter = {}) {
  return valueOrNav(
    meter?.ast?.astData?.meter?.type ||
      meter?.astData?.meter?.type ||
      meter?.meterKind,
  );
}

function getMeterPhase(meter = {}) {
  return valueOrNav(
    meter?.ast?.astData?.meter?.phase ||
      meter?.astData?.meter?.phase ||
      meter?.meterPhase,
  );
}

function getTrnId(trn = {}) {
  return readFirstString(trn?.trnId, trn?.id);
}

function getTrnAstId(trn = {}) {
  const raw = trn?.raw || {};

  return readFirstString(
    trn?.derived?.astId,
    raw?.derived?.astId,
    trn?.astId,
    raw?.astId,
    trn?.ast?.astData?.astId,
    raw?.ast?.astData?.astId,
  );
}

function getTrnAstLookupKeys(trn = {}) {
  return [getTrnAstId(trn), getTrnId(trn)]
    .map((value) => normalize(value))
    .filter(Boolean);
}

function getTrnBgoBatchId(trn = {}) {
  return valueOrNav(
    trn?.bgoBatchId ||
      trn?.batchId ||
      trn?.raw?.bgo?.batchId ||
      trn?.raw?.origin?.bgoBatchId,
  );
}

function getTrnOutcome(trn = {}) {
  return valueOrNav(
    trn?.executionOutcomeCode ||
      trn?.outcome ||
      trn?.raw?.executionOutcome?.code,
  );
}

function getTrnAccess(trn = {}) {
  const answer = readFirstString(
    trn?.raw?.accessData?.access?.hasAccess,
    trn?.accessData?.access?.hasAccess,
    trn?.raw?.fieldData?.access?.hasAccess,
  ).toLowerCase();

  if (answer === "yes") return "YES";
  if (answer === "no") return "NO";

  const outcome = normalize(getTrnOutcome(trn));
  if (outcome === "NO_ACCESS") return "NO";
  if (outcome === "SUCCESS") return "YES";

  return "NAv";
}

function formatTrnPremiseAddressValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object") return String(value).trim();

  const built = [value?.strNo, value?.strName, value?.strType]
    .filter(Boolean)
    .join(" ")
    .trim();

  return readFirstString(
    built,
    value?.fullAddress,
    value?.addressLine,
    value?.line1,
    value?.label,
    value?.description,
  );
}

function getTrnPremiseAddress(trn = {}) {
  const raw = trn?.raw || {};

  return valueOrNav(
    readFirstString(
      trn?.premiseAddress,
      raw?.premiseAddress,
      formatTrnPremiseAddressValue(trn?.accessData?.premise?.address),
      formatTrnPremiseAddressValue(raw?.accessData?.premise?.address),
      formatTrnPremiseAddressValue(trn?.premise?.address),
      formatTrnPremiseAddressValue(raw?.premise?.address),
    ),
  );
}

function getTrnPremiseId(trn = {}) {
  return valueOrNav(
    trn?.premiseId ||
      trn?.accessData?.premise?.id ||
      trn?.raw?.premiseId ||
      trn?.raw?.accessData?.premise?.id,
  );
}

function getTrnMeterNo(trn = {}) {
  return valueOrNav(
    trn?.astNo ||
      trn?.meterNo ||
      trn?.raw?.ast?.astData?.astNo ||
      trn?.raw?.meterNo,
  );
}

function includesText(value, filter) {
  const cleanFilter = String(filter || "")
    .trim()
    .toLowerCase();
  if (!cleanFilter) return true;

  return String(value || "")
    .toLowerCase()
    .includes(cleanFilter);
}

function getDatePresetBounds(preset) {
  if (!preset || preset === DATE_ALL) return null;

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (preset === "TODAY") {
    return { start, end: now };
  }

  if (preset === "YESTERDAY") {
    const yesterdayStart = new Date(start);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return { start: yesterdayStart, end: start };
  }

  if (preset === "THIS_WEEK") {
    const day = start.getDay() || 7;
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - day + 1);
    return { start: weekStart, end: now };
  }

  if (preset === "LAST_MONTH") {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: monthStart, end: monthEnd };
  }

  return null;
}

function matchesDatePreset(value, preset) {
  const bounds = getDatePresetBounds(preset);
  if (!bounds) return true;

  const ms = toMillis(value);
  if (!ms) return false;

  return ms >= bounds.start.getTime() && ms < bounds.end.getTime();
}

function buildPremiseRows({ premises, meters, geofenceId }) {
  const metersByPremiseId = asArray(meters).reduce((acc, meter) => {
    const premiseId = getMeterPremiseId(meter);
    if (!premiseId) return acc;
    acc[premiseId] = (acc[premiseId] || 0) + 1;
    return acc;
  }, {});

  return asArray(premises)
    .filter((premise) => hasGeofenceRef(premise, geofenceId))
    .map((premise) => {
      const premiseId = getPremiseId(premise);
      return {
        source: premise,
        id: premiseId,
        address: getPremiseAddress(premise),
        erfNo: getPremiseErfNo(premise),
        propertyType: getPremisePropertyType(premise),
        propertyName: getPremisePropertyName(premise),
        unitNo: getPremiseUnitNo(premise),
        meters: safeNumber(metersByPremiseId[premiseId]),
        latestActivity: getLatestActivity(premise),
        createdBy: getCreatedBy(premise),
        createdAt: getCreatedAt(premise),
      };
    })
    .sort(
      (left, right) =>
        toMillis(right.latestActivity) - toMillis(left.latestActivity),
    );
}

function buildMeterRows({ meters, geofenceId }) {
  return asArray(meters)
    .filter((meter) => hasGeofenceRef(meter, geofenceId))
    .map((meter) => ({
      source: meter,
      id: getMeterId(meter),
      meterNo: getMeterNo(meter),
      meterType: getMeterType(meter),
      meterKind: getMeterKind(meter),
      meterPhase: getMeterPhase(meter),
      status: valueOrNav(meter?.status?.state),
      premiseAddress: getMeterPremiseAddress(meter),
      premiseId: getMeterPremiseId(meter) || "NAv",
      erfNo: getMeterErfNo(meter),
      createdBy: getCreatedBy(meter),
      createdAt: getCreatedAt(meter),
      latestActivity: getLatestActivity(meter),
    }))
    .sort(
      (left, right) =>
        toMillis(right.latestActivity) - toMillis(left.latestActivity),
    );
}

function buildTrnRows({ trns, bgoBatchId, geofenceId, meters }) {
  const meterAstLookup = new Set(
    asArray(meters).flatMap((meter) => getMeterAstLookupKeys(meter)),
  );

  return asArray(trns)
    .filter((trn) => {
      const batchMatches =
        bgoBatchId &&
        normalize(getTrnBgoBatchId(trn)) === normalize(bgoBatchId);
      const astMatches = getTrnAstLookupKeys(trn).some((key) =>
        meterAstLookup.has(key),
      );

      return (
        batchMatches ||
        astMatches ||
        hasGeofenceRef(trn, geofenceId) ||
        normalize(trn?.geofenceId) === normalize(geofenceId)
      );
    })
    .map((trn) => ({
      source: trn,
      id: getTrnId(trn),
      astId: valueOrNav(getTrnAstId(trn)),
      trnType: valueOrNav(trn?.trnType),
      workflow: valueOrNav(trn?.workflowState || trn?.state),
      outcome: getTrnOutcome(trn),
      access: getTrnAccess(trn),
      erfNo: valueOrNav(trn?.erfNo || trn?.raw?.accessData?.erfNo),
      premiseAddress: getTrnPremiseAddress(trn),
      premiseId: getTrnPremiseId(trn),
      meterNo: getTrnMeterNo(trn),
      executor: valueOrNav(
        trn?.completedByUser ||
          trn?.issuedByUser ||
          trn?.metadata?.createdByUser,
      ),
      createdAt: getCreatedAt(trn),
      completedAt:
        trn?.completedAt ||
        trn?.workflow?.completedAt ||
        trn?.raw?.workflow?.completedAt,
      batchId: getTrnBgoBatchId(trn),
    }))
    .sort(
      (left, right) => toMillis(right.createdAt) - toMillis(left.createdAt),
    );
}

function getAccessTrnCount(rows) {
  return rows.filter(
    (row) => row.access === "YES" || normalize(row.outcome) === "SUCCESS",
  ).length;
}

function getNoAccessTrnCount(rows) {
  return rows.filter(
    (row) => row.access === "NO" || normalize(row.outcome) === "NO_ACCESS",
  ).length;
}

function FilterInput({ value, onChange, placeholder = "" }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.columnFilterInput}
    />
  );
}

function DatePresetFilter({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={styles.columnFilterInput}
    >
      <option value="ALL">All dates</option>
      <option value="TODAY">Today</option>
      <option value="YESTERDAY">Yesterday</option>
      <option value="THIS_WEEK">This week</option>
      <option value="LAST_MONTH">Last month</option>
    </select>
  );
}

function buildSelectOptions(rows, key) {
  return Array.from(
    new Set(
      rows
        .map((row) => String(row?.[key] ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, "en-ZA"));
}

function SelectFilter({ value, onChange, options, allLabel = "All" }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={styles.columnFilterInput}
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function ThFilter({ label, children }) {
  return (
    <th style={styles.th}>
      <div style={styles.thLabel}>{label}</div>
      {children}
    </th>
  );
}

function InfoCard({ label, value, tone = "default" }) {
  return (
    <div
      style={{
        ...styles.infoCard,
        ...(tone === "success" ? styles.infoCardSuccess : null),
      }}
    >
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value}</strong>
    </div>
  );
}

function EmptyRows({ title, body }) {
  return (
    <div style={styles.emptyPanel}>
      <p style={styles.eyebrow}>No rows</p>
      <h3 style={styles.emptyTitle}>{title}</h3>
      <p style={styles.mutedText}>{body}</p>
    </div>
  );
}

export default function MdBgoRowsPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(TAB_PREMISES);
  const [premiseFilters, setPremiseFilters] = useState({
    address: "",
    erfNo: "",
    propertyType: "",
    propertyName: "",
    unitNo: "",
    meters: "",
    latestActivity: DATE_ALL,
    createdBy: "",
    createdAt: DATE_ALL,
  });
  const [meterFilters, setMeterFilters] = useState({
    meterNo: "",
    meterType: "",
    meterKind: "",
    meterPhase: "",
    status: "",
    premiseAddress: "",
    erfNo: "",
    createdBy: "",
    createdAt: DATE_ALL,
  });
  const [trnFilters, setTrnFilters] = useState({
    trnType: "",
    workflow: "",
    outcome: "",
    access: "",
    erfNo: "",
    premiseId: "",
    meterNo: "",
    executor: "",
    createdAt: DATE_ALL,
  });

  const queryLmPcode = readFirstString(searchParams.get("lmPcode"));
  const queryWardPcode = readFirstString(searchParams.get("wardPcode"));
  const queryBatchId = readFirstString(
    searchParams.get("bgoBatchId"),
    searchParams.get("batchId"),
  );
  const queryGeofenceId = readFirstString(
    searchParams.get("focusGeofenceId"),
    searchParams.get("geofenceId"),
  );
  const queryGeofenceName = readFirstString(
    searchParams.get("focusGeofenceName"),
  );
  const queryTargetType = readFirstString(searchParams.get("targetType"));
  const queryTargetName = readFirstString(searchParams.get("targetName"));
  const queryWorkflowState = readFirstString(searchParams.get("workflowState"));
  const queryReleaseState = readFirstString(searchParams.get("releaseState"));
  const queryTotalErfs = readFirstString(
    searchParams.get("totalErfs"),
    searchParams.get("erfCount"),
  );

  const target = {
    type: valueOrNav(queryTargetType),
    name: valueOrNav(queryTargetName),
  };
  const workflowState = valueOrNav(queryWorkflowState);
  const releaseState = valueOrNav(queryReleaseState);
  const lmPcode = queryLmPcode;
  const wardPcode = queryWardPcode;
  const geofenceId = queryGeofenceId;
  const geofenceName = queryGeofenceName;

  const { data: premises = [], isLoading: isLoadingPremises } =
    useGetPremisesByWardQuery(wardPcode, { skip: !wardPcode });

  const { data: meters = [], isLoading: isLoadingMeters } =
    useGetAstsByLmPcodeWardPcodeQuery(
      { lmPcode, wardPcode },
      { skip: !lmPcode || !wardPcode },
    );

  const { data: trns = [], isLoading: isLoadingTrns } =
    useGetTrnsByLmPcodeWardPcodeQuery(
      { lmPcode, wardPcode, limit: 2000 },
      { skip: !lmPcode || !wardPcode },
    );
  console.log("MD BGO Rows raw trns", trns.length, trns);

  const premiseRows = useMemo(
    () => buildPremiseRows({ premises, meters, geofenceId }),
    [premises, meters, geofenceId],
  );

  const meterRows = useMemo(
    () => buildMeterRows({ meters, geofenceId }),
    [meters, geofenceId],
  );

  const trnRows = useMemo(
    () =>
      buildTrnRows({
        trns,
        bgoBatchId: queryBatchId,
        geofenceId,
        meters: meterRows,
      }),
    [trns, queryBatchId, geofenceId, meterRows],
  );
  console.log("MD BGO Rows filtered trnRows", trnRows.length, trnRows);

  const visiblePremiseRows = useMemo(() => {
    return premiseRows.filter((row) => {
      return (
        includesText(`${row.address} ${row.id}`, premiseFilters.address) &&
        includesText(row.erfNo, premiseFilters.erfNo) &&
        includesText(row.propertyType, premiseFilters.propertyType) &&
        includesText(row.propertyName, premiseFilters.propertyName) &&
        includesText(row.unitNo, premiseFilters.unitNo) &&
        includesText(row.meters, premiseFilters.meters) &&
        matchesDatePreset(row.latestActivity, premiseFilters.latestActivity) &&
        includesText(row.createdBy, premiseFilters.createdBy) &&
        matchesDatePreset(row.createdAt, premiseFilters.createdAt)
      );
    });
  }, [premiseRows, premiseFilters]);

  const visibleMeterRows = useMemo(() => {
    return meterRows.filter((row) => {
      return (
        includesText(row.meterNo, meterFilters.meterNo) &&
        includesText(row.meterType, meterFilters.meterType) &&
        includesText(row.meterKind, meterFilters.meterKind) &&
        includesText(row.meterPhase, meterFilters.meterPhase) &&
        includesText(row.status, meterFilters.status) &&
        includesText(
          `${row.premiseAddress} ${row.premiseId}`,
          meterFilters.premiseAddress,
        ) &&
        includesText(row.erfNo, meterFilters.erfNo) &&
        includesText(row.createdBy, meterFilters.createdBy) &&
        matchesDatePreset(row.createdAt, meterFilters.createdAt)
      );
    });
  }, [meterRows, meterFilters]);

  const visibleTrnRows = useMemo(() => {
    return trnRows.filter((row) => {
      return (
        includesText(row.trnType, trnFilters.trnType) &&
        includesText(row.workflow, trnFilters.workflow) &&
        includesText(row.outcome, trnFilters.outcome) &&
        includesText(row.access, trnFilters.access) &&
        includesText(row.erfNo, trnFilters.erfNo) &&
        includesText(
          `${row.premiseAddress} ${row.premiseId}`,
          trnFilters.premiseId,
        ) &&
        includesText(row.meterNo, trnFilters.meterNo) &&
        includesText(row.executor, trnFilters.executor) &&
        matchesDatePreset(row.createdAt, trnFilters.createdAt)
      );
    });
  }, [trnRows, trnFilters]);

  const meterFilterOptions = useMemo(
    () => ({
      meterType: buildSelectOptions(meterRows, "meterType"),
      meterKind: buildSelectOptions(meterRows, "meterKind"),
      meterPhase: buildSelectOptions(meterRows, "meterPhase"),
      status: buildSelectOptions(meterRows, "status"),
    }),
    [meterRows],
  );

  const trnFilterOptions = useMemo(
    () => ({
      trnType: buildSelectOptions(trnRows, "trnType"),
      workflow: buildSelectOptions(trnRows, "workflow"),
      outcome: buildSelectOptions(trnRows, "outcome"),
      access: buildSelectOptions(trnRows, "access"),
      erfNo: buildSelectOptions(trnRows, "erfNo"),
      executor: buildSelectOptions(trnRows, "executor"),
    }),
    [trnRows],
  );

  const accessTrns = getAccessTrnCount(trnRows);
  const noAccessTrns = getNoAccessTrnCount(trnRows);
  const accessBalanced = accessTrns === meterRows.length;
  const erfCount = safeNumber(queryTotalErfs);
  const isLoadingRows = isLoadingPremises || isLoadingMeters || isLoadingTrns;

  const quickDownloadScope = useMemo(
    () => ({
      module: "MD BGO Rows",
      lmPcode: lmPcode || "NAv",
      wardPcode: wardPcode || "NAv",
      bgoBatchId: queryBatchId || "NAv",
      geofenceId: geofenceId || "NAv",
      geofenceName: geofenceName || "NAv",
      targetType: target.type || "NAv",
      targetName: target.name || "NAv",
    }),
    [
      lmPcode,
      wardPcode,
      queryBatchId,
      geofenceId,
      geofenceName,
      target.type,
      target.name,
    ],
  );

  const premiseQuickDownloadColumns = useMemo(
    () => [
      { header: "Premise Address", value: (row) => row.address || "NAv" },
      { header: "Premise ID", value: (row) => row.id || "NAv" },
      { header: "ERF No", value: (row) => row.erfNo || "NAv" },
      { header: "Property Type", value: (row) => row.propertyType || "NAv" },
      { header: "Property Name", value: (row) => row.propertyName || "NAv" },
      { header: "Unit No", value: (row) => row.unitNo || "NAv" },
      { header: "Meters", value: (row) => row.meters ?? 0 },
      {
        header: "Latest Activity",
        value: (row) => formatDateTime(row.latestActivity),
      },
      { header: "Created By", value: (row) => row.createdBy || "NAv" },
      { header: "Created At", value: (row) => formatDateTime(row.createdAt) },
    ],
    [],
  );

  const meterQuickDownloadColumns = useMemo(
    () => [
      { header: "Meter No", value: (row) => row.meterNo || "NAv" },
      { header: "Meter ID", value: (row) => row.id || "NAv" },
      { header: "Meter Type", value: (row) => row.meterType || "NAv" },
      { header: "Meter Kind", value: (row) => row.meterKind || "NAv" },
      { header: "Phase", value: (row) => row.meterPhase || "NAv" },
      { header: "Status", value: (row) => row.status || "NAv" },
      { header: "Premise Address", value: (row) => row.premiseAddress || "NAv" },
      { header: "Premise ID", value: (row) => row.premiseId || "NAv" },
      { header: "ERF No", value: (row) => row.erfNo || "NAv" },
      { header: "Created By", value: (row) => row.createdBy || "NAv" },
      { header: "Created At", value: (row) => formatDateTime(row.createdAt) },
    ],
    [],
  );

  const trnQuickDownloadColumns = useMemo(
    () => [
      { header: "TRN Type", value: (row) => row.trnType || "NAv" },
      { header: "Workflow", value: (row) => row.workflow || "NAv" },
      { header: "Outcome", value: (row) => row.outcome || "NAv" },
      { header: "Access", value: (row) => row.access || "NAv" },
      { header: "ERF No", value: (row) => row.erfNo || "NAv" },
      { header: "Premise Address", value: (row) => row.premiseAddress || "NAv" },
      { header: "Premise ID", value: (row) => row.premiseId || "NAv" },
      { header: "Meter No", value: (row) => row.meterNo || "NAv" },
      { header: "Executor", value: (row) => row.executor || "NAv" },
      { header: "Batch ID", value: (row) => row.batchId || "NAv" },
      { header: "Created At", value: (row) => formatDateTime(row.createdAt) },
    ],
    [],
  );

  const mapRoute = `/operations/geo-fences?${new URLSearchParams({
    lmPcode: lmPcode || "",
    wardPcode: wardPcode || "",
    focusGeofenceId: geofenceId || "",
    focusGeofenceName: geofenceName || "",
    fitGeofence: "true",
  }).toString()}`;

  const mdBgoRoute = `/operations/bgo?${new URLSearchParams({
    lmPcode: lmPcode || "",
    wardPcode: wardPcode || "",
    bgoBatchId: queryBatchId || "",
    focusGeofenceId: geofenceId || "",
    focusGeofenceName: geofenceName || "",
  }).toString()}`;

  return (
    <section style={styles.page}>
      <div style={styles.backRow}>
        <Link to="/operations/bgo-dashboard" style={styles.backLink}>
          ← Back to BGO Dashboard
        </Link>
        <Link to={mdBgoRoute} style={styles.backLink}>
          Open MD BGO
        </Link>
        <Link to={mapRoute} style={styles.backLink}>
          Open Map
        </Link>
      </div>

      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Operations / MD BGO Rows</p>
          <h2 style={styles.title}>{geofenceName || "MD BGO Rows"}</h2>
          <p style={styles.description}>
            Ward {valueOrNav(wardPcode)} • Target {target.type} • {target.name}
          </p>
          <p style={styles.fileName}>{valueOrNav(queryBatchId)}</p>
        </div>

        <div style={styles.statusStack}>
          <span style={styles.statusPill}>{workflowState}</span>
          <span style={styles.releasePill}>{releaseState}</span>
        </div>
      </div>

      <div style={styles.summaryGrid}>
        <InfoCard label="ERFs in geofence" value={formatNumber(erfCount)} />
        <InfoCard
          label="Premises created"
          value={formatNumber(premiseRows.length)}
        />
        <InfoCard
          label="Meters created"
          value={formatNumber(meterRows.length)}
        />
        <InfoCard label="Discovery TRNs" value={formatNumber(trnRows.length)} />
        <InfoCard
          label="Access TRNs"
          value={formatNumber(accessTrns)}
          tone={accessBalanced ? "success" : "default"}
        />
        <InfoCard label="No-access TRNs" value={formatNumber(noAccessTrns)} />
      </div>


      {isLoadingRows ? (
        <div style={styles.notice}>Loading MD BGO rows...</div>
      ) : null}

      <div style={styles.tabRow}>
        <button
          type="button"
          style={{
            ...styles.tabButton,
            ...(activeTab === TAB_PREMISES ? styles.tabButtonActive : null),
          }}
          onClick={() => setActiveTab(TAB_PREMISES)}
        >
          Premises ({formatNumber(visiblePremiseRows.length)})
        </button>
        <button
          type="button"
          style={{
            ...styles.tabButton,
            ...(activeTab === TAB_METERS ? styles.tabButtonActive : null),
          }}
          onClick={() => setActiveTab(TAB_METERS)}
        >
          Meters ({formatNumber(visibleMeterRows.length)})
        </button>
        <button
          type="button"
          style={{
            ...styles.tabButton,
            ...(activeTab === TAB_TRNS ? styles.tabButtonActive : null),
          }}
          onClick={() => setActiveTab(TAB_TRNS)}
        >
          TRNs ({formatNumber(visibleTrnRows.length)})
        </button>
      </div>

      {activeTab === TAB_PREMISES ? (
        <div style={styles.tablePanel}>
          <div style={styles.tableHeaderRow}>
            <div style={styles.tableHeaderText}>
              <h3 style={styles.panelTitle}>Premises created in geofence</h3>
              <p style={styles.mutedText}>
                Address carries the Premise ID underneath. All columns have
                header filters.
              </p>
            </div>
            <div style={styles.tableActions}>
              <DownloadButtons
                registryName="MD BGO Premises"
                rowsLabel="premises"
                visibleRows={visiblePremiseRows}
                columns={premiseQuickDownloadColumns}
                fileBaseName="md_bgo_premises"
                scope={quickDownloadScope}
              />

              <button
                type="button"
                style={styles.clearButton}
                onClick={() =>
                  setPremiseFilters({
                    address: "",
                    erfNo: "",
                    propertyType: "",
                    propertyName: "",
                    unitNo: "",
                    meters: "",
                    latestActivity: DATE_ALL,
                    createdBy: "",
                    createdAt: DATE_ALL,
                  })
                }
              >
                Clear filters
              </button>
            </div>
          </div>

          {visiblePremiseRows.length === 0 ? (
            <EmptyRows
              title="No premises match the current filters."
              body="Clear the filters or confirm that premises have been created in this MD BGO geofence."
            />
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <ThFilter label="Address">
                      <FilterInput
                        value={premiseFilters.address}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            address: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="ERF No">
                      <FilterInput
                        value={premiseFilters.erfNo}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            erfNo: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Property Type">
                      <FilterInput
                        value={premiseFilters.propertyType}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            propertyType: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Property Name">
                      <FilterInput
                        value={premiseFilters.propertyName}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            propertyName: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Unit No">
                      <FilterInput
                        value={premiseFilters.unitNo}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            unitNo: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Meters">
                      <FilterInput
                        value={premiseFilters.meters}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            meters: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Latest Activity">
                      <DatePresetFilter
                        value={premiseFilters.latestActivity}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            latestActivity: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Created By">
                      <FilterInput
                        value={premiseFilters.createdBy}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            createdBy: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Created At">
                      <DatePresetFilter
                        value={premiseFilters.createdAt}
                        onChange={(value) =>
                          setPremiseFilters((prev) => ({
                            ...prev,
                            createdAt: value,
                          }))
                        }
                      />
                    </ThFilter>
                  </tr>
                </thead>
                <tbody>
                  {visiblePremiseRows.map((row) => (
                    <tr key={row.id}>
                      <td style={styles.td}>
                        <strong>{row.address}</strong>
                        <span style={styles.subText}>{row.id}</span>
                      </td>
                      <td style={styles.td}>{row.erfNo}</td>
                      <td style={styles.td}>{row.propertyType}</td>
                      <td style={styles.td}>{row.propertyName}</td>
                      <td style={styles.td}>{row.unitNo}</td>
                      <td style={styles.tdStrong}>
                        {formatNumber(row.meters)}
                      </td>
                      <td style={styles.td}>
                        {formatDateTime(row.latestActivity)}
                      </td>
                      <td style={styles.td}>{row.createdBy}</td>
                      <td style={styles.td}>{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === TAB_METERS ? (
        <div style={styles.tablePanel}>
          <div style={styles.tableHeaderRow}>
            <div style={styles.tableHeaderText}>
              <h3 style={styles.panelTitle}>Meters created in geofence</h3>
              <p style={styles.mutedText}>
                Live AST rows filtered to the focused MD BGO geofence.
              </p>
            </div>
            <div style={styles.tableActions}>
              <DownloadButtons
                registryName="MD BGO Meters"
                rowsLabel="meters"
                visibleRows={visibleMeterRows}
                columns={meterQuickDownloadColumns}
                fileBaseName="md_bgo_meters"
                scope={quickDownloadScope}
              />

              <button
                type="button"
                style={styles.clearButton}
                onClick={() =>
                  setMeterFilters({
                    meterNo: "",
                    meterType: "",
                    meterKind: "",
                    meterPhase: "",
                    status: "",
                    premiseAddress: "",
                    erfNo: "",
                    createdBy: "",
                    createdAt: DATE_ALL,
                  })
                }
              >
                Clear filters
              </button>
            </div>
          </div>

          {visibleMeterRows.length === 0 ? (
            <EmptyRows
              title="No meters match the current filters."
              body="Clear the filters or confirm that meters have been captured in this MD BGO geofence."
            />
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <ThFilter label="Meter No">
                      <FilterInput
                        value={meterFilters.meterNo}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({
                            ...prev,
                            meterNo: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Premise Address">
                      <FilterInput
                        value={meterFilters.premiseAddress}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({
                            ...prev,
                            premiseAddress: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="ERF No">
                      <FilterInput
                        value={meterFilters.erfNo}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({ ...prev, erfNo: value }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Type">
                      <SelectFilter
                        value={meterFilters.meterType}
                        options={meterFilterOptions.meterType}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({
                            ...prev,
                            meterType: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Kind">
                      <SelectFilter
                        value={meterFilters.meterKind}
                        options={meterFilterOptions.meterKind}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({
                            ...prev,
                            meterKind: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Phase">
                      <SelectFilter
                        value={meterFilters.meterPhase}
                        options={meterFilterOptions.meterPhase}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({
                            ...prev,
                            meterPhase: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Status">
                      <SelectFilter
                        value={meterFilters.status}
                        options={meterFilterOptions.status}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({
                            ...prev,
                            status: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Created By">
                      <FilterInput
                        value={meterFilters.createdBy}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({
                            ...prev,
                            createdBy: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Created At">
                      <DatePresetFilter
                        value={meterFilters.createdAt}
                        onChange={(value) =>
                          setMeterFilters((prev) => ({
                            ...prev,
                            createdAt: value,
                          }))
                        }
                      />
                    </ThFilter>
                  </tr>
                </thead>
                <tbody>
                  {visibleMeterRows.map((row) => (
                    <tr key={row.id}>
                      <td style={styles.tdStrong}>{row.meterNo}</td>
                      <td style={styles.td}>
                        {row.premiseAddress}
                        <span style={styles.subText}>{row.premiseId}</span>
                      </td>
                      <td style={styles.td}>{row.erfNo}</td>
                      <td style={styles.td}>{row.meterType}</td>
                      <td style={styles.td}>{row.meterKind}</td>
                      <td style={styles.td}>{row.meterPhase}</td>
                      <td style={styles.td}>{row.status}</td>
                      <td style={styles.td}>{row.createdBy}</td>
                      <td style={styles.td}>{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === TAB_TRNS ? (
        <div style={styles.tablePanel}>
          <div style={styles.tableHeaderRow}>
            <div style={styles.tableHeaderText}>
              <h3 style={styles.panelTitle}>TRNs created in geofence</h3>
              <p style={styles.mutedText}>
                Shows access and no-access discovery TRNs for the focused
                batch/geofence.
              </p>
            </div>
            <div style={styles.tableActions}>
              <DownloadButtons
                registryName="MD BGO TRNs"
                rowsLabel="TRNs"
                visibleRows={visibleTrnRows}
                columns={trnQuickDownloadColumns}
                fileBaseName="md_bgo_trns"
                scope={quickDownloadScope}
              />

              <button
                type="button"
                style={styles.clearButton}
                onClick={() =>
                  setTrnFilters({
                    trnType: "",
                    workflow: "",
                    outcome: "",
                    access: "",
                    erfNo: "",
                    premiseId: "",
                    meterNo: "",
                    executor: "",
                    createdAt: DATE_ALL,
                  })
                }
              >
                Clear filters
              </button>
            </div>
          </div>

          {visibleTrnRows.length === 0 ? (
            <EmptyRows
              title="No TRNs match the current filters."
              body="Clear filters or confirm that field discovery work has started for this MD BGO geofence."
            />
          ) : (
            <div style={styles.tableWrap}>
              <table style={{ ...styles.table, ...styles.trnTable }}>
                <colgroup>
                  <col style={{ width: 180 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 250 }} />
                  <col style={{ width: 170 }} />
                  <col style={{ width: 180 }} />
                  <col style={{ width: 190 }} />
                </colgroup>
                <thead>
                  <tr>
                    <ThFilter label="TRN Type">
                      <SelectFilter
                        value={trnFilters.trnType}
                        options={trnFilterOptions.trnType}
                        allLabel="All types"
                        onChange={(value) =>
                          setTrnFilters((prev) => ({ ...prev, trnType: value }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Workflow">
                      <SelectFilter
                        value={trnFilters.workflow}
                        options={trnFilterOptions.workflow}
                        allLabel="All workflow"
                        onChange={(value) =>
                          setTrnFilters((prev) => ({
                            ...prev,
                            workflow: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Outcome">
                      <SelectFilter
                        value={trnFilters.outcome}
                        options={trnFilterOptions.outcome}
                        allLabel="All outcomes"
                        onChange={(value) =>
                          setTrnFilters((prev) => ({ ...prev, outcome: value }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Access">
                      <SelectFilter
                        value={trnFilters.access}
                        options={trnFilterOptions.access}
                        allLabel="All access"
                        onChange={(value) =>
                          setTrnFilters((prev) => ({ ...prev, access: value }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="ERF No">
                      <SelectFilter
                        value={trnFilters.erfNo}
                        options={trnFilterOptions.erfNo}
                        allLabel="All ERFs"
                        onChange={(value) =>
                          setTrnFilters((prev) => ({ ...prev, erfNo: value }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Premise Address">
                      <FilterInput
                        value={trnFilters.premiseId}
                        onChange={(value) =>
                          setTrnFilters((prev) => ({
                            ...prev,
                            premiseId: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Meter No">
                      <FilterInput
                        value={trnFilters.meterNo}
                        onChange={(value) =>
                          setTrnFilters((prev) => ({ ...prev, meterNo: value }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Executor">
                      <SelectFilter
                        value={trnFilters.executor}
                        options={trnFilterOptions.executor}
                        allLabel="All executors"
                        onChange={(value) =>
                          setTrnFilters((prev) => ({
                            ...prev,
                            executor: value,
                          }))
                        }
                      />
                    </ThFilter>
                    <ThFilter label="Created At">
                      <DatePresetFilter
                        value={trnFilters.createdAt}
                        onChange={(value) =>
                          setTrnFilters((prev) => ({
                            ...prev,
                            createdAt: value,
                          }))
                        }
                      />
                    </ThFilter>
                  </tr>
                </thead>
                <tbody>
                  {visibleTrnRows.map((row) => (
                    <tr key={row.id}>
                      <td style={styles.td}>{row.trnType}</td>
                      <td style={styles.td}>{row.workflow}</td>
                      <td style={styles.td}>{row.outcome}</td>
                      <td style={styles.td}>{row.access}</td>
                      <td style={styles.td}>{row.erfNo}</td>
                      <td style={styles.td}>
                        <strong>{row.premiseAddress}</strong>
                        <span style={styles.subText}>{row.premiseId}</span>
                      </td>
                      <td style={styles.td}>{row.meterNo}</td>
                      <td style={styles.td}>{row.executor}</td>
                      <td style={styles.td}>{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 18,
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
    boxSizing: "border-box",
  },
  backRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    minWidth: 0,
    maxWidth: "100%",
  },
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid #CBD5E1",
    background: "#FFFFFF",
    color: "#0F172A",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 900,
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    flexWrap: "wrap",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: 24,
    borderRadius: 24,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },
  eyebrow: {
    margin: 0,
    color: "#64748B",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    color: "#0F172A",
    fontSize: 28,
    lineHeight: 1.1,
  },
  description: {
    margin: "10px 0 0",
    color: "#475569",
    lineHeight: 1.55,
  },
  fileName: {
    margin: "8px 0 0",
    color: "#64748B",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    wordBreak: "break-word",
  },
  statusStack: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    minWidth: 0,
    maxWidth: "100%",
  },
  statusPill: {
    padding: "7px 10px",
    borderRadius: 999,
    background: "#ECFDF5",
    color: "#047857",
    fontSize: 11,
    fontWeight: 900,
  },
  releasePill: {
    padding: "7px 10px",
    borderRadius: 999,
    background: "#EFF6FF",
    color: "#1D4ED8",
    fontSize: 11,
    fontWeight: 900,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: 10,
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
  },
  infoCard: {
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: 16,
    padding: 14,
    display: "grid",
    gap: 5,
    minWidth: 0,
  },
  infoCardSuccess: {
    borderColor: "#86EFAC",
    background: "#F0FDF4",
  },
  infoLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  infoValue: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: 900,
  },
  reconGood: {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: 14,
    borderRadius: 16,
    border: "1px solid #86EFAC",
    background: "#F0FDF4",
    color: "#166534",
    fontSize: 13,
  },
  reconWarn: {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: 14,
    borderRadius: 16,
    border: "1px solid #FCD34D",
    background: "#FFFBEB",
    color: "#92400E",
    fontSize: 13,
  },
  notice: {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: 12,
    borderRadius: 14,
    background: "#EFF6FF",
    border: "1px solid #BFDBFE",
    color: "#1D4ED8",
    fontWeight: 800,
    fontSize: 13,
  },
  tabRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
  },
  tabButton: {
    border: "1px solid #CBD5E1",
    borderRadius: 999,
    background: "#FFFFFF",
    color: "#475569",
    padding: "9px 13px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },
  tabButtonActive: {
    borderColor: "#2563EB",
    background: "#EFF6FF",
    color: "#1D4ED8",
  },
  tablePanel: {
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: 22,
    padding: 18,
    boxShadow: "0 10px 25px rgba(15, 23, 42, 0.05)",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    boxSizing: "border-box",
  },
  tableHeaderRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    marginBottom: 12,
  },
  tableHeaderText: {
    flex: "1 1 260px",
    minWidth: 0,
    maxWidth: "100%",
  },
  tableActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flex: "0 1 auto",
    flexWrap: "wrap",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
  },
  panelTitle: {
    margin: 0,
    color: "#0F172A",
    fontSize: 18,
  },
  mutedText: {
    margin: "6px 0 0",
    color: "#64748B",
    fontSize: 13,
    lineHeight: 1.45,
  },
  clearButton: {
    border: "1px solid #CBD5E1",
    borderRadius: 999,
    background: "#FFFFFF",
    color: "#0F172A",
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 900,
    cursor: "pointer",
  },
  tableWrap: {
    display: "block",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "auto",
    overflowY: "hidden",
    WebkitOverflowScrolling: "touch",
    border: "1px solid #E2E8F0",
    borderRadius: 16,
    boxSizing: "border-box",
  },
  table: {
    width: "100%",
    minWidth: 1180,
    tableLayout: "fixed",
    borderCollapse: "collapse",
  },
  trnTable: {
    minWidth: 1450,
  },
  th: {
    padding: 10,
    background: "#F8FAFC",
    color: "#334155",
    textAlign: "left",
    borderBottom: "1px solid #E2E8F0",
    fontSize: 11,
    fontWeight: 900,
    verticalAlign: "top",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  thLabel: {
    marginBottom: 6,
    textTransform: "uppercase",
  },
  columnFilterInput: {
    width: "100%",
    border: "1px solid #CBD5E1",
    borderRadius: 8,
    background: "#FFFFFF",
    color: "#0F172A",
    padding: "6px 7px",
    fontSize: 11,
    fontWeight: 700,
    boxSizing: "border-box",
  },
  filterHint: {
    display: "block",
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: 800,
    paddingTop: 7,
  },
  td: {
    padding: 10,
    borderBottom: "1px solid #E2E8F0",
    color: "#334155",
    fontSize: 12,
    verticalAlign: "top",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  tdStrong: {
    padding: 10,
    borderBottom: "1px solid #E2E8F0",
    color: "#0F172A",
    fontSize: 12,
    fontWeight: 900,
    verticalAlign: "top",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  subText: {
    display: "block",
    marginTop: 4,
    color: "#94A3B8",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 10,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  inlineLink: {
    color: "#1D4ED8",
    textDecoration: "none",
    fontWeight: 900,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  emptyPanel: {
    padding: 20,
    borderRadius: 16,
    background: "#F8FAFC",
    border: "1px dashed #CBD5E1",
  },
  emptyTitle: {
    margin: "8px 0 0",
    color: "#0F172A",
    fontSize: 17,
  },
};
