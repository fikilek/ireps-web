/* eslint-disable no-unused-vars -- JSX tags are consumed by React; this ESLint profile does not track them. */
import { irepsTableDateRange as getReadingDateFilterRange } from "../../components/table/irepsTableModel.js";
import IrepsTable from "../../components/table/IrepsTable";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { doc, getDoc, getFirestore } from "firebase/firestore";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryMreadByWardQuery } from "../../redux/registryMreadApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import { useGenerateMreadStagingMutation,
  useListMreadStagingCyclesQuery,
} from "../../redux/mreadStagingCyclesApi";

import RegistryIdText from "../../components/RegistryIdText";
import SharedMeterHistoryModal from "../../components/mread/MeterHistoryModal";
import { formatSastDateTime as formatDateTime } from "../../utils/formatSastDateTime.js";

const EMPTY_MREAD_FILTERS = {
  meterNo: "",
  outcome: "ALL",
  mediaStatus: "ALL",
  sincePreviousReading: "",
  reason: "",
  currentReading: "",
  previousReading: "",
  consumption: "",
  meterType: "ALL",
  meterKind: "",
  meterPhase: "",
  erfNo: "",
  premiseAddress: "",
  wardNo: "",
  geofence: "ALL",
  capturedBy: "",
  billingReadiness: "ALL",
  reviewStatus: "ALL",
};

const EMPTY_READING_DATE_FILTER = {
  mode: "ALL",
  startDate: "",
  endDate: "",
};

const DEFAULT_SORT = { key: "completedAt", direction: "desc" };

const NO_GEOFENCE_FILTER = "NO_GEOFENCE";
const NAv = "NAv";

function safeText(value, fallback = NAv) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function isMeaningfulText(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;

  const cleanText = text.toLowerCase();
  return !["nav", "n/av", "n/a", "na", "null", "undefined"].includes(cleanText);
}

function firstMeaningfulText(...values) {
  for (const value of values) {
    if (isMeaningfulText(value)) return String(value).trim();
  }
  return NAv;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function includesText(value, filterValue) {
  const filterText = normalizeText(filterValue);
  if (!filterText) return true;
  return normalizeText(value).includes(filterText);
}

function firstValue(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function firstMeaningfulValue(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (isMeaningfulText(value)) return value;
  }
  return null;
}

function firstText(...values) {
  const value = firstValue(...values);
  return safeText(value);
}

function formatNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : "0";
}

function formatReading(value) {
  if (value === 0 || value === "0") return "0";
  if (value === null || value === undefined || value === "") return NAv;
  return String(value);
}

function getDateValue(value) {
  if (!value || value === NAv) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateTimeMs(value) {
  const date = getDateValue(value);
  return date ? date.getTime() : 0;
}

function matchesReadingDateFilter(value, filter = EMPTY_READING_DATE_FILTER) {
  if (!filter || filter.mode === "ALL") return true;

  const rowDate = getDateValue(value);
  if (!rowDate) return false;

  const { start, end } = getReadingDateFilterRange(filter);
  if (start && rowDate < start) return false;
  if (end && rowDate > end) return false;
  return true;
}

function getActiveLmPcode(activeWorkbase) {
  return (
    activeWorkbase?.lmPcode ||
    activeWorkbase?.pcode ||
    activeWorkbase?.id ||
    activeWorkbase?.localMunicipalityId ||
    null
  );
}

function getWardNumberFromPcode(wardPcode = "") {
  const match = String(wardPcode || "").match(/(\d{1,3})$/);
  const numberValue = Number(match?.[1] || 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function getSelectedWardPcodeFromGeo(geoState) {
  const selectedWard = geoState?.selectedWard || null;
  return (
    selectedWard?.id || selectedWard?.pcode || selectedWard?.wardPcode || ""
  );
}

function buildRegistryWardSelection(ward, fallbackWardPcode = "") {
  const wardPcode =
    ward?.wardPcode || ward?.pcode || ward?.id || fallbackWardPcode || "";
  if (!wardPcode) return null;

  const wardNumber =
    ward?.wardNumber || ward?.code || getWardNumberFromPcode(wardPcode) || NAv;

  return {
    ...(ward || {}),
    id: wardPcode,
    pcode: wardPcode,
    wardPcode,
    code: wardNumber,
    wardNumber,
    name: ward?.wardName || ward?.name || `Ward ${wardNumber}`,
  };
}

function getWardLabel(ward) {
  if (!ward) return NAv;
  return `Ward ${ward.wardNumber}`;
}

function getMeterNo(row = {}) {
  return firstText(row.meterNo, row?.meter?.astNo, row.astNo);
}

function getAstId(row = {}) {
  return firstText(row.astId, row?.meter?.astId, row.sourceAstId);
}

function getCompletedAt(row = {}) {
  return firstValue(row.completedAt, row?.source?.completedAt);
}

function getReadingAt(row = {}) {
  const outcome = getOutcome(row);
  const readingAt = firstMeaningfulValue(
    row.readingAt,
    row?.reading?.readingAt,
  );

  if (outcome === "SUCCESSFUL_READING") {
    return firstMeaningfulValue(readingAt, getCompletedAt(row));
  }

  return null;
}

function getOutcome(row = {}) {
  return firstText(row?.outcome?.outcome, row.outcome);
}

function getOutcomeLabel(outcome) {
  if (outcome === "SUCCESSFUL_READING") return "Successful Reading";
  if (outcome === "UNSUCCESSFUL_READING") return "Unsuccessful Reading";
  if (outcome === "NO_ACCESS") return "No Access";
  return outcome || NAv;
}

function getOutcomeTone(outcome) {
  if (outcome === "SUCCESSFUL_READING") return "success";
  if (outcome === "UNSUCCESSFUL_READING") return "warning";
  if (outcome === "NO_ACCESS") return "danger";
  return "default";
}

function getReasonText(row = {}) {
  const outcome = getOutcome(row);

  if (outcome === "NO_ACCESS") {
    return firstMeaningfulText(
      row.noAccessReason,
      row.reasonText,
      row.outcomeReasonText,
      row?.outcome?.noAccessReason,
      row?.outcome?.reasonText,
      row?.raw?.outcome?.noAccessReason,
      row?.raw?.outcome?.reasonText,
    );
  }

  if (outcome === "UNSUCCESSFUL_READING") {
    return firstMeaningfulText(
      row.unsuccessfulReason,
      row.reasonText,
      row.outcomeReasonText,
      row?.outcome?.unsuccessfulReason,
      row?.outcome?.reasonText,
      row?.raw?.outcome?.unsuccessfulReason,
      row?.raw?.outcome?.reasonText,
    );
  }

  return NAv;
}

function getCurrentReading(row = {}) {
  return firstValue(row.currentReading, row?.reading?.currentReading);
}

function getPreviousReading(row = {}) {
  return firstValue(row.previousReading, row?.reading?.previousReading);
}

function getConsumption(row = {}) {
  return firstValue(row.consumption, row?.reading?.consumption);
}

function getSincePreviousReading(row = {}) {
  if (getOutcome(row) !== "SUCCESSFUL_READING") return null;

  return firstValue(
    row.sincePreviousReading,
    row.daysSinceLastReading,
    row?.reading?.sincePreviousReading,
    row?.reading?.daysSinceLastReading,
    row?.raw?.reading?.sincePreviousReading,
    row?.raw?.reading?.daysSinceLastReading,
    row["reading.sincePreviousReading"],
    row["reading.daysSinceLastReading"],
  );
}

function getSincePreviousReadingDisplay(row = {}) {
  if (getOutcome(row) !== "SUCCESSFUL_READING") return NAv;

  const display = firstValue(
    row.sincePreviousReadingDisplay,
    row.daysSinceLastReadingDisplay,
    row?.sincePreviousReading?.display,
    row?.daysSinceLastReading?.display,
    row?.reading?.sincePreviousReading?.display,
    row?.reading?.daysSinceLastReading?.display,
    row?.raw?.reading?.sincePreviousReading?.display,
    row?.raw?.reading?.daysSinceLastReading?.display,
    row["reading.sincePreviousReading.display"],
    row["reading.daysSinceLastReading.display"],
  );

  if (display) return safeText(display);

  const value = getSincePreviousReading(row);
  if (!value) return NAv;
  if (typeof value === "string") return safeText(value);
  if (typeof value === "object") return safeText(value.display);

  return safeText(value);
}

function getSincePreviousReadingMinutes(row = {}) {
  if (getOutcome(row) !== "SUCCESSFUL_READING") return 0;

  const minutes = Number(
    firstValue(
      row.sincePreviousReadingMinutes,
      row.daysSinceLastReadingMinutes,
      row?.sincePreviousReading?.totalMinutes,
      row?.daysSinceLastReading?.totalMinutes,
      row?.reading?.sincePreviousReading?.totalMinutes,
      row?.reading?.daysSinceLastReading?.totalMinutes,
      row?.raw?.reading?.sincePreviousReading?.totalMinutes,
      row?.raw?.reading?.daysSinceLastReading?.totalMinutes,
    ),
  );

  return Number.isFinite(minutes) ? minutes : 0;
}

function getMeterType(row = {}) {
  return firstText(row.meterType, row?.meter?.meterType);
}

function getMeterTypeLabel(value) {
  const text = safeText(value, "").toLowerCase();
  if (text === "electricity") return "Electricity";
  if (text === "water") return "Water";
  return value || NAv;
}

function getMeterKind(row = {}) {
  return firstText(
    row.meterKind,
    row?.meter?.meterKind,
    row?.raw?.meter?.meterKind,
  );
}

function getMeterPhase(row = {}) {
  return firstText(
    row.meterPhase,
    row?.meter?.meterPhase,
    row?.meter?.phase,
    row?.raw?.meter?.meterPhase,
    row?.raw?.meter?.phase,
  );
}

function formatMeterAttribute(value) {
  const text = safeText(value);
  if (text === NAv) return NAv;

  return text
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getErfNo(row = {}) {
  return firstText(row.erfNo, row?.premise?.erfNo);
}

function getErfId(row = {}) {
  return firstText(row.erfId, row?.premise?.erfId);
}

function getPremiseAddress(row = {}) {
  return firstText(row.premiseAddress, row?.premise?.address);
}

function getPremiseId(row = {}) {
  return firstText(row.premiseId, row?.premise?.premiseId);
}

function getPropertyType(row = {}) {
  return firstText(row.propertyType, row?.premise?.propertyType);
}

function getWardNo(row = {}) {
  const wardNo = firstValue(row.wardNo, row?.geography?.wardNo);
  if (wardNo !== null && wardNo !== undefined && wardNo !== NAv)
    return String(wardNo);

  const wardPcode = firstText(row.wardPcode, row?.geography?.wardPcode, "");
  return getWardNumberFromPcode(wardPcode) || NAv;
}

function getWardPcode(row = {}) {
  return firstText(row.wardPcode, row?.geography?.wardPcode);
}

function getAstGeofenceFromCache(row = {}, astGeofenceByAstId = {}) {
  const astId = getAstDocIdFromRow(row);
  return astId ? astGeofenceByAstId[astId] || {} : {};
}

function getGeofenceName(row = {}, astGeofenceByAstId = {}) {
  const astGeofence = getAstGeofenceFromCache(row, astGeofenceByAstId);

  return firstMeaningfulText(
    row.geofenceName,
    row?.geography?.geofenceName,
    row?.raw?.geography?.geofenceName,
    astGeofence.name,
    astGeofence.geofenceName,
    astGeofence.id,
    astGeofence.geofenceId,
  );
}

function getGeofenceId(row = {}, astGeofenceByAstId = {}) {
  const astGeofence = getAstGeofenceFromCache(row, astGeofenceByAstId);

  return firstMeaningfulText(
    row.geofenceId,
    row?.geography?.geofenceId,
    row?.raw?.geography?.geofenceId,
    astGeofence.id,
    astGeofence.geofenceId,
  );
}

function getGeofenceFilterValue(row = {}, astGeofenceByAstId = {}) {
  const geofenceName = getGeofenceName(row, astGeofenceByAstId);
  const geofenceId = getGeofenceId(row, astGeofenceByAstId);
  const label = firstMeaningfulText(geofenceName, geofenceId);

  return label === NAv ? NO_GEOFENCE_FILTER : label;
}

function getGeofenceFilterLabel(value = "") {
  return value === NO_GEOFENCE_FILTER ? "No Geofence" : safeText(value);
}

function getFirstGeofenceRef(refs = []) {
  if (!Array.isArray(refs)) return null;

  return (
    refs.find(
      (ref) => isMeaningfulText(ref?.id) || isMeaningfulText(ref?.name),
    ) || null
  );
}

function readAstGeofence(astDoc = {}) {
  const firstRef =
    getFirstGeofenceRef(astDoc?.geofenceRefs) ||
    getFirstGeofenceRef(astDoc?.ast?.geofenceRefs) ||
    astDoc?.geofence ||
    astDoc?.geofenceRef ||
    {};

  return {
    id: firstMeaningfulText(firstRef?.id, firstRef?.geofenceId),
    name: firstMeaningfulText(firstRef?.name, firstRef?.geofenceName),
  };
}

function getCapturedByName(row = {}) {
  return firstText(row.capturedByName, row?.actor?.capturedByName);
}

function getCapturedByRole(row = {}) {
  return firstText(row.capturedByRole, row?.actor?.capturedByRole);
}

function getCapturedByUid(row = {}) {
  return firstText(row.capturedByUid, row?.actor?.capturedByUid);
}

function getTeamName(row = {}) {
  return firstText(row.teamName, row?.actor?.teamName);
}

function getSpName(row = {}) {
  return firstText(row.spName, row?.actor?.spName);
}

function getEvidence(row = {}) {
  const evidence = row.evidence || {};
  const mediaTags = firstValue(row.mediaTags, evidence.mediaTags, []);
  const safeTags = Array.isArray(mediaTags) ? mediaTags : [];

  return {
    hasPhoto: firstValue(row.hasPhoto, evidence.hasPhoto) === true,
    photoCount: Number(firstValue(row.photoCount, evidence.photoCount, 0)) || 0,
    mediaTags: safeTags,
    notes: firstText(row.notes, evidence.notes),
  };
}

function getMediaCandidates(row = {}) {
  const candidates = [];
  const evidence = row.evidence || {};

  const addCandidate = (candidate) => {
    if (!candidate) return;

    if (typeof candidate === "string") {
      candidates.push({ url: candidate, tag: "meterReadingEvidence" });
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(addCandidate);
      return;
    }

    if (typeof candidate === "object") {
      const url =
        candidate.url ||
        candidate.uri ||
        candidate.href ||
        candidate.link ||
        candidate.mediaUrl ||
        candidate.imageUrl ||
        candidate.downloadUrl ||
        candidate.storageUrl;
      if (!url) return;
      candidates.push({
        ...candidate,
        url,
        tag: candidate.tag || candidate.type || "meterReadingEvidence",
      });
    }
  };

  addCandidate(row.mediaRefs);
  addCandidate(row.evidenceMediaRefs);
  addCandidate(row?.raw?.evidence?.mediaRefs);
  addCandidate(row?.raw?.mediaRefs);
  addCandidate(evidence.mediaRefs);
  addCandidate(evidence.photoRefs);
  addCandidate(evidence.photos);
  addCandidate(row.successfulReadingMediaUrl);
  addCandidate(row.successfulReadingMediaLink);
  addCandidate(row.successfulReadingMediaLinks);
  addCandidate(row.successfulReadingMedia);
  addCandidate(evidence.successfulReadingMediaUrl);
  addCandidate(evidence.successfulReadingMediaLink);
  addCandidate(evidence.successfulReadingMediaLinks);
  addCandidate(evidence.mediaLinks?.successfulReading);
  addCandidate(evidence.mediaLinks?.meterReadingEvidence);
  addCandidate(evidence.meterReadingEvidenceUrl);
  addCandidate(evidence.meterReadingMediaUrl);
  addCandidate(evidence.media);
  addCandidate(row.media);

  return candidates;
}

function getSuccessfulReadingMediaLinks(row = {}) {
  if (getOutcome(row) !== "SUCCESSFUL_READING") return [];

  // Detail modal and Media modal must use the same resolved photo list.
  // This preserves the "Successful Reading Media" section while avoiding
  // the earlier duplicate-link problem where the same Storage URL appeared
  // from multiple flattened/raw source paths.
  return getEvidencePhotoLinks(row);
}

function getEvidencePhotoLinks(row = {}) {
  const seenUrls = new Set();

  return getMediaCandidates(row).filter((item) => {
    if (!item?.url || seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });
}

function getBillingReadiness(row = {}) {
  return firstText(row.billingReadiness, row?.billingReadiness?.status);
}

function getBillingReadinessLabel(value) {
  if (value === "BILLING_READY_CANDIDATE") return "Billing Ready";
  if (value === "BILLING_REVIEW_REQUIRED") return "Billing Review";
  if (value === "NOT_BILLING_READY") return "Not Billing Ready";
  return value || NAv;
}

function getBillingTone(value) {
  if (value === "BILLING_READY_CANDIDATE") return "success";
  if (value === "BILLING_REVIEW_REQUIRED") return "warning";
  if (value === "NOT_BILLING_READY") return "default";
  return "default";
}

function getReviewStatus(row = {}) {
  return firstText(row.reviewStatus, row?.review?.status);
}

function getReviewActionType(row = {}) {
  return firstText(row.actionType, row?.review?.actionType);
}

function getReviewTone(value) {
  if (value === "REVIEW_REQUIRED") return "warning";
  return "default";
}

function getDataQualityStatus(row = {}) {
  const requiresFix =
    firstValue(row.requiresDataFix, row?.dataQuality?.requiresDataFix) === true;
  const warnings = firstValue(row.warnings, row?.dataQuality?.warnings, []);
  if (requiresFix) return "NEEDS_FIX";
  if (Array.isArray(warnings) && warnings.length > 0) return "WARNINGS";
  return "OK";
}

function getDataQualityLabel(value) {
  if (value === "NEEDS_FIX") return "Needs Fix";
  if (value === "WARNINGS") return "Warnings";
  return "OK";
}

function getTrnId(row = {}) {
  return firstText(row.trnId, row?.source?.trnId, row.id);
}

function getTrnPath(row = {}) {
  return firstText(row.trnPath, row?.source?.trnPath);
}

function getWorkflowState(row = {}) {
  return firstText(row.workflowState, row?.source?.workflowState);
}

function getSourceSystem(row = {}) {
  return firstText(row.sourceSystem, row?.source?.sourceSystem);
}

function getUpdatedAt(row = {}) {
  return firstValue(row.updatedAt, row?.metadata?.updatedAt);
}

function getUpdatedByUser(row = {}) {
  return firstText(row.updatedByUser, row?.metadata?.updatedByUser);
}

function getCycleLabel(row = {}) {
  return firstMeaningfulText(
    row.cycleLabel,
    row.cycle,
    row.cycleNoText,
    row.cycleId,
  );
}

function getCycleWindowDisplay(row = {}) {
  return firstMeaningfulText(
    row?.window?.display,
    row.window,
    [row?.window?.startDate, row?.window?.endDate].filter(Boolean).join(" - "),
  );
}

function getCycleIteration(row = {}) {
  const iteration = Number(firstValue(row.currentIteration, row.iteration, 0));
  return Number.isFinite(iteration) ? iteration : 0;
}

function getCycleRowsCount(row = {}) {
  const rows = Number(
    firstValue(row?.summary?.totalRows, row.rows, row.rowCount, 0),
  );
  return Number.isFinite(rows) ? rows : 0;
}

function getCycleLastGeneratedAt(row = {}) {
  return firstValue(
    row?.lastGenerated?.generatedAt,
    row?.lastGenerated?.at,
    row?.generation?.generatedAt,
  );
}

function getCycleAvailability(row = {}) {
  return row?.isFuture === true ? "FUTURE" : "AVAILABLE";
}

function getBaseCycleLabel(row = {}) {
  return firstMeaningfulText(
    row?.baseCycle?.cycleLabel,
    row?.baseCycle?.cycleId,
    "NAv",
  );
}

function getCycleAction(row = {}) {
  return row?.isFuture === true ? "DISABLED" : "STAGING";
}

function getCycleActionLabel(row = {}) {
  const action = getCycleAction(row);
  if (action === "STAGING") return "Staging";
  return "Unavailable";
}

function getCycleActionTone(row = {}) {
  const action = getCycleAction(row);
  if (action === "STAGING") return "primary";
  return "disabled";
}

function cycleMatchesFilter(
  row = {},
  { search = "", billingPeriod = "ALL" } = {},
) {
  const rowBillingPeriod = firstMeaningfulText(row.billingPeriod, "");

  if (billingPeriod !== "ALL" && rowBillingPeriod !== billingPeriod) {
    return false;
  }

  const term = normalizeText(search);
  if (!term) return true;

  const haystack = [
    row.cycleId,
    getCycleLabel(row),
    row.billingPeriod,
    getCycleAvailability(row),
    getCycleWindowDisplay(row),
    getBaseCycleLabel(row),
    row.activeStagingId,
  ]
    .map((value) => normalizeText(value))
    .join(" ");

  return haystack.includes(term);
}

function getCycleActionHelp(row = {}) {
  if (row?.isFuture === true) {
    return "This configured cycle starts after today, so it is hidden from normal staging generation.";
  }

  return "Generate a preserved mread_staging snapshot for this selected cycle. The base cycle is the immediately previous configured cycle.";
}

function getMissingFields(row = {}) {
  const value = firstValue(
    row.missingFields,
    row?.dataQuality?.missingFields,
    [],
  );
  return Array.isArray(value) ? value : [];
}

function getWarnings(row = {}) {
  const value = firstValue(row.warnings, row?.dataQuality?.warnings, []);
  return Array.isArray(value) ? value : [];
}

function compareNatural(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getSortValue(row, key, astGeofenceByAstId = {}) {
  if (key === "completedAt") return getDateTimeMs(getCompletedAt(row));
  if (key === "readingAt") return getDateTimeMs(getReadingAt(row));
  if (key === "sincePreviousReading")
    return getSincePreviousReadingMinutes(row);
  if (key === "meterNo") return getMeterNo(row);
  if (key === "outcome") return getOutcomeLabel(getOutcome(row));
  if (key === "media")
    return getEvidence(row).photoCount || getEvidencePhotoLinks(row).length;
  if (key === "reason") return getReasonText(row);
  if (key === "currentReading") return Number(getCurrentReading(row) || 0);
  if (key === "previousReading") return Number(getPreviousReading(row) || 0);
  if (key === "consumption") return Number(getConsumption(row) || 0);
  if (key === "meterType") return getMeterTypeLabel(getMeterType(row));
  if (key === "meterKind") return formatMeterAttribute(getMeterKind(row));
  if (key === "meterPhase") return formatMeterAttribute(getMeterPhase(row));
  if (key === "erfNo") return getErfNo(row);
  if (key === "premiseAddress") return getPremiseAddress(row);
  if (key === "wardNo") return Number(getWardNo(row) || 0);
  if (key === "geofence") return getGeofenceName(row, astGeofenceByAstId);
  if (key === "capturedBy") return getCapturedByName(row);
  if (key === "evidence") return getEvidence(row).photoCount;
  if (key === "billingReadiness")
    return getBillingReadinessLabel(getBillingReadiness(row));
  if (key === "reviewStatus") return getReviewStatus(row);
  if (key === "dataQuality") return getDataQualityStatus(row);
  return "";
}

function StatusPill({ children, tone = "default" }) {
  return (
    <span style={{ ...styles.statusPill, ...(styles[`${tone}Pill`] || {}) }}>
      {children}
    </span>
  );
}

function LoadingSpinner({
  title = "Loading MREAD registry...",
  message = "Opening Firestore stream.",
} = {}) {
  return (
    <div style={styles.loadingBlock} role="status" aria-live="polite">
      <span style={styles.spinner} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p className="muted">{message}</p>
      </div>
    </div>
  );
}

function isRegistryIdentifierLabel(label = "") {
  const cleanLabel = String(label || "").toLowerCase();
  return (
    cleanLabel.includes(" id") ||
    cleanLabel.endsWith("id") ||
    cleanLabel.includes("uid") ||
    cleanLabel.includes("path") ||
    cleanLabel.includes("pcode")
  );
}

function CompactDetailLine({ label, value }) {
  const displayValue =
    value === null || value === undefined || value === "" ? NAv : String(value);
  const isIdentifier = isRegistryIdentifierLabel(label);

  return (
    <div style={styles.detailLine}>
      <span className="muted">{label}</span>
      {isIdentifier ? (
        <RegistryIdText value={displayValue} />
      ) : (
        <strong>{displayValue}</strong>
      )}
    </div>
  );
}

function MediaLinksList({ links = [] }) {
  const uniqueLinks = [];
  const seenUrls = new Set();

  links.forEach((item) => {
    const url = item?.url;
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    uniqueLinks.push(item);
  });

  if (!uniqueLinks.length) return <span className="muted">No media link</span>;

  return (
    <div style={styles.mediaLinkList}>
      {uniqueLinks.map((item, index) => (
        <a
          key={item.url}
          className="text-link"
          href={item.url}
          target="_blank"
          rel="noreferrer"
        >
          {uniqueLinks.length === 1 ? "View Photo" : `View Media ${index + 1}`}
        </a>
      ))}
    </div>
  );
}

function getAstDocIdFromRow(row = {}) {
  const astId = getAstId(row);
  if (astId === NAv) return "";
  const astPath = String(astId).trim();
  return astPath.startsWith("asts/") ? astPath.split("/").pop() : astPath;
}

function MreadStagingControllerModal({ lmPcode, onClose }) {
  const safeLmPcode = isMeaningfulText(lmPcode)
    ? String(lmPcode).trim()
    : "ZA2157";
  const [generateMreadStaging, { isLoading: isGenerating }] =
    useGenerateMreadStagingMutation();
  const [billingPeriod, setBillingPeriod] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [phaseNotice, setPhaseNotice] = useState("");

  const queryArgs = useMemo(
    () => ({
      lmPcode: safeLmPcode,
      billingPeriod: null,
      includeFuture: false,
      limit: 200,
    }),
    [safeLmPcode],
  );

  const {
    data,
    error: queryError,
    isFetching,
    refetch,
  } = useListMreadStagingCyclesQuery(queryArgs);

  const cycleRows = useMemo(
    () => (Array.isArray(data?.rows) ? data.rows : []),
    [data],
  );

  const summary = data?.summary || null;

  const effectiveSelectedCycle = useMemo(() => {
    if (!cycleRows.length) return null;

    if (selectedCycle) {
      return (
        cycleRows.find((row) => row.cycleId === selectedCycle.cycleId) ||
        cycleRows[0]
      );
    }

    return cycleRows[0];
  }, [cycleRows, selectedCycle]);

  const billingPeriodOptions = useMemo(() => {
    const periods = Array.from(
      new Set(cycleRows.map((row) => row.billingPeriod).filter(Boolean)),
    ).sort();

    return ["ALL", ...periods];
  }, [cycleRows]);

  const filteredCycleRows = useMemo(
    () =>
      cycleRows.filter((row) =>
        cycleMatchesFilter(row, { billingPeriod, search }),
      ),
    [cycleRows, billingPeriod, search],
  );

  const currentCycle = useMemo(
    () => cycleRows.find((row) => row.isCurrentCycle === true) || null,
    [cycleRows],
  );

  const errorMessage =
    queryError?.message || queryError?.data?.message || queryError?.error || "";

  async function handleCycleAction(row) {
    const action = getCycleAction(row);
    setSelectedCycle(row);

    if (action !== "STAGING") {
      setPhaseNotice(getCycleActionHelp(row));
      return;
    }

    const cycleId = row?.cycleId || row?.id;

    if (!cycleId) {
      setPhaseNotice(
        "Cannot generate staging because this cycle row has no cycleId.",
      );
      return;
    }

    setPhaseNotice(
      `Generating staging for selected cycle ${getCycleLabel(row)}. Base cycle: ${getBaseCycleLabel(row)}.`,
    );

    try {
      const result = await generateMreadStaging({ cycleId }).unwrap();
      const stagingId =
        result?.stagingId || result?.activeStagingId || result?.tableId || NAv;
      const totalRows = firstValue(
        result?.summary?.totalRows,
        result?.rowsWritten,
        result?.totalRows,
        0,
      );
      const iteration = firstValue(
        result?.iteration,
        result?.currentIteration,
        result?.generation?.iteration,
        row?.currentIteration,
      );

      setPhaseNotice(
        `Generated staging for ${getCycleLabel(row)} successfully. Staging ID: ${stagingId}. Rows: ${formatNumber(totalRows)}. Iteration: ${formatNumber(iteration)}.`,
      );

      await refetch();
    } catch (error) {
      const message =
        error?.data?.message ||
        error?.message ||
        error?.error ||
        "Could not generate MREAD staging.";
      setPhaseNotice(`Staging failed for ${getCycleLabel(row)}: ${message}`);
    }
  }

  return (
    <div
      style={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mread-staging-controller-title"
    >
      <div style={styles.stagingControllerModalCard}>
        <div style={styles.modalHeader}>
          <div>
            <p className="eyebrow">MREAD Staging</p>
            <h2 id="mread-staging-controller-title">
              Generate MREAD Staging Snapshot
            </h2>
            <p className="muted">
              Select any available configured MREAD cycle. The selected cycle is
              processed as the staging cycle, and the immediately previous
              configured cycle is used as the base cycle.
            </p>
          </div>

          <button
            type="button"
            style={styles.modalCloseButton}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div style={styles.modalBody}>
          <section style={styles.stagingControllerNotice}>
            iREPS does not close, approve, or bill these cycles. This action
            creates a new preserved
            <strong> mread_staging</strong> parent document with its own{" "}
            <strong>rows</strong> subcollection every time it is clicked. Future
            configured cycles are hidden because they do not yet have useful
            field-reading data.
          </section>

          <section style={styles.stagingControllerSummaryGrid}>
            <div style={styles.stagingSummaryTile}>
              <span>Visible Cycles</span>
              <strong>
                {formatNumber(summary?.visibleRows ?? cycleRows.length)}
              </strong>
            </div>
            <div style={styles.stagingSummaryTile}>
              <span>Available</span>
              <strong>
                {formatNumber(summary?.available ?? cycleRows.length)}
              </strong>
            </div>
            <div style={styles.stagingSummaryTile}>
              <span>Hidden Future</span>
              <strong>{formatNumber(summary?.future ?? 0)}</strong>
            </div>
            <div style={styles.stagingSummaryTileWide}>
              <span>Current Cycle</span>
              <strong>
                {currentCycle ? getCycleLabel(currentCycle) : "NAv"}
              </strong>
              <small>
                {currentCycle
                  ? getCycleWindowDisplay(currentCycle)
                  : "No current configured cycle returned"}
              </small>
            </div>
          </section>

          <section style={styles.stagingControllerFilters}>
            <label style={styles.stagingFilterLabel}>
              LM
              <input value={safeLmPcode} readOnly style={styles.stagingInput} />
            </label>

            <label style={styles.stagingFilterLabel}>
              Billing Period
              <select
                value={billingPeriod}
                onChange={(event) => setBillingPeriod(event.target.value)}
                style={styles.stagingInput}
              >
                {billingPeriodOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.stagingFilterLabel}>
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={styles.stagingInput}
                placeholder="Cycle, window, base cycle..."
              />
            </label>

            <button
              type="button"
              style={styles.primaryButton}
              onClick={() => refetch()}
              disabled={isFetching || isGenerating}
            >
              {isFetching ? "Loading..." : "Refresh"}
            </button>
          </section>

          {errorMessage ? (
            <div style={styles.stagingErrorBox}>{errorMessage}</div>
          ) : null}

          {phaseNotice ? (
            <div style={styles.stagingPhaseNotice}>{phaseNotice}</div>
          ) : null}

          <div style={styles.stagingControllerGrid}>
            <section style={styles.stagingCyclesPanel}>
              <div style={styles.sectionHeaderRow}>
                <div>
                  <h3>Available Staging Cycles</h3>
                  <p className="muted">
                    Showing {formatNumber(filteredCycleRows.length)} of{" "}
                    {formatNumber(cycleRows.length)} available cycle rows,
                    sorted newest first.
                  </p>
                </div>
              </div>

              {isFetching && !cycleRows.length ? (
                <LoadingSpinner
                  title="Loading staging cycles..."
                  message="Reading the mread_staging_cycles configuration collection."
                />
              ) : null}

              {!isFetching && !filteredCycleRows.length ? (
                <div className="empty-state">
                  <h2>No staging cycles found</h2>
                  <p className="muted">
                    No configured cycles matched this LM and filter selection.
                  </p>
                </div>
              ) : null}

              {filteredCycleRows.length ? (
                <div style={styles.stagingTableWrap}>
                  <IrepsTable
                title="Reading cycles"
                rows={filteredCycleRows}
                columns={[{
                  key: "cycle",
                  label: "Cycle",
                  filter: "text",
                  value: row => getCycleLabel(row),
                  render: row => {
                    return <><button type="button" className="text-link" onClick={() => setSelectedCycle(row)} aria-pressed={effectiveSelectedCycle?.cycleId === row.cycleId}>
                                              <strong>{getCycleLabel(row)}</strong>
                                              <div style={styles.secondaryId}>
                                                <RegistryIdText value={row.cycleId} />
                                              </div>
                                              {row.isCurrentCycle ? <div style={styles.secondaryId}>
                                                  Current cycle
                                                </div> : null}
                                            </button></>;
                  }
                }, {
                  key: "window",
                  label: "Window",
                  filter: "text",
                  value: row => getCycleWindowDisplay(row),
                  render: row => {
                    return <>{getCycleWindowDisplay(row)}</>;
                  }
                }, {
                  key: "baseCycle",
                  label: "Base Cycle",
                  filter: "text",
                  value: row => getBaseCycleLabel(row),
                  render: row => {
                    return <>{getBaseCycleLabel(row)}</>;
                  }
                }, {
                  key: "iteration",
                  label: "Iteration",
                  filter: "text",
                  value: row => getCycleIteration(row),
                  render: row => {
                    return <>{formatNumber(getCycleIteration(row))}</>;
                  }
                }, {
                  key: "lastGenerated",
                  label: "Last Generated",
                  filter: "date",
                  value: row => getDateTimeMs(getCycleLastGeneratedAt(row)),
                  exportValue: row => formatDateTime(getCycleLastGeneratedAt(row)),
                  render: row => {
                    return <>
                                              {formatDateTime(getCycleLastGeneratedAt(row))}
                                            </>;
                  }
                }, {
                  key: "rows",
                  label: "Rows",
                  filter: "text",
                  value: row => getCycleRowsCount(row),
                  render: row => {
                    return <>{formatNumber(getCycleRowsCount(row))}</>;
                  }
                }, {
                  key: "staging",
                  label: "Staging",
                  filter: null,
                  value: row => getCycleActionLabel(row),
                  render: row => {
                    const actionTone = getCycleActionTone(row);
                    return <>
                                              <button type="button" style={actionTone === "primary" ? styles.primaryMiniButton : styles.disabledMiniButton} onClick={event => {
                        event.stopPropagation();
                        handleCycleAction(row);
                      }} disabled={actionTone === "disabled" || isGenerating} title={getCycleActionHelp(row)}>
                                                {isGenerating && actionTone === "primary" ? "Staging..." : getCycleActionLabel(row)}
                                              </button>
                                            </>;
                  }
                }]}
                rowKey={row => row.cycleId || getCycleLabel(row)}
                rowStyle={row => effectiveSelectedCycle?.cycleId === row.cycleId ? styles.selectedStagingCycleRow : undefined}
                onRowClick={setSelectedCycle}
                downloads={{
                  fileBaseName: "reading_cycles",
                  scope: {
                    label: "Loaded reading cycles"
                  }
                }}
              />
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function HelpModal({ onClose }) {
  return (
    <div
      style={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mread-help-title"
    >
      <div style={styles.modalCardLarge}>
        <div style={styles.modalHeader}>
          <div>
            <p className="eyebrow">MREAD Registry Help</p>
            <h2 id="mread-help-title">How to read this table</h2>
          </div>

          <button
            type="button"
            style={styles.modalCloseButton}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div style={styles.modalBody}>
          <div style={styles.helpGrid}>
            <section>
              <h3>What this registry shows</h3>
              <p className="muted">
                Each row is one completed meter-reading attempt projected from
                registry_mread. The TRN remains the source of truth.
              </p>
            </section>

            <section>
              <h3>Default order</h3>
              <p className="muted">
                Rows always load newest first by Completed At descending. The
                visible Completed At column is the TRN completion/submission
                timestamp for every outcome, including No Access. Days Since
                Last Reading is calculated by the backend and stored on the
                registry row.
              </p>
            </section>

            <section>
              <h3>Outcomes</h3>
              <p className="muted">
                Successful Reading means a usable reading was captured.
                Unsuccessful Reading means the meter was accessed or viewed but
                no usable reading was captured. No Access means no meter reading
                attempt happened at the meter.
              </p>
            </section>

            <section>
              <h3>Media</h3>
              <p className="muted">
                The Media column links to successful-reading evidence when the
                registry row exposes a media link. If no link exists, the
                backend registry row may still need the media-link field added.
              </p>
            </section>

            <section>
              <h3>Billing Readiness</h3>
              <p className="muted">
                Billing readiness is a preparation signal only. Final billing
                belongs to staging_mread_billing and registry_mread_billing.
              </p>
            </section>

            <section>
              <h3>View Details</h3>
              <p className="muted">
                Use View Details for audit fields such as TRN ID, AST ID,
                premise ID, media tags, source paths, and metadata.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaModal({ row, onClose }) {
  if (!row) return null;

  const evidence = getEvidence(row);
  const photoLinks = getEvidencePhotoLinks(row);

  return (
    <div
      style={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mread-media-title"
    >
      <div style={styles.modalCardLarge}>
        <div style={styles.modalHeader}>
          <div>
            <p className="eyebrow">MREAD Media</p>
            <h2 id="mread-media-title">{getMeterNo(row)}</h2>
            <p className="muted">
              {formatDateTime(getReadingAt(row))} ·{" "}
              {formatNumber(evidence.photoCount)} photo(s)
            </p>
          </div>

          <button
            type="button"
            style={styles.modalCloseButton}
            onClick={onClose}
          >
            Close Media
          </button>
        </div>

        <div style={styles.modalBody}>
          {photoLinks.length === 0 ? (
            <div className="empty-state">
              <h2>No media photo URL available</h2>
              <p className="muted">
                The row reports {formatNumber(evidence.photoCount)} photo(s),
                but this registry row does not expose a usable media URL yet.
                Rebuild registry_mread after the backend media patch so the
                photo URL is written into the registry row.
              </p>
            </div>
          ) : (
            <div style={styles.evidenceGrid}>
              {photoLinks.map((item, index) => (
                <article
                  key={`${item.url}-${index}`}
                  style={styles.evidenceCard}
                >
                  <a href={item.url} target="_blank" rel="noreferrer">
                    <img
                      src={item.url}
                      alt={item.tag || `Media ${index + 1}`}
                      style={styles.evidenceImage}
                    />
                  </a>
                  <div style={styles.evidenceMetaGrid}></div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RowDetailsModal({ row, onClose, astGeofenceByAstId = {} }) {
  if (!row) return null;

  const mediaLinks = getSuccessfulReadingMediaLinks(row);
  const evidence = getEvidence(row);
  const dataQualityStatus = getDataQualityStatus(row);

  return (
    <div
      style={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mread-row-title"
    >
      <div style={styles.modalCardLarge}>
        <div style={styles.modalHeader}>
          <div>
            <p className="eyebrow">Selected MREAD Row</p>
            <h2 id="mread-row-title">{getMeterNo(row)}</h2>
            <p className="muted">
              {formatDateTime(getReadingAt(row))} ·{" "}
              {getOutcomeLabel(getOutcome(row))}
            </p>
          </div>

          <button
            type="button"
            style={styles.modalCloseButton}
            onClick={onClose}
          >
            Close Details
          </button>
        </div>

        <div style={styles.modalBody}>
          <div style={styles.detailsTwoColumnGrid}>
            <div style={styles.detailsColumn}>
              <section style={styles.detailsSection}>
                <h3>Source</h3>
                <CompactDetailLine label="TRN ID" value={getTrnId(row)} />
                <CompactDetailLine label="TRN Path" value={getTrnPath(row)} />
                <CompactDetailLine
                  label="Workflow"
                  value={getWorkflowState(row)}
                />
                <CompactDetailLine
                  label="Completed At"
                  value={formatDateTime(getCompletedAt(row))}
                />
                <CompactDetailLine
                  label="Source System"
                  value={getSourceSystem(row)}
                />
              </section>

              <section style={styles.detailsSection}>
                <h3>Reading</h3>
                <CompactDetailLine
                  label="Reading Date"
                  value={formatDateTime(getReadingAt(row))}
                />
                <CompactDetailLine
                  label="Days Since Last Reading"
                  value={getSincePreviousReadingDisplay(row)}
                />
                <CompactDetailLine
                  label="Current"
                  value={formatReading(getCurrentReading(row))}
                />
                <CompactDetailLine
                  label="Previous"
                  value={formatReading(getPreviousReading(row))}
                />
                <CompactDetailLine
                  label="Consumption"
                  value={formatReading(getConsumption(row))}
                />
              </section>

              <section style={styles.detailsSection}>
                <h3>Premise</h3>
                <CompactDetailLine
                  label="Address"
                  value={getPremiseAddress(row)}
                />
                <CompactDetailLine
                  label="Premise ID"
                  value={getPremiseId(row)}
                />
                <CompactDetailLine
                  label="Property Type"
                  value={getPropertyType(row)}
                />
                <CompactDetailLine label="ERF No" value={getErfNo(row)} />
                <CompactDetailLine label="ERF ID" value={getErfId(row)} />
              </section>

              <section style={styles.detailsSection}>
                <h3>Geography</h3>
                <CompactDetailLine label="Ward" value={getWardNo(row)} />
                <CompactDetailLine
                  label="Ward Pcode"
                  value={getWardPcode(row)}
                />
                <CompactDetailLine
                  label="Geofence"
                  value={getGeofenceName(row, astGeofenceByAstId)}
                />
                <CompactDetailLine
                  label="Geofence ID"
                  value={getGeofenceId(row, astGeofenceByAstId)}
                />
              </section>

              <section style={styles.detailsSection}>
                <h3>Captured By</h3>
                <CompactDetailLine
                  label="Name"
                  value={getCapturedByName(row)}
                />
                <CompactDetailLine label="UID" value={getCapturedByUid(row)} />
                <CompactDetailLine
                  label="Role"
                  value={getCapturedByRole(row)}
                />
                <CompactDetailLine label="Team" value={getTeamName(row)} />
                <CompactDetailLine
                  label="Service Provider"
                  value={getSpName(row)}
                />
              </section>
            </div>

            <div style={styles.detailsColumn}>
              <section style={styles.detailsSection}>
                <h3>Outcome</h3>
                <CompactDetailLine
                  label="Outcome"
                  value={getOutcomeLabel(getOutcome(row))}
                />
                <CompactDetailLine label="Reason" value={getReasonText(row)} />
                <CompactDetailLine
                  label="Review"
                  value={getReviewStatus(row)}
                />
                <CompactDetailLine
                  label="Action Type"
                  value={getReviewActionType(row)}
                />
              </section>

              <section style={styles.detailsSection}>
                <h3>Meter</h3>
                <CompactDetailLine label="Meter No" value={getMeterNo(row)} />
                <CompactDetailLine label="AST ID" value={getAstId(row)} />
                <CompactDetailLine
                  label="Type"
                  value={getMeterTypeLabel(getMeterType(row))}
                />
                <CompactDetailLine
                  label="Status"
                  value={firstText(row.statusState, row?.meter?.statusState)}
                />
              </section>

              <section style={styles.detailsSection}>
                <h3>Evidence</h3>
                <CompactDetailLine
                  label="Has Photo"
                  value={evidence.hasPhoto ? "Yes" : "No"}
                />
                <CompactDetailLine
                  label="Photo Count"
                  value={formatNumber(evidence.photoCount)}
                />
                <CompactDetailLine
                  label="Media Tags"
                  value={evidence.mediaTags.join(", ") || NAv}
                />
                <CompactDetailLine label="Notes" value={evidence.notes} />
                <div style={styles.modalMediaBlock}>
                  <span className="muted">Successful Reading Media</span>
                  <MediaLinksList links={mediaLinks} />
                </div>
              </section>

              <section style={styles.detailsSection}>
                <h3>Billing / Review</h3>
                <CompactDetailLine
                  label="Billing"
                  value={getBillingReadinessLabel(getBillingReadiness(row))}
                />
                <CompactDetailLine
                  label="Billing Reason"
                  value={firstText(
                    row.billingReason,
                    row?.billingReadiness?.reasonText,
                  )}
                />
                <CompactDetailLine
                  label="Review Status"
                  value={getReviewStatus(row)}
                />
                <CompactDetailLine
                  label="Action Type"
                  value={getReviewActionType(row)}
                />
              </section>

              <section style={styles.detailsSection}>
                <h3>Data Quality</h3>
                <CompactDetailLine
                  label="Status"
                  value={getDataQualityLabel(dataQualityStatus)}
                />
                <CompactDetailLine
                  label="Missing Fields"
                  value={getMissingFields(row).join(", ") || "None"}
                />
                <CompactDetailLine
                  label="Warnings"
                  value={getWarnings(row).join(", ") || "None"}
                />
              </section>

              <section style={styles.detailsSection}>
                <h3>Metadata</h3>
                <CompactDetailLine
                  label="Updated By"
                  value={getUpdatedByUser(row)}
                />
                <CompactDetailLine
                  label="Updated At"
                  value={formatDateTime(getUpdatedAt(row))}
                />
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MreadRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);

  const [filters, setFilters] = useState(EMPTY_MREAD_FILTERS);

  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedMeterRow, setSelectedMeterRow] = useState(null);
  const [selectedMediaRow, setSelectedMediaRow] = useState(null);

  const [astGeofenceByAstId, setAstGeofenceByAstId] = useState({});
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isStagingControllerOpen, setIsStagingControllerOpen] = useState(false);

  const activeLmPcode = getActiveLmPcode(activeWorkbase);

  const activeWorkbaseName =
    activeWorkbase?.name ||
    activeWorkbase?.lmName ||
    activeWorkbase?.id ||
    activeWorkbase?.pcode ||
    NAv;

  const { data: wardRows = [], isLoading: wardsLoading } =
    useGetRegistryWardsByLmQuery(activeLmPcode || skipToken);

  const selectedWard = useMemo(() => {
    const registryWard =
      wardRows.find((ward) => ward.wardPcode === selectedWardPcode) || null;
    return buildRegistryWardSelection(registryWard, selectedWardPcode);
  }, [wardRows, selectedWardPcode]);

  const effectiveSelectedWardPcode = selectedWard?.wardPcode || "";

  const {
    data: mreadRows = [],
    isLoading,
    isFetching,
    error,
  } = useGetRegistryMreadByWardQuery(effectiveSelectedWardPcode || skipToken);

  const isRegistryOpening =
    Boolean(effectiveSelectedWardPcode) &&
    !error &&
    (isLoading || (isFetching && mreadRows.length === 0));

  useEffect(() => {
    let cancelled = false;

    const rowsNeedingAstGeofence = mreadRows.filter((row) => {
      if (getGeofenceName(row) !== NAv || getGeofenceId(row) !== NAv)
        return false;
      const astId = getAstDocIdFromRow(row);
      return astId && !astGeofenceByAstId[astId];
    });

    const astIds = Array.from(
      new Set(rowsNeedingAstGeofence.map((row) => getAstDocIdFromRow(row))),
    );

    if (astIds.length === 0) return undefined;

    async function loadAstGeofences() {
      const db = getFirestore();
      const geofenceEntries = await Promise.all(
        astIds.map(async (astId) => {
          try {
            const astSnap = await getDoc(doc(db, "asts", astId));
            if (!astSnap.exists()) return [astId, { id: NAv, name: NAv }];
            return [astId, readAstGeofence(astSnap.data())];
          } catch (_error) {
            return [astId, { id: NAv, name: NAv }];
          }
        }),
      );

      if (cancelled) return;

      setAstGeofenceByAstId((current) => ({
        ...current,
        ...Object.fromEntries(geofenceEntries),
      }));
    }

    loadAstGeofences();

    return () => {
      cancelled = true;
    };
  }, [mreadRows, astGeofenceByAstId]);

  const filterRegistryRows = useCallback((rows, tableFilters) => {
    const filters = {
      ...EMPTY_MREAD_FILTERS,
      ...tableFilters
    };
    for (const key of Object.keys(EMPTY_MREAD_FILTERS)) {
      if (EMPTY_MREAD_FILTERS[key] === "ALL" && !filters[key]) filters[key] = "ALL";
    }
    const readingDateFilter = tableFilters.completedAt || EMPTY_READING_DATE_FILTER;
    return rows.filter(row => {
      const outcome = getOutcome(row);
      const mediaLinks = getEvidencePhotoLinks(row);
      const evidence = getEvidence(row);
      const mediaStatus = mediaLinks.length > 0 || evidence.photoCount > 0 || evidence.hasPhoto ? "HAS_MEDIA" : "NO_MEDIA";
      const billingReadiness = getBillingReadiness(row);
      const completedAt = getCompletedAt(row);
      return includesText(getMeterNo(row), filters.meterNo) && (filters.outcome === "ALL" || outcome === filters.outcome) && (filters.mediaStatus === "ALL" || mediaStatus === filters.mediaStatus) && includesText(getSincePreviousReadingDisplay(row), filters.sincePreviousReading) && includesText(getReasonText(row), filters.reason) && includesText(formatReading(getCurrentReading(row)), filters.currentReading) && includesText(formatReading(getPreviousReading(row)), filters.previousReading) && includesText(formatReading(getConsumption(row)), filters.consumption) && (filters.meterType === "ALL" || normalizeText(getMeterType(row)) === normalizeText(filters.meterType)) && includesText(getMeterKind(row), filters.meterKind) && includesText(getMeterPhase(row), filters.meterPhase) && includesText(getErfNo(row), filters.erfNo) && includesText(`${getPremiseAddress(row)} ${getPremiseId(row)}`, filters.premiseAddress) && includesText(getWardNo(row), filters.wardNo) && (filters.geofence === "ALL" || getGeofenceFilterValue(row, astGeofenceByAstId) === filters.geofence) && includesText(`${getCapturedByName(row)} ${getCapturedByUid(row)}`, filters.capturedBy) && (filters.billingReadiness === "ALL" || billingReadiness === filters.billingReadiness) && (filters.reviewStatus === "ALL" || getReviewStatus(row) === filters.reviewStatus) && matchesReadingDateFilter(completedAt, readingDateFilter);
    });
  }, [astGeofenceByAstId]);

  const filteredMreadRows = useMemo(() => filterRegistryRows(mreadRows, filters), [mreadRows, filters, filterRegistryRows]);

  const geofenceOptions = useMemo(() => {
    const options = new Map();

    mreadRows.forEach((row) => {
      const value = getGeofenceFilterValue(row, astGeofenceByAstId);
      options.set(value, getGeofenceFilterLabel(value));
    });

    return Array.from(options.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => compareNatural(left.label, right.label));
  }, [mreadRows, astGeofenceByAstId]);

  const totals = filteredMreadRows.reduce(
    (accumulator, row) => {
      const outcome = getOutcome(row);
      const evidence = getEvidence(row);
      const reviewStatus = getReviewStatus(row);

      if (outcome === "SUCCESSFUL_READING") accumulator.successful += 1;
      if (outcome === "UNSUCCESSFUL_READING") accumulator.unsuccessful += 1;
      if (outcome === "NO_ACCESS") accumulator.noAccess += 1;
      if (getBillingReadiness(row) === "BILLING_READY_CANDIDATE")
        accumulator.billingReady += 1;
      if (reviewStatus === "REVIEW_REQUIRED") accumulator.reviewRequired += 1;
      if (evidence.hasPhoto) accumulator.withEvidence += 1;
      return accumulator;
    },
    {
      successful: 0,
      unsuccessful: 0,
      noAccess: 0,
      billingReady: 0,
      reviewRequired: 0,
      withEvidence: 0,
    },
  );

  const quickDownloadColumns = useMemo(
    () => [
      { header: "Meter No", value: (row) => getMeterNo(row) },
      {
        header: "Completed At",
        value: (row) => formatDateTime(getCompletedAt(row)),
      },
      {
        header: "Days Since Last Reading",
        value: (row) => getSincePreviousReadingDisplay(row),
      },
      { header: "Outcome", value: (row) => getOutcomeLabel(getOutcome(row)) },
      {
        header: "Successful Reading Media",
        value: (row) =>
          getSuccessfulReadingMediaLinks(row)
            .map((item) => item.url)
            .join(" | ") || NAv,
      },
      { header: "Reason", value: (row) => getReasonText(row) },
      {
        header: "Current Reading",
        value: (row) => formatReading(getCurrentReading(row)),
      },
      {
        header: "Prev Reading",
        value: (row) => formatReading(getPreviousReading(row)),
      },
      {
        header: "Consumption",
        value: (row) => formatReading(getConsumption(row)),
      },
      {
        header: "Meter Type",
        value: (row) => getMeterTypeLabel(getMeterType(row)),
      },
      {
        header: "Meter Kind",
        value: (row) => formatMeterAttribute(getMeterKind(row)),
      },
      {
        header: "Meter Phase",
        value: (row) => formatMeterAttribute(getMeterPhase(row)),
      },
      { header: "ERF No", value: (row) => getErfNo(row) },
      { header: "ERF ID", value: (row) => getErfId(row) },
      { header: "Premise Address", value: (row) => getPremiseAddress(row) },
      { header: "Premise ID", value: (row) => getPremiseId(row) },
      { header: "Property Type", value: (row) => getPropertyType(row) },
      { header: "Ward", value: (row) => getWardNo(row) },
      { header: "Ward Pcode", value: (row) => getWardPcode(row) },
      {
        header: "Geofence",
        value: (row) => getGeofenceName(row, astGeofenceByAstId),
      },
      {
        header: "Geofence ID",
        value: (row) => getGeofenceId(row, astGeofenceByAstId),
      },
      { header: "Captured By", value: (row) => getCapturedByName(row) },
      { header: "Captured By UID", value: (row) => getCapturedByUid(row) },
      { header: "Team", value: (row) => getTeamName(row) },
      { header: "Service Provider", value: (row) => getSpName(row) },
      {
        header: "Has Photo",
        value: (row) => (getEvidence(row).hasPhoto ? "Yes" : "No"),
      },
      { header: "Photo Count", value: (row) => getEvidence(row).photoCount },
      {
        header: "Media Tags",
        value: (row) => getEvidence(row).mediaTags.join(", ") || NAv,
      },
      {
        header: "Billing Readiness",
        value: (row) => getBillingReadinessLabel(getBillingReadiness(row)),
      },
      { header: "Review Status", value: (row) => getReviewStatus(row) },
      { header: "Action Type", value: (row) => getReviewActionType(row) },
      { header: "TRN ID", value: (row) => getTrnId(row) },
      { header: "TRN Path", value: (row) => getTrnPath(row) },
      { header: "Workflow State", value: (row) => getWorkflowState(row) },
      {
        header: "Completed At",
        value: (row) => formatDateTime(getCompletedAt(row)),
      },
      {
        header: "Updated At",
        value: (row) => formatDateTime(getUpdatedAt(row)),
      },
    ],
    [astGeofenceByAstId],
  );

  const quickDownloadScope = useMemo(
    () => ({
      lmName: activeWorkbaseName,
      lmPcode: activeLmPcode || NAv,
      wardLabel: getWardLabel(selectedWard),
      wardPcode: effectiveSelectedWardPcode || NAv,
      defaultSort: "Completed At desc",
    }),
    [
      activeWorkbaseName,
      activeLmPcode,
      selectedWard,
      effectiveSelectedWardPcode,
    ],
  );

  function resetTableControls() {
    setFilters(EMPTY_MREAD_FILTERS);

    setSelectedRow(null);
    setSelectedMeterRow(null);
    setSelectedMediaRow(null);
  }

  function handleWardChange(event) {
    const nextWardPcode = event.target.value;
    const nextWard =
      wardRows.find((ward) => ward.wardPcode === nextWardPcode) || null;

    resetTableControls();

    updateGeo({
      selectedWard: buildRegistryWardSelection(nextWard, nextWardPcode),
      lastSelectionType: nextWardPcode ? "WARD" : null,
    });
  }

  const registryColumns = [{
    key: "meterNo",
    label: "Meter No",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "meterNo", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "meterNo", astGeofenceByAstId),
    render: row => {
      return <><button type="button" className="text-link" style={styles.meterNoButton} onClick={() => setSelectedMeterRow(row)} title="Open meter details and reading history">
                                {getMeterNo(row)}
                              </button></>;
    },
    minWidth: 150
  }, {
    key: "completedAt",
    label: "Completed At",
    filter: "date",
    sortable: true,
    value: row => getSortValue(row, "completedAt", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "completedAt", astGeofenceByAstId),
    render: row => {
      return <>{formatDateTime(getCompletedAt(row))}</>;
    },
    minWidth: 170
  }, {
    key: "sincePreviousReading",
    label: "Days Since Last Reading",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "sincePreviousReading", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "sincePreviousReading", astGeofenceByAstId),
    render: row => {
      return <><strong>{getSincePreviousReadingDisplay(row)}</strong></>;
    },
    minWidth: 185
  }, {
    key: "outcome",
    label: "Outcome",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "outcome", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "outcome", astGeofenceByAstId),
    render: row => {
      const outcome = getOutcome(row);
      return <><StatusPill tone={getOutcomeTone(outcome)}>
                                {getOutcomeLabel(outcome)}
                              </StatusPill></>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "SUCCESSFUL_READING",
      label: "Successful"
    }, {
      value: "UNSUCCESSFUL_READING",
      label: "Unsuccessful"
    }, {
      value: "NO_ACCESS",
      label: "No Access"
    }],
    minWidth: 170
  }, {
    key: "mediaStatus",
    label: "Media",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "media", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "media", astGeofenceByAstId),
    render: row => {
      const evidence = getEvidence(row);
      const mediaLinks = getEvidencePhotoLinks(row);
      return <>{evidence.photoCount > 0 || mediaLinks.length > 0 ? <button type="button" style={styles.evidenceButton} onClick={() => setSelectedMediaRow(row)}>
                                  {formatNumber(evidence.photoCount || mediaLinks.length)}{" "}
                                  photo(s)
                                </button> : <span className="muted">No media</span>}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "HAS_MEDIA",
      label: "Has Media"
    }, {
      value: "NO_MEDIA",
      label: "No Media"
    }],
    minWidth: 150
  }, {
    key: "reason",
    label: "Reason",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "reason", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "reason", astGeofenceByAstId),
    render: row => {
      return <>{getReasonText(row)}</>;
    },
    minWidth: 180
  }, {
    key: "currentReading",
    label: "Current Reading",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "currentReading", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "currentReading", astGeofenceByAstId),
    render: row => {
      return <><strong>
                                {formatReading(getCurrentReading(row))}
                              </strong></>;
    },
    minWidth: 145
  }, {
    key: "previousReading",
    label: "Prev Reading",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "previousReading", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "previousReading", astGeofenceByAstId),
    render: row => {
      return <>{formatReading(getPreviousReading(row))}</>;
    },
    minWidth: 130
  }, {
    key: "consumption",
    label: "Consumption",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "consumption", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "consumption", astGeofenceByAstId),
    render: row => {
      return <><strong>{formatReading(getConsumption(row))}</strong></>;
    },
    minWidth: 130
  }, {
    key: "meterType",
    label: "Type",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "meterType", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "meterType", astGeofenceByAstId),
    render: row => {
      return <>{getMeterTypeLabel(getMeterType(row))}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "electricity",
      label: "Electricity"
    }, {
      value: "water",
      label: "Water"
    }],
    minWidth: 130
  }, {
    key: "meterKind",
    label: "Kind",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "meterKind", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "meterKind", astGeofenceByAstId),
    render: row => {
      return <>{formatMeterAttribute(getMeterKind(row))}</>;
    },
    minWidth: 130
  }, {
    key: "meterPhase",
    label: "Phase",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "meterPhase", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "meterPhase", astGeofenceByAstId),
    render: row => {
      return <>{formatMeterAttribute(getMeterPhase(row))}</>;
    },
    minWidth: 130
  }, {
    key: "erfNo",
    label: "ERF No",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "erfNo", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "erfNo", astGeofenceByAstId),
    render: row => {
      return <>{getErfNo(row)}</>;
    },
    minWidth: 120
  }, {
    key: "premiseAddress",
    label: "Premise Address",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "premiseAddress", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "premiseAddress", astGeofenceByAstId),
    render: row => {
      return <><strong>{getPremiseAddress(row)}</strong>
                              <div style={styles.secondaryId}>
                                <RegistryIdText value={getPremiseId(row)} />
                              </div></>;
    },
    minWidth: 240
  }, {
    key: "wardNo",
    label: "Ward",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "wardNo", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "wardNo", astGeofenceByAstId),
    render: row => {
      return <><strong>{getWardNo(row)}</strong></>;
    },
    minWidth: 100
  }, {
    key: "geofence",
    label: "Geofence",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "geofence", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "geofence", astGeofenceByAstId),
    render: row => {
      return <>{getGeofenceName(row, astGeofenceByAstId)}</>;
    },
    filterAllValue: "ALL",
    filterOptions: [...geofenceOptions.map(option => ({
      value: option.value,
      label: option.label
    }))],
    minWidth: 150
  }, {
    key: "capturedBy",
    label: "Captured By",
    filter: "text",
    sortable: true,
    value: row => getSortValue(row, "capturedBy", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "capturedBy", astGeofenceByAstId),
    render: row => {
      return <><strong>{getCapturedByName(row)}</strong>
                              <div style={styles.secondaryId}>
                                <RegistryIdText value={getCapturedByUid(row)} />
                              </div>
                              {isMeaningfulText(getCapturedByRole(row)) ? <div className="muted">
                                  {getCapturedByRole(row)}
                                </div> : null}</>;
    },
    minWidth: 160
  }, {
    key: "billingReadiness",
    label: "Billing",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "billingReadiness", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "billingReadiness", astGeofenceByAstId),
    render: row => {
      return <><StatusPill tone={getBillingTone(getBillingReadiness(row))}>
                                {getBillingReadinessLabel(getBillingReadiness(row))}
                              </StatusPill></>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "BILLING_READY_CANDIDATE",
      label: "Billing Ready"
    }, {
      value: "BILLING_REVIEW_REQUIRED",
      label: "Review"
    }, {
      value: "NOT_BILLING_READY",
      label: "Not Ready"
    }],
    minWidth: 170
  }, {
    key: "reviewStatus",
    label: "Review",
    filter: "select",
    sortable: true,
    value: row => getSortValue(row, "reviewStatus", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "reviewStatus", astGeofenceByAstId),
    render: row => {
      return <><StatusPill tone={getReviewTone(getReviewStatus(row))}>
                                {getReviewStatus(row)}
                              </StatusPill></>;
    },
    filterAllValue: "ALL",
    filterOptions: [{
      value: "REVIEW_REQUIRED",
      label: "Required"
    }, {
      value: "NAv",
      label: "No Review"
    }],
    minWidth: 150
  }, {
    key: "actions",
    label: "Actions",
    filter: null,
    sortable: false,
    value: row => getSortValue(row, "actions", astGeofenceByAstId),
    sortValue: row => getSortValue(row, "actions", astGeofenceByAstId),
    render: row => {
      return <><button type="button" className="text-link" onClick={() => setSelectedRow(row)}>
                                View Details
                              </button></>;
    },
    minWidth: 120
  }];

  return (
    <>
      <style>
        {`
          @keyframes ireps-spin { to { transform: rotate(360deg); } }

          .mread-registry-table th,
          .mread-registry-table td {
            padding-left: 0.9rem;
            padding-right: 0.9rem;
          }

          .mread-registry-table tbody td {
            padding-top: 0.62rem;
            padding-bottom: 0.62rem;
          }
        `}
      </style>
      <header className="console-header" style={styles.fixedRegistryHeader}>
        <div>
          <h1>MREAD Registry</h1>
          <p className="muted">
            View completed MREAD field records and generate preserved staging
            snapshots.
          </p>
          <Link className="text-link" to="/registries">
            ← Back to Registries
          </Link>
        </div>

        <div className="topbar-right">
          <div className="workbase-pill">{activeWorkbaseName}</div>
          <div className="role-pill">{role || NAv}</div>
          <div className="role-pill">
            {isRegistryOpening
              ? "Opening registry..."
              : isFetching
                ? "Streaming..."
                : `${formatNumber(filteredMreadRows.length)} MREAD rows`}
          </div>
          <button
            type="button"
            style={styles.stagingButton}
            onClick={() => setIsStagingControllerOpen(true)}
          >
            Staging
          </button>
          <button
            type="button"
            style={styles.helpButton}
            onClick={() => setIsHelpOpen(true)}
          >
            ? Help
          </button>

        </div>
      </header>

      <section className="filter-panel">
        <label>
          Ward
          <select
            value={effectiveSelectedWardPcode}
            onChange={handleWardChange}
            disabled={wardsLoading || wardRows.length === 0}
          >
            <option value="">Select ward</option>
            {wardRows.map((ward) => (
              <option key={ward.wardPcode} value={ward.wardPcode}>
                Ward {ward.wardNumber}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-summary">
          <strong>{getWardLabel(selectedWard)}</strong>
          <span>{effectiveSelectedWardPcode || "No ward selected"}</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="stat-card">
          <span>Total MREAD Rows</span>
          <strong>{formatNumber(mreadRows.length)}</strong>
        </div>
        <div className="stat-card">
          <span>Filtered Rows</span>
          <strong>{formatNumber(filteredMreadRows.length)}</strong>
        </div>
        <div className="stat-card">
          <span>Successful</span>
          <strong>{formatNumber(totals.successful)}</strong>
        </div>
        <div className="stat-card">
          <span>Unsuccessful</span>
          <strong>{formatNumber(totals.unsuccessful)}</strong>
        </div>
        <div className="stat-card">
          <span>No Access</span>
          <strong>{formatNumber(totals.noAccess)}</strong>
        </div>
        <div className="stat-card">
          <span>Billing-Ready</span>
          <strong>{formatNumber(totals.billingReady)}</strong>
        </div>
        <div className="stat-card">
          <span>Review Required</span>
          <strong>{formatNumber(totals.reviewRequired)}</strong>
        </div>
        <div className="stat-card">
          <span>With Media</span>
          <strong>{formatNumber(totals.withEvidence)}</strong>
        </div>
      </section>

      <section className="table-panel">
        {!effectiveSelectedWardPcode ? (
          <div className="empty-state">
            <h2>Select a ward</h2>
            <p className="muted">
              MREAD Registry is ward-scoped for clean operational browsing.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="empty-state error-box">
            <h2>Could not load MREAD registry</h2>
            <p className="muted">
              Check Firestore rules, registry_mread, or the ward field used by
              the query.
            </p>
          </div>
        ) : null}

        {isRegistryOpening ? (
          <LoadingSpinner
            title="Opening MREAD registry..."
            message="Waiting for the registry_mread Firestore stream."
          />
        ) : null}

        {!isRegistryOpening &&
        effectiveSelectedWardPcode &&
        mreadRows.length === 0 &&
        !error ? (
          <div className="empty-state">
            <h2>No MREAD registry rows found</h2>
            <p className="muted">
              No completed MREAD rows were returned for ward{" "}
              {effectiveSelectedWardPcode}.
            </p>
          </div>
        ) : null}

        {!isRegistryOpening && mreadRows.length > 0 ? (
          <>

            <div className="table-wrap" style={styles.tableWrap}>
              <IrepsTable
                key={`${activeLmPcode}:${effectiveSelectedWardPcode}`}
                title="MREAD Registry"
                rows={mreadRows}
                columns={registryColumns}
                rowKey={row => row.id || getTrnId(row)}
                filters={filters}
                onFiltersChange={setFilters}
                filteredRows={filteredMreadRows}
                filterRows={filterRegistryRows}
                defaultSort={DEFAULT_SORT}
                downloads={{
                  registryName: "MREAD Registry",
                  rowsLabel: "MREAD rows",
                  columns: quickDownloadColumns,
                  fileBaseName: "mread_registry",
                  scope: quickDownloadScope
                }}
                stickyHeader
                maxHeight="70vh"
              />
            </div>

          </>
        ) : null}
      </section>

      {selectedRow ? (
        <RowDetailsModal
          row={selectedRow}
          astGeofenceByAstId={astGeofenceByAstId}
          onClose={() => setSelectedRow(null)}
        />
      ) : null}
      {selectedMeterRow ? (
        <SharedMeterHistoryModal
          row={selectedMeterRow}
          registryRows={mreadRows}
          onClose={() => setSelectedMeterRow(null)}
        />
      ) : null}
      {selectedMediaRow ? (
        <MediaModal
          row={selectedMediaRow}
          onClose={() => setSelectedMediaRow(null)}
        />
      ) : null}
      {isHelpOpen ? <HelpModal onClose={() => setIsHelpOpen(false)} /> : null}
      {isStagingControllerOpen ? (
        <MreadStagingControllerModal
          lmPcode={activeLmPcode}
          onClose={() => setIsStagingControllerOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = {
  fixedRegistryHeader: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "#f8fafc",
    paddingTop: "0.35rem",
    paddingRight: "1.25rem",
    paddingBottom: "0.85rem",
    paddingLeft: "1.25rem",
    boxSizing: "border-box",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
    alignItems: "flex-start",
    gap: "1rem",
  },
  stagingButton: {
    border: "1px solid rgba(15, 23, 42, 0.12)",
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "999px",
    padding: "0.45rem 0.85rem",
    fontWeight: 850,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  helpButton: {
    border: "1px solid rgba(37, 99, 235, 0.25)",
    background: "rgba(37, 99, 235, 0.08)",
    color: "#1d4ed8",
    borderRadius: "999px",
    padding: "0.45rem 0.75rem",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  stagingControllerModalCard: {
    width: "min(1180px, calc(100vw - 2rem))",
    maxHeight: "calc(100vh - 2rem)",
    overflowY: "auto",
    background: "#ffffff",
    borderRadius: "1.25rem",
    border: "1px solid rgba(148, 163, 184, 0.45)",
    boxShadow: "0 24px 80px rgba(15, 23, 42, 0.28)",
  },
  stagingControllerNotice: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "1rem",
    padding: "0.9rem 1rem",
    color: "#334155",
    fontSize: "0.9rem",
    lineHeight: 1.5,
  },
  stagingControllerSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(110px, 1fr)) minmax(220px, 1.4fr)",
    gap: "0.75rem",
  },
  stagingSummaryTile: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "0.95rem",
    padding: "0.8rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  stagingSummaryTileWide: {
    background: "#ffffff",
    border: "1px solid #bfdbfe",
    borderRadius: "0.95rem",
    padding: "0.8rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  stagingControllerFilters: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(140px, 1fr)) auto",
    gap: "0.75rem",
    alignItems: "end",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "1rem",
    padding: "0.85rem",
  },
  stagingFilterLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    color: "#475569",
    fontSize: "0.75rem",
    fontWeight: 850,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  stagingInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.75rem",
    padding: "0.6rem 0.7rem",
    color: "#0f172a",
    background: "#ffffff",
    fontSize: "0.9rem",
  },
  stagingErrorBox: {
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: "1rem",
    padding: "0.8rem 1rem",
    fontWeight: 750,
  },
  stagingPhaseNotice: {
    background: "#fffbeb",
    color: "#92400e",
    border: "1px solid #fcd34d",
    borderRadius: "1rem",
    padding: "0.8rem 1rem",
    fontWeight: 700,
  },
  stagingControllerGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "1rem",
    alignItems: "start",
  },
  stagingCyclesPanel: {
    minWidth: 0,
  },
  stagingTableWrap: {
    overflowX: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: "1rem",
  },

  selectedStagingCycleRow: {
    background: "#eff6ff",
  },
  primaryMiniButton: {
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "0.65rem",
    padding: "0.42rem 0.65rem",
    fontSize: "0.78rem",
    fontWeight: 850,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  disabledMiniButton: {
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    color: "#94a3b8",
    borderRadius: "0.65rem",
    padding: "0.42rem 0.65rem",
    fontSize: "0.78rem",
    fontWeight: 850,
    cursor: "not-allowed",
    whiteSpace: "nowrap",
  },
  modalCloseButton: {
    border: "1px solid rgba(148, 163, 184, 0.55)",
    background: "#f8fafc",
    color: "#0f172a",
    borderRadius: "999px",
    padding: "0.45rem 0.8rem",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
  },
  evidenceButton: {
    border: "1px solid rgba(37, 99, 235, 0.25)",
    background: "rgba(37, 99, 235, 0.08)",
    color: "#1d4ed8",
    borderRadius: "999px",
    padding: "0.28rem 0.55rem",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  meterNoButton: {
    border: 0,
    background: "transparent",
    padding: 0,
    font: "inherit",
    fontWeight: 800,
    cursor: "pointer",
  },
  tableWrap: {
    overflowX: "auto",
    padding: "0 0.35rem 0.35rem",
    boxSizing: "border-box",
  },

  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "0.2rem 0.55rem",
    fontSize: "0.72rem",
    fontWeight: 800,
    background: "rgba(148, 163, 184, 0.16)",
    color: "#334155",
    whiteSpace: "nowrap",
  },
  successPill: {
    background: "rgba(34, 197, 94, 0.14)",
    color: "#166534",
  },
  warningPill: {
    background: "rgba(245, 158, 11, 0.16)",
    color: "#92400e",
  },
  dangerPill: {
    background: "rgba(239, 68, 68, 0.14)",
    color: "#991b1b",
  },
  secondaryId: {
    marginTop: "0.18rem",
    fontSize: "0.68rem",
    lineHeight: 1.25,
    color: "#64748b",
    wordBreak: "break-word",
  },
  loadingBlock: {
    minHeight: "160px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    textAlign: "left",
  },
  spinner: {
    width: "34px",
    height: "34px",
    borderRadius: "999px",
    border: "4px solid rgba(148, 163, 184, 0.25)",
    borderTopColor: "#2563eb",
    animation: "ireps-spin 0.9s linear infinite",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1.5rem",
    background: "rgba(15, 23, 42, 0.58)",
  },

  modalCardLarge: {
    width: "min(1120px, 96vw)",
    height: "min(88vh, 900px)",
    maxHeight: "88vh",
    overflow: "hidden",
    background: "#fff",
    borderRadius: "1.2rem",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.28)",
    display: "flex",
    flexDirection: "column",
  },
  modalHeader: {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    borderBottom: "1px solid rgba(148, 163, 184, 0.32)",
    padding: "1rem 1.25rem",
    background: "#fff",
    position: "sticky",
    top: 0,
    zIndex: 5,
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
  },

  primaryButton: {
    border: "1px solid rgba(37, 99, 235, 0.55)",
    background: "#2563eb",
    color: "#fff",
    borderRadius: "999px",
    padding: "0.55rem 0.9rem",
    fontWeight: 800,
    cursor: "pointer",
  },

  modalBody: {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: "1.25rem",
  },
  detailsTwoColumnGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: "1.1rem",
    marginTop: 0,
    alignItems: "start",
  },
  detailsColumn: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    minWidth: 0,
  },
  detailsSection: {
    border: "1px solid rgba(148, 163, 184, 0.24)",
    borderRadius: "0.95rem",
    padding: "0.9rem",
    background: "rgba(248, 250, 252, 0.72)",
  },
  helpGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "1rem",
    marginTop: 0,
  },
  detailLine: {
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    gap: "0.75rem",
    padding: "0.42rem 0",
    borderTop: "1px solid rgba(148, 163, 184, 0.18)",
  },
  modalMediaBlock: {
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    gap: "0.75rem",
    padding: "0.42rem 0",
    borderTop: "1px solid rgba(148, 163, 184, 0.18)",
  },
  mediaLinkList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    alignItems: "flex-start",
  },

  sectionHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    marginBottom: "0.75rem",
  },

  evidenceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "1rem",
  },
  evidenceCard: {
    border: "1px solid rgba(148, 163, 184, 0.24)",
    borderRadius: "0.95rem",
    padding: "0.85rem",
    background: "rgba(248, 250, 252, 0.72)",
  },
  evidenceImage: {
    width: "100%",
    maxHeight: "420px",
    objectFit: "contain",
    borderRadius: "0.75rem",
    background: "#0f172a",
  },
  evidenceMetaGrid: {
    marginTop: "0.75rem",
  },

};
