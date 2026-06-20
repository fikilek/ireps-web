import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { doc, getDoc, getFirestore } from "firebase/firestore";

import { useAuth } from "../../auth/useAuth";
import { useGeo } from "../../context/GeoContext";
import { useGetRegistryMreadByWardQuery } from "../../redux/registryMreadApi";
import { useGetRegistryWardsByLmQuery } from "../../redux/registryWardsApi";
import {
  useGenerateMreadStagingMutation,
  useListMreadStagingCyclesQuery,
} from "../../redux/mreadStagingCyclesApi";
import { DatetimeFilterButton } from "../../components/DatetimeFilter";
import DownloadButtons from "../../components/DownloadButtons";
import RegistryIdText from "../../components/RegistryIdText";

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
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 5;
const NO_GEOFENCE_FILTER = "NO_GEOFENCE";
const NAv = "NAv";

// This repo lint profile does not mark JSX-only identifiers as used.
// Keep this marker until the shared ESLint config enables react/jsx-uses-vars.
function markJsxOnlyComponentUsage(...components) {
  return components.length;
}

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
  return !["nav", "n/av", "n/a", "na", "null", "undefined"].includes(
    cleanText,
  );
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

function formatDateTime(value) {
  if (!value || value === NAv) return NAv;

  if (typeof value === "string") {
    return value.slice(0, 19).replace("T", " ");
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleString();
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleString();
  }

  return NAv;
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

function startOfDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
}

function endOfDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function addDays(date, days) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    0,
    0,
    0,
    0,
  );
}

function parseDateOnly(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getReadingDateFilterRange(filter = EMPTY_READING_DATE_FILTER) {
  const mode = filter?.mode || "ALL";
  const now = new Date();
  const todayStart = startOfDay(now);

  if (mode === "TODAY") return { start: todayStart, end: endOfDay(now) };

  if (mode === "YESTERDAY") {
    const yesterday = addDays(todayStart, -1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }

  if (mode === "PAST_3_DAYS") {
    return { start: addDays(todayStart, -2), end: endOfDay(now) };
  }

  if (mode === "THIS_WEEK") {
    const sunday = addDays(todayStart, -todayStart.getDay());
    const saturday = addDays(sunday, 6);
    return { start: startOfDay(sunday), end: endOfDay(saturday) };
  }

  if (mode === "THIS_MONTH") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    };
  }

  if (mode === "CUSTOM") {
    const startDate = parseDateOnly(filter?.startDate);
    const endDate = parseDateOnly(filter?.endDate);

    return {
      start: startDate ? startOfDay(startDate) : null,
      end: endDate ? endOfDay(endDate) : null,
    };
  }

  return { start: null, end: null };
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
  const readingAt = firstMeaningfulValue(row.readingAt, row?.reading?.readingAt);

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

  return refs.find((ref) => isMeaningfulText(ref?.id) || isMeaningfulText(ref?.name)) || null;
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

function getMediaCreatedAt(item = {}) {
  return firstValue(
    item?.createdAt,
    item?.created?.at,
    item?.updatedAt,
    item?.updated?.at,
  );
}

function getMediaGpsText(item = {}) {
  const gps = item?.gps || item?.location?.gps || {};
  const lat = Number(gps?.lat ?? gps?.latitude);
  const lng = Number(gps?.lng ?? gps?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NAv;
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
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

function getDataQualityTone(value) {
  if (value === "NEEDS_FIX") return "danger";
  if (value === "WARNINGS") return "warning";
  return "success";
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
    [row?.window?.startDate, row?.window?.endDate]
      .filter(Boolean)
      .join(" - "),
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

function normalizeCycleStatus(status) {
  const normalizedStatus = firstMeaningfulText(status, "").toUpperCase();

  if (normalizedStatus === "FUTURE") return "OPEN";
  if (["CLOSED", "DRAFT", "OPEN"].includes(normalizedStatus)) {
    return normalizedStatus;
  }

  return "NAv";
}

function getCycleStatus(row = {}) {
  return normalizeCycleStatus(row?.computedStatus || row?.status);
}

function getCycleAction(row = {}) {
  if (isMeaningfulText(row.action)) {
    return String(row.action).trim().toUpperCase();
  }

  const status = getCycleStatus(row);
  if (status === "DRAFT") return "GENERATE_OPEN";
  if (status === "CLOSED") return "VIEW";
  return "DISABLED";
}

function getCycleActionLabel(row = {}) {
  const action = getCycleAction(row);
  if (action === "GENERATE_OPEN") return "Generate / Open";
  if (action === "VIEW") return "View";
  return "Disabled";
}

function getCycleActionTone(row = {}) {
  const action = getCycleAction(row);
  if (action === "GENERATE_OPEN") return "primary";
  if (action === "VIEW") return "secondary";
  return "disabled";
}

function cycleMatchesFilter(row = {}, { search = "", billingPeriod = "ALL", status = "ALL" } = {}) {
  const rowStatus = getCycleStatus(row);
  const rowBillingPeriod = firstMeaningfulText(row.billingPeriod, "");

  if (billingPeriod !== "ALL" && rowBillingPeriod !== billingPeriod) {
    return false;
  }

  if (status !== "ALL" && rowStatus !== status) {
    return false;
  }

  const term = normalizeText(search);
  if (!term) return true;

  const haystack = [
    row.cycleId,
    getCycleLabel(row),
    row.billingPeriod,
    rowStatus,
    getCycleWindowDisplay(row),
    row.activeStagingId,
  ]
    .map((value) => normalizeText(value))
    .join(" ");

  return haystack.includes(term);
}

function getCycleActionHelp(row = {}) {
  const status = getCycleStatus(row);
  const action = getCycleAction(row);

  if (action === "GENERATE_OPEN") {
    return "DRAFT cycle: Generate / Open will run generateMreadStaging and write the active mread_staging pack.";
  }

  if (action === "VIEW") {
    return row.activeStagingId
      ? "CLOSED cycle: view existing generated staging pack only."
      : "CLOSED cycle: view only, but no active staging pack exists yet.";
  }

  if (status === "OPEN") {
    return "OPEN cycle: readings may still be active, so staging generation is blocked until this cycle becomes DRAFT.";
  }

  return "Action unavailable for this cycle status.";
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
  if (key === "media") return getEvidence(row).photoCount || getEvidencePhotoLinks(row).length;
  if (key === "reason") return getReasonText(row);
  if (key === "currentReading") return Number(getCurrentReading(row) || 0);
  if (key === "previousReading") return Number(getPreviousReading(row) || 0);
  if (key === "consumption") return Number(getConsumption(row) || 0);
  if (key === "meterType") return getMeterTypeLabel(getMeterType(row));
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

function SortButton({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;
  const directionLabel = isActive
    ? sortConfig.direction === "asc"
      ? "↑"
      : "↓"
    : "↕";

  return (
    <button
      type="button"
      style={styles.sortButton}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <span aria-hidden="true">{directionLabel}</span>
    </button>
  );
}

function FilterInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={styles.headerInput}
    />
  );
}

function FilterSelect({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={styles.headerSelect}
    >
      {children}
    </select>
  );
}

function HeaderCell({ minWidth = 130, children }) {
  return (
    <th style={{ ...styles.headerCell, minWidth }}>
      <div style={styles.headerStack}>{children}</div>
    </th>
  );
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

function getAstMeterNo(astDoc = {}) {
  return firstText(
    astDoc?.astNo,
    astDoc?.meterNo,
    astDoc?.ast?.astData?.astNo,
    astDoc?.ast?.astData?.meterNo,
    astDoc?.master?.id,
  );
}

function getAstMeterType(astDoc = {}) {
  return firstText(astDoc?.meterType, astDoc?.ast?.astData?.meter?.serviceType);
}

function getAstMeterKind(astDoc = {}) {
  return firstText(
    astDoc?.meterKind,
    astDoc?.ast?.astData?.meter?.kind,
    astDoc?.ast?.astData?.meter?.type,
  );
}

function getAstStatus(astDoc = {}) {
  return firstText(astDoc?.statusState, astDoc?.status?.state);
}

function getAstPremiseAddress(astDoc = {}) {
  return firstText(
    astDoc?.premiseAddress,
    astDoc?.accessData?.premise?.address,
  );
}

function getAstPremiseId(astDoc = {}) {
  return firstText(astDoc?.premiseId, astDoc?.accessData?.premise?.id);
}

function getAstErfNo(astDoc = {}) {
  return firstText(astDoc?.erfNo, astDoc?.accessData?.erfNo);
}

function getAstWardPcode(astDoc = {}) {
  return firstText(astDoc?.wardPcode, astDoc?.accessData?.parents?.wardPcode);
}

function getAstUpdatedAt(astDoc = {}) {
  return firstValue(
    astDoc?.updatedAt,
    astDoc?.metadata?.updatedAt,
    astDoc?.__updateTime__,
  );
}

const BASELINE_READING_SOURCES = new Set([
  "AST_CREATION",
  "METER_DISCOVERY",
  "METER_INSTALLATION",
]);

function isBaselineReadingSource(source = "") {
  return BASELINE_READING_SOURCES.has(
    String(source || "")
      .trim()
      .toUpperCase(),
  );
}

function getAstMreadings(astDoc = {}) {
  const readings = Array.isArray(astDoc?.mreadings) ? astDoc.mreadings : [];

  const sortedReadings = readings
    .map((item, index) => {
      const readingValue = firstText(item?.reading, item?.currentReading);
      const readingNumber = Number(readingValue);
      const source = firstText(item?.source);
      const storedSincePreviousReadingDisplay = firstText(
        item?.sincePreviousReadingDisplay,
        item?.daysSinceLastReadingDisplay,
        item?.sincePreviousReading?.display,
        item?.daysSinceLastReading?.display,
        item?.["sincePreviousReading.display"],
        item?.["daysSinceLastReading.display"],
      );
      const rawSincePreviousReadingMinutes = Number(
        firstValue(
          item?.sincePreviousReadingMinutes,
          item?.daysSinceLastReadingMinutes,
          item?.sincePreviousReading?.totalMinutes,
          item?.daysSinceLastReading?.totalMinutes,
          item?.["sincePreviousReading.totalMinutes"],
          item?.["daysSinceLastReading.totalMinutes"],
        ),
      );
      const isBaselineReading = isBaselineReadingSource(source);

      return {
        raw: item,
        index,
        key: `${item?.trnId || "mread"}-${item?.readingAt || index}`,
        readingAt: firstValue(
          item?.readingAt,
          item?.completedAt,
          item?.createdAt,
        ),
        reading: readingValue,
        readingNumber: Number.isFinite(readingNumber) ? readingNumber : null,
        trnId: firstText(item?.trnId, item?.sourceTrnId),
        source,
        outcomeLabel: isBaselineReading ? "Baseline Reading" : "Successful Reading",
        reason: NAv,
        capturedBy: firstText(
          item?.capturedByName,
          item?.capturedBy?.name,
          item?.actor?.name,
          item?.createdByUser,
          item?.updatedByUser,
        ),
        capturedByUid: firstText(
          item?.capturedByUid,
          item?.capturedBy?.uid,
          item?.actor?.uid,
          item?.createdByUid,
          item?.updatedByUid,
        ),
        sincePreviousReadingDisplay:
          storedSincePreviousReadingDisplay !== NAv
            ? storedSincePreviousReadingDisplay
            : isBaselineReading
              ? "0"
              : NAv,
        sincePreviousReadingMinutes: Number.isFinite(
          rawSincePreviousReadingMinutes,
        )
          ? rawSincePreviousReadingMinutes
          : isBaselineReading
            ? 0
            : null,
      };
    })
    .filter((item) => item.readingAt || item.readingNumber !== null)
    .sort((a, b) =>
      String(b.readingAt || "").localeCompare(String(a.readingAt || "")),
    );

  return sortedReadings.map((item, index) => {
    const previousRow = sortedReadings[index + 1] || null;
    const previousReading = previousRow?.readingNumber ?? null;
    const consumption =
      item.readingNumber !== null && previousReading !== null
        ? item.readingNumber - previousReading
        : null;

    return {
      ...item,
      previousReading,
      consumption,
    };
  });
}


function isSameMeterHistoryTarget(row = {}, selectedRow = {}) {
  const selectedAstId = getAstDocIdFromRow(selectedRow);
  const rowAstId = getAstDocIdFromRow(row);

  if (isMeaningfulText(selectedAstId) && isMeaningfulText(rowAstId)) {
    return selectedAstId === rowAstId;
  }

  const selectedMeterNo = getMeterNo(selectedRow);
  const rowMeterNo = getMeterNo(row);

  return (
    isMeaningfulText(selectedMeterNo) &&
    isMeaningfulText(rowMeterNo) &&
    normalizeText(selectedMeterNo) === normalizeText(rowMeterNo)
  );
}

function getRegistryMreadHistoryRows(registryRows = [], selectedRow = {}) {
  return registryRows
    .filter((registryRow) => isSameMeterHistoryTarget(registryRow, selectedRow))
    .map((registryRow, index) => {
      const outcome = getOutcome(registryRow);
      const isSuccessfulReading = outcome === "SUCCESSFUL_READING";
      const trnId = getTrnId(registryRow);
      const currentReading = getCurrentReading(registryRow);
      const currentReadingNumber = Number(currentReading);
      const previousReading = getPreviousReading(registryRow);
      const previousReadingNumber = Number(previousReading);
      const consumption = getConsumption(registryRow);
      const consumptionNumber = Number(consumption);
      const completedAt = firstMeaningfulValue(getCompletedAt(registryRow));
      const readingAt = isSuccessfulReading
        ? firstMeaningfulValue(getReadingAt(registryRow), completedAt)
        : completedAt;

      return {
        raw: registryRow,
        index,
        key: `registry-${trnId || registryRow?.id || index}`,
        readingAt,
        completedAt,
        reading:
          isSuccessfulReading && Number.isFinite(currentReadingNumber)
            ? currentReading
            : NAv,
        readingNumber:
          isSuccessfulReading && Number.isFinite(currentReadingNumber)
            ? currentReadingNumber
            : null,
        previousReading:
          isSuccessfulReading && Number.isFinite(previousReadingNumber)
            ? previousReadingNumber
            : null,
        consumption:
          isSuccessfulReading && Number.isFinite(consumptionNumber)
            ? consumptionNumber
            : null,
        trnId,
        source: outcome === "NO_ACCESS" ? "NO_ACCESS" : "METER_READING",
        outcomeLabel: getOutcomeLabel(outcome),
        reason: getReasonText(registryRow),
        capturedBy: getCapturedByName(registryRow),
        capturedByUid: getCapturedByUid(registryRow),
        sincePreviousReadingDisplay: isSuccessfulReading
          ? getSincePreviousReadingDisplay(registryRow)
          : NAv,
        sincePreviousReadingMinutes: isSuccessfulReading
          ? getSincePreviousReadingMinutes(registryRow)
          : null,
      };
    });
}

function mergeMeterHistoryRows({ astRows = [], registryRows = [], selectedRow = {} } = {}) {
  const mergedRows = [];
  const seenTrnIds = new Set();

  getRegistryMreadHistoryRows(registryRows, selectedRow).forEach((item) => {
    const trnId = firstMeaningfulText(item.trnId, "");
    if (trnId) seenTrnIds.add(trnId);
    mergedRows.push(item);
  });

  astRows.forEach((item, index) => {
    const trnId = firstMeaningfulText(item.trnId, "");

    if (trnId && seenTrnIds.has(trnId)) return;
    if (trnId) seenTrnIds.add(trnId);

    mergedRows.push({
      ...item,
      key: `ast-${item.key || item.trnId || index}`,
      outcomeLabel: item.outcomeLabel || "Successful Reading",
      reason: item.reason || NAv,
    });
  });

  return mergedRows.sort((a, b) => {
    const bTime = getReadingAtMs(firstValue(b.readingAt, b.completedAt));
    const aTime = getReadingAtMs(firstValue(a.readingAt, a.completedAt));

    if (aTime !== null && bTime !== null) return bTime - aTime;
    if (bTime !== null) return 1;
    if (aTime !== null) return -1;

    return compareNatural(String(b.readingAt || ""), String(a.readingAt || ""));
  });
}

function getReadingAtMs(value) {
  if (!value || value === NAv) return null;

  if (typeof value?.toDate === "function") {
    const millis = value.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.seconds === "number") {
    const millis = value.seconds * 1000;
    return Number.isFinite(millis) ? millis : null;
  }

  const millis = Date.parse(String(value));
  return Number.isFinite(millis) ? millis : null;
}

function formatSummaryMetric(value) {
  if (value === null || value === undefined || value === "") return NAv;

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return NAv;

  const roundedValue =
    Math.abs(numberValue) >= 100
      ? Math.round(numberValue)
      : Number(numberValue.toFixed(2));

  return roundedValue.toLocaleString();
}

function buildMeterReadingSummary(historyRows = []) {
  const validRows = historyRows
    .filter((item) => item?.readingNumber !== null)
    .map((item, index) => ({
      ...item,
      readingAtMs: getReadingAtMs(item?.readingAt),
      originalIndex: index,
    }))
    .sort((a, b) => {
      if (a.readingAtMs !== null && b.readingAtMs !== null) {
        return a.readingAtMs - b.readingAtMs;
      }

      if (a.readingAtMs !== null) return -1;
      if (b.readingAtMs !== null) return 1;

      // historyRows is already newest first, so reverse that order for oldest first.
      return b.originalIndex - a.originalIndex;
    });

  const firstRow = validRows[0] || null;
  const lastRow = validRows[validRows.length - 1] || null;
  const firstReading = firstRow?.readingNumber ?? null;
  const lastReading = lastRow?.readingNumber ?? null;
  const totalConsumption =
    firstReading !== null && lastReading !== null
      ? lastReading - firstReading
      : null;

  const elapsedDays =
    firstRow?.readingAtMs !== null &&
    lastRow?.readingAtMs !== null &&
    lastRow?.readingAtMs > firstRow?.readingAtMs
      ? (lastRow.readingAtMs - firstRow.readingAtMs) / 86400000
      : null;

  const averagePerDay =
    totalConsumption !== null && elapsedDays !== null && elapsedDays > 0
      ? totalConsumption / elapsedDays
      : null;

  return {
    firstReading,
    lastReading,
    totalConsumption,
    averagePerDay,
    averagePerWeek: averagePerDay !== null ? averagePerDay * 7 : null,
    averagePerMonth: averagePerDay !== null ? averagePerDay * 30.4375 : null,
    averagePerYear: averagePerDay !== null ? averagePerDay * 365.25 : null,
  };
}

function MeterHistoryModal({ row, registryRows = [], onClose }) {
  const astId = getAstDocIdFromRow(row);
  const meterNo = getMeterNo(row);
  const [astState, setAstState] = useState({
    loading: true,
    error: "",
    ast: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadAst() {
      if (!astId) {
        setAstState({
          loading: false,
          error: "No AST ID available on this registry row.",
          ast: null,
        });
        return;
      }

      setAstState({ loading: true, error: "", ast: null });

      try {
        const db = getFirestore();
        const astSnap = await getDoc(doc(db, "asts", astId));

        if (cancelled) return;

        if (!astSnap.exists()) {
          setAstState({
            loading: false,
            error: `Meter AST not found: ${astId}`,
            ast: null,
          });
          return;
        }

        setAstState({
          loading: false,
          error: "",
          ast: {
            id: astSnap.id,
            ...astSnap.data(),
          },
        });
      } catch (error) {
        if (cancelled) return;
        setAstState({
          loading: false,
          error: error?.message || "Could not load meter details.",
          ast: null,
        });
      }
    }

    loadAst();

    return () => {
      cancelled = true;
    };
  }, [astId]);

  const astDoc = astState.ast || {};
  const astHistoryRows = getAstMreadings(astDoc);
  const historyRows = mergeMeterHistoryRows({
    astRows: astHistoryRows,
    registryRows,
    selectedRow: row,
  });
  const readingSummary = buildMeterReadingSummary(historyRows);

  return (
    <div
      style={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mread-meter-history-title"
    >
      <div style={styles.modalCardLarge}>
        <div style={styles.modalHeader}>
          <div>
            <p className="eyebrow">Meter Details & Reading History</p>
            <h2 id="mread-meter-history-title">{meterNo}</h2>
          </div>

          <button
            type="button"
            style={styles.modalCloseButton}
            onClick={onClose}
          >
            Close Meter
          </button>
        </div>

        <div style={styles.modalBody}>
          {astState.loading ? <LoadingSpinner /> : null}

          {!astState.loading && astState.error ? (
            <div className="empty-state">
              <h2>Could not load meter details</h2>
              <p className="muted">{astState.error}</p>
            </div>
          ) : null}

          {!astState.loading && !astState.error && astDoc ? (
            <div style={styles.meterHistoryStack}>
              <section style={styles.detailsSection}>
                <h3>Meter Details</h3>
                <div style={styles.detailsTwoColumnGrid}>
                  <div>
                    <CompactDetailLine
                      label="Meter No"
                      value={getAstMeterNo(astDoc)}
                    />
                    <CompactDetailLine
                      label="AST ID"
                      value={astDoc.id || astId}
                    />
                    <CompactDetailLine
                      label="Meter Type"
                      value={getMeterTypeLabel(getAstMeterType(astDoc))}
                    />
                    <CompactDetailLine
                      label="Meter Kind"
                      value={getAstMeterKind(astDoc)}
                    />
                    <CompactDetailLine
                      label="Status"
                      value={getAstStatus(astDoc)}
                    />
                  </div>

                  <div>
                    <CompactDetailLine
                      label="Premise Address"
                      value={getAstPremiseAddress(astDoc)}
                    />
                    <CompactDetailLine
                      label="Premise ID"
                      value={getAstPremiseId(astDoc)}
                    />
                    <CompactDetailLine
                      label="ERF No"
                      value={getAstErfNo(astDoc)}
                    />
                    <CompactDetailLine
                      label="Ward Pcode"
                      value={getAstWardPcode(astDoc)}
                    />
                    <CompactDetailLine
                      label="Updated At"
                      value={formatDateTime(getAstUpdatedAt(astDoc))}
                    />
                  </div>
                </div>
              </section>

              <section style={styles.detailsSection}>
                <div style={styles.readingSummaryGrid}>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">First Reading</span>
                    <strong>{formatSummaryMetric(readingSummary.firstReading)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Last Reading</span>
                    <strong>{formatSummaryMetric(readingSummary.lastReading)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Total Consumption</span>
                    <strong>{formatSummaryMetric(readingSummary.totalConsumption)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Avg / Day</span>
                    <strong>{formatSummaryMetric(readingSummary.averagePerDay)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Avg / Week</span>
                    <strong>{formatSummaryMetric(readingSummary.averagePerWeek)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Avg / Month</span>
                    <strong>{formatSummaryMetric(readingSummary.averagePerMonth)}</strong>
                  </div>
                  <div style={styles.readingSummaryTile}>
                    <span className="muted">Avg / Year</span>
                    <strong>{formatSummaryMetric(readingSummary.averagePerYear)}</strong>
                  </div>
                </div>
              </section>

              <section style={styles.detailsSection}>
                <div style={styles.sectionHeaderRow}>
                  <div>
                    <h3>Meter Reading / Attempt History</h3>
                    <p className="muted">
                      Registry attempts and cached readings for this meter.
                    </p>
                  </div>
                  <span style={styles.statusPill}>
                    {formatNumber(historyRows.length)} attempt(s)
                  </span>
                </div>

                {historyRows.length === 0 ? (
                  <p className="muted">
                    No registry attempts or cached meter readings found for this meter.
                  </p>
                ) : (
                  <div style={styles.historyTableWrap}>
                    <table className="data-table" style={styles.historyTable}>
                      <thead>
                        <tr>
                          <th>Date/Time</th>
                          <th>Days Since Last Reading</th>
                          <th>Outcome</th>
                          <th>Reason</th>
                          <th>Reading</th>
                          <th>Prev Reading</th>
                          <th>Consumption</th>
                          <th>Read By</th>
                          <th>TRN</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyRows.map((item) => (
                          <tr key={item.key}>
                            <td>{formatDateTime(item.readingAt)}</td>
                            <td>{item.sincePreviousReadingDisplay}</td>
                            <td>{item.outcomeLabel || NAv}</td>
                            <td>{item.reason || NAv}</td>
                            <td>
                              <strong>{formatReading(item.reading)}</strong>
                            </td>
                            <td>{formatReading(item.previousReading)}</td>
                            <td>
                              <strong>{formatReading(item.consumption)}</strong>
                            </td>
                            <td>
                              <strong>{item.capturedBy}</strong>
                              <div style={styles.secondaryId}>
                                <RegistryIdText value={item.capturedByUid} />
                              </div>
                            </td>
                            <td>
                              <RegistryIdText value={item.trnId} />
                            </td>
                            <td>{item.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}


function MreadStagingControllerModal({ lmPcode, onClose }) {
  const safeLmPcode = isMeaningfulText(lmPcode) ? String(lmPcode).trim() : "ZA2157";
  const [generateMreadStaging, { isLoading: isGenerating }] =
    useGenerateMreadStagingMutation();
  const [billingPeriod, setBillingPeriod] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [phaseNotice, setPhaseNotice] = useState("");

  const queryArgs = useMemo(
    () => ({
      lmPcode: safeLmPcode,
      billingPeriod: null,
      status: null,
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

  useEffect(() => {
    setSelectedCycle((current) => {
      if (!cycleRows.length) return null;
      if (current) {
        const stillExists = cycleRows.find(
          (row) => row.cycleId === current.cycleId,
        );
        if (stillExists) return stillExists;
      }

      return (
        cycleRows.find((row) => getCycleStatus(row) === "DRAFT") ||
        cycleRows.find((row) => getCycleStatus(row) === "CLOSED") ||
        cycleRows[0]
      );
    });
  }, [cycleRows]);

  const billingPeriodOptions = useMemo(() => {
    const periods = Array.from(
      new Set(cycleRows.map((row) => row.billingPeriod).filter(Boolean)),
    ).sort();

    return ["ALL", ...periods];
  }, [cycleRows]);

  const filteredCycleRows = useMemo(
    () =>
      cycleRows.filter((row) =>
        cycleMatchesFilter(row, { billingPeriod, status, search }),
      ),
    [cycleRows, billingPeriod, status, search],
  );

  const draftCycle = useMemo(
    () => cycleRows.find((row) => getCycleStatus(row) === "DRAFT") || null,
    [cycleRows],
  );

  const errorMessage =
    queryError?.message ||
    queryError?.data?.message ||
    queryError?.error ||
    "";

  async function handleCycleAction(row) {
    const action = getCycleAction(row);
    setSelectedCycle(row);

    if (action === "GENERATE_OPEN") {
      const cycleId = row?.cycleId || row?.id;

      if (!cycleId) {
        setPhaseNotice("Cannot generate staging because this cycle row has no cycleId.");
        return;
      }

      setPhaseNotice(
        `Generating ${getCycleLabel(row)}. This writes a new mread_staging pack and updates the cycle activeStagingId.`,
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
          `Generated ${getCycleLabel(row)} successfully. Staging ID: ${stagingId}. Rows: ${formatNumber(totalRows)}. Iteration: ${formatNumber(iteration)}.`,
        );

        await refetch();
        return;
      } catch (error) {
        const message =
          error?.data?.message ||
          error?.message ||
          error?.error ||
          "Could not generate MREAD staging.";
        setPhaseNotice(`Generate / Open failed for ${getCycleLabel(row)}: ${message}`);
        return;
      }
    }

    if (action === "VIEW") {
      if (row.activeStagingId) {
        setPhaseNotice(
          `View selected for ${getCycleLabel(row)}. Active staging pack: ${row.activeStagingId}. Staging table route/viewer is wired in the next UI step.`,
        );
        return;
      }

      setPhaseNotice(
        `View selected for ${getCycleLabel(row)}, but this cycle has no activeStagingId yet.`,
      );
      return;
    }

    setPhaseNotice(getCycleActionHelp(row));
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
              Launch Staging Process
            </h2>
            <p className="muted">
              Select the controlled cycle before generating or viewing an MREAD
              field-evidence staging pack. DRAFT is supplied by the backend controller, not by the UI.
            </p>
          </div>

          <button type="button" style={styles.modalCloseButton} onClick={onClose}>
            Close
          </button>
        </div>

        <div style={styles.modalBody}>
          <section style={styles.stagingControllerNotice}>
            Phase 1 launch is active. The backend controller calculates the
            current DRAFT cycle from the date. Only that DRAFT cycle may call
            <strong> generateMreadStaging</strong>, write a controlled
            <strong> mread_staging</strong> pack, and update
            <strong> mread_staging_cycles.activeStagingId</strong>. This modal
            still does not create cycle config, estimate readings, apply tariffs,
            or make billing decisions.
          </section>

          <section style={styles.stagingControllerSummaryGrid}>
            <div style={styles.stagingSummaryTile}>
              <span>Total Cycles</span>
              <strong>{formatNumber(summary?.total ?? cycleRows.length)}</strong>
            </div>
            <div style={styles.stagingSummaryTile}>
              <span>DRAFT</span>
              <strong>{formatNumber(summary?.draft ?? cycleRows.filter((row) => getCycleStatus(row) === "DRAFT").length)}</strong>
            </div>
            <div style={styles.stagingSummaryTile}>
              <span>CLOSED</span>
              <strong>{formatNumber(summary?.closed ?? cycleRows.filter((row) => getCycleStatus(row) === "CLOSED").length)}</strong>
            </div>
            <div style={styles.stagingSummaryTile}>
              <span>OPEN</span>
              <strong>{formatNumber(summary?.open ?? cycleRows.filter((row) => getCycleStatus(row) === "OPEN").length)}</strong>
            </div>
            <div style={styles.stagingSummaryTileWide}>
              <span>Active Draft</span>
              <strong>{draftCycle ? getCycleLabel(draftCycle) : "NAv"}</strong>
              <small>{draftCycle ? getCycleWindowDisplay(draftCycle) : "No DRAFT cycle returned"}</small>
            </div>
          </section>

          <section style={styles.stagingControllerFilters}>
            <label style={styles.stagingFilterLabel}>
              LM
              <input
                value={safeLmPcode}
                readOnly
                style={styles.stagingInput}
              />
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
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                style={styles.stagingInput}
              >
                <option value="ALL">ALL</option>
                <option value="DRAFT">DRAFT</option>
                <option value="CLOSED">CLOSED</option>
                <option value="OPEN">OPEN</option>
              </select>
            </label>

            <label style={styles.stagingFilterLabel}>
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={styles.stagingInput}
                placeholder="Cycle, window, status..."
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
                    Showing {formatNumber(filteredCycleRows.length)} of {formatNumber(cycleRows.length)} controller rows.
                  </p>
                </div>
              </div>

              {isFetching && !cycleRows.length ? (
                <LoadingSpinner
                  title="Loading staging cycles..."
                  message="Reading the mread_staging_cycles controller collection."
                />
              ) : null}

              {!isFetching && !filteredCycleRows.length ? (
                <div className="empty-state">
                  <h2>No staging cycles found</h2>
                  <p className="muted">
                    No controller rows matched this LM and filter selection.
                  </p>
                </div>
              ) : null}

              {filteredCycleRows.length ? (
                <div style={styles.stagingTableWrap}>
                  <table className="data-table" style={styles.stagingCyclesTable}>
                    <thead>
                      <tr>
                        <th>Cycle</th>
                        <th>Window</th>
                        <th>Status</th>
                        <th>Iteration</th>
                        <th>Last Generated</th>
                        <th>Rows</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCycleRows.map((row) => {
                        const selected = selectedCycle?.cycleId === row.cycleId;
                        const actionTone = getCycleActionTone(row);

                        return (
                          <tr
                            key={row.cycleId || getCycleLabel(row)}
                            style={selected ? styles.selectedStagingCycleRow : null}
                            onClick={() => setSelectedCycle(row)}
                          >
                            <td>
                              <strong>{getCycleLabel(row)}</strong>
                              <div style={styles.secondaryId}>
                                <RegistryIdText value={row.cycleId} />
                              </div>
                            </td>
                            <td>{getCycleWindowDisplay(row)}</td>
                            <td>
                              <StatusPill tone={getOutcomeToneForCycle(row)}>
                                {getCycleStatus(row)}
                              </StatusPill>
                            </td>
                            <td>{formatNumber(getCycleIteration(row))}</td>
                            <td>{formatDateTime(getCycleLastGeneratedAt(row))}</td>
                            <td>{formatNumber(getCycleRowsCount(row))}</td>
                            <td>
                              <button
                                type="button"
                                style={
                                  actionTone === "primary"
                                    ? styles.primaryMiniButton
                                    : actionTone === "secondary"
                                      ? styles.secondaryMiniButton
                                      : styles.disabledMiniButton
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCycleAction(row);
                                }}
                                disabled={actionTone === "disabled" || isGenerating}
                                title={getCycleActionHelp(row)}
                              >
                                {isGenerating && actionTone === "primary"
                                  ? "Generating..."
                                  : getCycleActionLabel(row)}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}

function getOutcomeToneForCycle(row = {}) {
  const status = getCycleStatus(row);
  if (status === "DRAFT") return "warning";
  if (status === "CLOSED") return "default";
  if (status === "OPEN") return "default";
  return "default";
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
                Last Reading is calculated by the backend and stored on
                the registry row.
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

function PaginationControls({
  currentPage,
  pageSize,
  totalPages,
  totalRows,
  onPageChange,
  onPageSizeChange,
}) {
  if (totalRows === 0) return null;

  const startRow = (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, totalRows);

  return (
    <div style={styles.paginationBar}>
      <div className="muted">
        Showing {formatNumber(startRow)}-{formatNumber(endRow)} of {formatNumber(totalRows)} rows
      </div>

      <div style={styles.paginationControls}>
        <label style={styles.pageSizeLabel}>
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            style={styles.pageSizeSelect}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
        >
          First
        </button>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span style={styles.pageCountLabel}>
          Page {formatNumber(currentPage)} of {formatNumber(totalPages)}
        </span>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
        <button
          type="button"
          style={styles.paginationButton}
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
        >
          Last
        </button>
      </div>
    </div>
  );
}


const COMPLETED_AT_FILTER_OPTIONS = [
  { mode: "TODAY", label: "Today" },
  { mode: "YESTERDAY", label: "Yesterday" },
  { mode: "PAST_3_DAYS", label: "Past 3 days" },
  { mode: "THIS_WEEK", label: "This week" },
  { mode: "THIS_MONTH", label: "This month" },
  { mode: "CUSTOM", label: "Custom range" },
];

function CompletedAtFilterModal({ filter, onApply, onClear, onClose }) {
  const [draftFilter, setDraftFilter] = useState({
    ...EMPTY_READING_DATE_FILTER,
    ...filter,
  });

  const selectedMode = draftFilter?.mode || "ALL";

  function updateMode(mode) {
    setDraftFilter((current) => ({
      ...current,
      mode,
      startDate: mode === "CUSTOM" ? current.startDate || "" : "",
      endDate: mode === "CUSTOM" ? current.endDate || "" : "",
    }));
  }

  function updateDate(key, value) {
    setDraftFilter((current) => ({
      ...current,
      mode: "CUSTOM",
      [key]: value,
    }));
  }

  return (
    <div
      style={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mread-completed-at-filter-title"
    >
      <div style={styles.completedAtFilterCard}>
        <div style={styles.modalHeader}>
          <div>
            <p className="eyebrow">Date / Time Filter</p>
            <h2 id="mread-completed-at-filter-title">Filter Completed At</h2>
            <p className="muted">
              Filters MREAD rows by the TRN completion/submission date.
            </p>
          </div>

          <button type="button" style={styles.modalCloseButton} onClick={onClose}>
            Close
          </button>
        </div>

        <div style={styles.modalBody}>
          <div style={styles.completedAtModeGrid}>
            {COMPLETED_AT_FILTER_OPTIONS.map((option) => {
              const isActive = selectedMode === option.mode;

              return (
                <button
                  key={option.mode}
                  type="button"
                  style={{
                    ...styles.completedAtModeButton,
                    ...(isActive ? styles.completedAtModeButtonActive : {}),
                  }}
                  onClick={() => updateMode(option.mode)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div style={styles.completedAtCustomGrid}>
            <label style={styles.completedAtDateLabel}>
              Start date
              <input
                type="date"
                value={draftFilter.startDate || ""}
                onChange={(event) => updateDate("startDate", event.target.value)}
                style={styles.headerInput}
              />
            </label>

            <label style={styles.completedAtDateLabel}>
              End date
              <input
                type="date"
                value={draftFilter.endDate || ""}
                onChange={(event) => updateDate("endDate", event.target.value)}
                style={styles.headerInput}
              />
            </label>
          </div>

          <div style={styles.completedAtFilterActions}>
            <button type="button" style={styles.secondaryButton} onClick={onClear}>
              Clear
            </button>
            <button type="button" style={styles.primaryButton} onClick={() => onApply(draftFilter)}>
              Apply Filter
            </button>
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
              {formatDateTime(getReadingAt(row))} · {formatNumber(evidence.photoCount)} photo(s)
            </p>
          </div>

          <button type="button" style={styles.modalCloseButton} onClick={onClose}>
            Close Media
          </button>
        </div>

        <div style={styles.modalBody}>
          {photoLinks.length === 0 ? (
            <div className="empty-state">
              <h2>No media photo URL available</h2>
              <p className="muted">
                The row reports {formatNumber(evidence.photoCount)} photo(s), but this registry row does not expose a usable media URL yet. Rebuild registry_mread after the backend media patch so the photo URL is written into the registry row.
              </p>
            </div>
          ) : (
            <div style={styles.evidenceGrid}>
              {photoLinks.map((item, index) => (
                <article key={`${item.url}-${index}`} style={styles.evidenceCard}>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    <img
                      src={item.url}
                      alt={item.tag || `Media ${index + 1}`}
                      style={styles.evidenceImage}
                    />
                  </a>
                  <div style={styles.evidenceMetaGrid}>
                  </div>
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

markJsxOnlyComponentUsage(
  Link,
  DatetimeFilterButton,
  CompletedAtFilterModal,
  DownloadButtons,
  RegistryIdText,
  SortButton,
  FilterInput,
  FilterSelect,
  HeaderCell,
  StatusPill,
  LoadingSpinner,
  CompactDetailLine,
  MediaLinksList,
  PaginationControls,
  MediaModal,
  HelpModal,
  RowDetailsModal,
  MeterHistoryModal,
  MreadStagingControllerModal,
);

export default function MreadRegistryPage() {
  const { activeWorkbase, role } = useAuth();
  const { geoState, updateGeo } = useGeo();

  const selectedWardPcode = getSelectedWardPcodeFromGeo(geoState);
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [filters, setFilters] = useState(EMPTY_MREAD_FILTERS);
  const [readingDateFilter, setReadingDateFilter] = useState(
    EMPTY_READING_DATE_FILTER,
  );
  const [isReadingDateFilterOpen, setIsReadingDateFilterOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedMeterRow, setSelectedMeterRow] = useState(null);
  const [selectedMediaRow, setSelectedMediaRow] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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

  const isRegistryOpening = Boolean(effectiveSelectedWardPcode) &&
    !error &&
    (isLoading || (isFetching && mreadRows.length === 0));

  useEffect(() => {
    let cancelled = false;

    const rowsNeedingAstGeofence = mreadRows.filter((row) => {
      if (getGeofenceName(row) !== NAv || getGeofenceId(row) !== NAv) return false;
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


  const filteredMreadRows = useMemo(() => {
    return mreadRows.filter((row) => {
      const outcome = getOutcome(row);
      const mediaLinks = getEvidencePhotoLinks(row);
      const evidence = getEvidence(row);
      const mediaStatus =
        mediaLinks.length > 0 || evidence.photoCount > 0 || evidence.hasPhoto
          ? "HAS_MEDIA"
          : "NO_MEDIA";
      const billingReadiness = getBillingReadiness(row);
      const completedAt = getCompletedAt(row);

      return (
        includesText(getMeterNo(row), filters.meterNo) &&
        (filters.outcome === "ALL" || outcome === filters.outcome) &&
        (filters.mediaStatus === "ALL" ||
          mediaStatus === filters.mediaStatus) &&
        includesText(
          getSincePreviousReadingDisplay(row),
          filters.sincePreviousReading,
        ) &&
        includesText(getReasonText(row), filters.reason) &&
        includesText(
          formatReading(getCurrentReading(row)),
          filters.currentReading,
        ) &&
        includesText(
          formatReading(getPreviousReading(row)),
          filters.previousReading,
        ) &&
        includesText(formatReading(getConsumption(row)), filters.consumption) &&
        (filters.meterType === "ALL" ||
          normalizeText(getMeterType(row)) ===
            normalizeText(filters.meterType)) &&
        includesText(getErfNo(row), filters.erfNo) &&
        includesText(
          `${getPremiseAddress(row)} ${getPremiseId(row)}`,
          filters.premiseAddress,
        ) &&
        includesText(getWardNo(row), filters.wardNo) &&
        (filters.geofence === "ALL" ||
          getGeofenceFilterValue(row, astGeofenceByAstId) === filters.geofence) &&
        includesText(
          `${getCapturedByName(row)} ${getCapturedByUid(row)}`,
          filters.capturedBy,
        ) &&
        (filters.billingReadiness === "ALL" ||
          billingReadiness === filters.billingReadiness) &&
        (filters.reviewStatus === "ALL" ||
          getReviewStatus(row) === filters.reviewStatus) &&
        matchesReadingDateFilter(completedAt, readingDateFilter)
      );
    });
  }, [mreadRows, filters, readingDateFilter, astGeofenceByAstId]);

  const sortedMreadRows = useMemo(() => {
    const rows = [...filteredMreadRows];

    rows.sort((a, b) => {
      const comparison = compareNatural(
        getSortValue(a, sortConfig.key, astGeofenceByAstId),
        getSortValue(b, sortConfig.key, astGeofenceByAstId),
      );
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [filteredMreadRows, sortConfig, astGeofenceByAstId]);

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

  const totalRows = sortedMreadRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const pageStartIndex = totalRows === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, totalRows);
  const paginatedMreadRows = useMemo(() => {
    return sortedMreadRows.slice(pageStartIndex, pageEndIndex);
  }, [sortedMreadRows, pageStartIndex, pageEndIndex]);


  const totals = sortedMreadRows.reduce(
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
      { header: "ERF No", value: (row) => getErfNo(row) },
      { header: "ERF ID", value: (row) => getErfId(row) },
      { header: "Premise Address", value: (row) => getPremiseAddress(row) },
      { header: "Premise ID", value: (row) => getPremiseId(row) },
      { header: "Property Type", value: (row) => getPropertyType(row) },
      { header: "Ward", value: (row) => getWardNo(row) },
      { header: "Ward Pcode", value: (row) => getWardPcode(row) },
      { header: "Geofence", value: (row) => getGeofenceName(row, astGeofenceByAstId) },
      { header: "Geofence ID", value: (row) => getGeofenceId(row, astGeofenceByAstId) },
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

  function updateFilter(key, value) {
    setCurrentPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetTableControls() {
    setFilters(EMPTY_MREAD_FILTERS);
    setReadingDateFilter(EMPTY_READING_DATE_FILTER);
    setSortConfig(DEFAULT_SORT);
    setCurrentPage(1);
    setSelectedRow(null);
    setSelectedMeterRow(null);
    setSelectedMediaRow(null);
  }

  function handleSort(sortKey) {
    setCurrentPage(1);
    setSortConfig((current) => {
      if (current.key !== sortKey) return { key: sortKey, direction: "asc" };
      if (current.direction === "asc")
        return { key: sortKey, direction: "desc" };
      return DEFAULT_SORT;
    });
  }

  function handlePageChange(nextPage) {
    const normalizedPage = Number(nextPage);
    const clampedPage = Math.max(
      1,
      Math.min(Number.isFinite(normalizedPage) ? normalizedPage : 1, totalPages),
    );
    setCurrentPage(clampedPage);
  }

  function handlePageSizeChange(nextPageSize) {
    const normalizedPageSize = Number(nextPageSize);
    const nextSize = PAGE_SIZE_OPTIONS.includes(normalizedPageSize)
      ? normalizedPageSize
      : DEFAULT_PAGE_SIZE;
    setPageSize(nextSize);
    setCurrentPage(1);
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
            Showing completed meter-reading registry rows captured in iREPS.
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
                : `${formatNumber(sortedMreadRows.length)} MREADs`}
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
          <DownloadButtons
            registryName="MREAD Registry"
            rowsLabel="MREAD rows"
            visibleRows={sortedMreadRows}
            columns={quickDownloadColumns}
            fileBaseName="mread_registry"
            scope={quickDownloadScope}
          />
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
          <strong>{formatNumber(sortedMreadRows.length)}</strong>
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
            <PaginationControls
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              totalPages={totalPages}
              totalRows={totalRows}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />

            <div className="table-wrap" style={styles.tableWrap}>
              <table className="data-table mread-registry-table" style={styles.table}>
              <thead>
                <tr>
                  <HeaderCell minWidth={150}>
                    <SortButton
                      label="Meter No"
                      sortKey="meterNo"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.meterNo}
                      onChange={(value) => updateFilter("meterNo", value)}
                      placeholder="Meter no"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={170}>
                    <SortButton
                      label="Completed At"
                      sortKey="completedAt"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <DatetimeFilterButton
                      filter={readingDateFilter}
                      onClick={() => setIsReadingDateFilterOpen(true)}
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={185}>
                    <SortButton
                      label="Days Since Last Reading"
                      sortKey="sincePreviousReading"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.sincePreviousReading}
                      onChange={(value) =>
                        updateFilter("sincePreviousReading", value)
                      }
                      placeholder="Days / hrs / min"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={170}>
                    <SortButton
                      label="Outcome"
                      sortKey="outcome"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.outcome}
                      onChange={(value) => updateFilter("outcome", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="SUCCESSFUL_READING">Successful</option>
                      <option value="UNSUCCESSFUL_READING">Unsuccessful</option>
                      <option value="NO_ACCESS">No Access</option>
                    </FilterSelect>
                  </HeaderCell>

                  <HeaderCell minWidth={150}>
                    <SortButton
                      label="Media"
                      sortKey="media"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.mediaStatus}
                      onChange={(value) => updateFilter("mediaStatus", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="HAS_MEDIA">Has Media</option>
                      <option value="NO_MEDIA">No Media</option>
                    </FilterSelect>
                  </HeaderCell>

                  <HeaderCell minWidth={180}>
                    <SortButton
                      label="Reason"
                      sortKey="reason"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.reason}
                      onChange={(value) => updateFilter("reason", value)}
                      placeholder="Reason"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={145}>
                    <SortButton
                      label="Current Reading"
                      sortKey="currentReading"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.currentReading}
                      onChange={(value) =>
                        updateFilter("currentReading", value)
                      }
                      placeholder="Current"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={130}>
                    <SortButton
                      label="Prev Reading"
                      sortKey="previousReading"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.previousReading}
                      onChange={(value) =>
                        updateFilter("previousReading", value)
                      }
                      placeholder="Prev"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={130}>
                    <SortButton
                      label="Consumption"
                      sortKey="consumption"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.consumption}
                      onChange={(value) => updateFilter("consumption", value)}
                      placeholder="Use"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={130}>
                    <SortButton
                      label="Type"
                      sortKey="meterType"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.meterType}
                      onChange={(value) => updateFilter("meterType", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="electricity">Electricity</option>
                      <option value="water">Water</option>
                    </FilterSelect>
                  </HeaderCell>

                  <HeaderCell minWidth={120}>
                    <SortButton
                      label="ERF No"
                      sortKey="erfNo"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.erfNo}
                      onChange={(value) => updateFilter("erfNo", value)}
                      placeholder="ERF"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={240}>
                    <SortButton
                      label="Premise Address"
                      sortKey="premiseAddress"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.premiseAddress}
                      onChange={(value) =>
                        updateFilter("premiseAddress", value)
                      }
                      placeholder="Address / ID"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={100}>
                    <SortButton
                      label="Ward"
                      sortKey="wardNo"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.wardNo}
                      onChange={(value) => updateFilter("wardNo", value)}
                      placeholder="No"
                    />
                  </HeaderCell>

                  <HeaderCell minWidth={150}>
                    <SortButton
                      label="Geofence"
                      sortKey="geofence"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.geofence}
                      onChange={(value) => updateFilter("geofence", value)}
                    >
                      <option value="ALL">All Geofences</option>
                      {geofenceOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </FilterSelect>
                  </HeaderCell>

                  <HeaderCell minWidth={160}>
                    <SortButton
                      label="Captured By"
                      sortKey="capturedBy"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterInput
                      value={filters.capturedBy}
                      onChange={(value) => updateFilter("capturedBy", value)}
                      placeholder="User"
                    />
                  </HeaderCell>


                  <HeaderCell minWidth={170}>
                    <SortButton
                      label="Billing"
                      sortKey="billingReadiness"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.billingReadiness}
                      onChange={(value) =>
                        updateFilter("billingReadiness", value)
                      }
                    >
                      <option value="ALL">All</option>
                      <option value="BILLING_READY_CANDIDATE">
                        Billing Ready
                      </option>
                      <option value="BILLING_REVIEW_REQUIRED">Review</option>
                      <option value="NOT_BILLING_READY">Not Ready</option>
                    </FilterSelect>
                  </HeaderCell>

                  <HeaderCell minWidth={150}>
                    <SortButton
                      label="Review"
                      sortKey="reviewStatus"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                    />
                    <FilterSelect
                      value={filters.reviewStatus}
                      onChange={(value) => updateFilter("reviewStatus", value)}
                    >
                      <option value="ALL">All</option>
                      <option value="REVIEW_REQUIRED">Required</option>
                      <option value="NAv">No Review</option>
                    </FilterSelect>
                  </HeaderCell>

                  <HeaderCell minWidth={120}>Actions</HeaderCell>
                </tr>
              </thead>

              <tbody>
                {sortedMreadRows.length === 0 ? (
                  <tr>
                    <td colSpan={18} className="muted">
                      No MREAD rows match the current filters. Clear or adjust a
                      column filter above.
                    </td>
                  </tr>
                ) : null}

                {paginatedMreadRows.map((row) => {
                  const outcome = getOutcome(row);
                  const evidence = getEvidence(row);
                  const mediaLinks = getEvidencePhotoLinks(row);
                  return (
                    <tr key={row.id || getTrnId(row)}>
                      <td>
                        <button
                          type="button"
                          className="text-link"
                          style={styles.meterNoButton}
                          onClick={() => setSelectedMeterRow(row)}
                          title="Open meter details and reading history"
                        >
                          {getMeterNo(row)}
                        </button>
                      </td>
                      <td>{formatDateTime(getCompletedAt(row))}</td>
                      <td>
                        <strong>{getSincePreviousReadingDisplay(row)}</strong>
                      </td>
                      <td>
                        <StatusPill tone={getOutcomeTone(outcome)}>
                          {getOutcomeLabel(outcome)}
                        </StatusPill>
                      </td>
                      <td>
                        {evidence.photoCount > 0 || mediaLinks.length > 0 ? (
                          <button
                            type="button"
                            style={styles.evidenceButton}
                            onClick={() => setSelectedMediaRow(row)}
                          >
                            {formatNumber(evidence.photoCount || mediaLinks.length)} photo(s)
                          </button>
                        ) : (
                          <span className="muted">No media</span>
                        )}
                      </td>
                      <td>{getReasonText(row)}</td>
                      <td>
                        <strong>{formatReading(getCurrentReading(row))}</strong>
                      </td>
                      <td>{formatReading(getPreviousReading(row))}</td>
                      <td>
                        <strong>{formatReading(getConsumption(row))}</strong>
                      </td>
                      <td>{getMeterTypeLabel(getMeterType(row))}</td>
                      <td>{getErfNo(row)}</td>
                      <td>
                        <strong>{getPremiseAddress(row)}</strong>
                        <div style={styles.secondaryId}>
                          <RegistryIdText value={getPremiseId(row)} />
                        </div>
                      </td>
                      <td>
                        <strong>{getWardNo(row)}</strong>
                      </td>
                      <td>{getGeofenceName(row, astGeofenceByAstId)}</td>
                      <td>
                        <strong>{getCapturedByName(row)}</strong>
                        <div style={styles.secondaryId}>
                          <RegistryIdText value={getCapturedByUid(row)} />
                        </div>
                        {isMeaningfulText(getCapturedByRole(row)) ? (
                          <div className="muted">{getCapturedByRole(row)}</div>
                        ) : null}
                      </td>

                      <td>
                        <StatusPill
                          tone={getBillingTone(getBillingReadiness(row))}
                        >
                          {getBillingReadinessLabel(getBillingReadiness(row))}
                        </StatusPill>
                      </td>
                      <td>
                        <StatusPill tone={getReviewTone(getReviewStatus(row))}>
                          {getReviewStatus(row)}
                        </StatusPill>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setSelectedRow(row)}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={safeCurrentPage}
              pageSize={pageSize}
              totalPages={totalPages}
              totalRows={totalRows}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        ) : null}
      </section>

      {isReadingDateFilterOpen ? (
        <CompletedAtFilterModal
          filter={readingDateFilter}
          onApply={(nextFilter) => {
            setCurrentPage(1);
            setReadingDateFilter(nextFilter);
            setIsReadingDateFilterOpen(false);
          }}
          onClear={() => {
            setCurrentPage(1);
            setReadingDateFilter(EMPTY_READING_DATE_FILTER);
            setSortConfig(DEFAULT_SORT);
            setIsReadingDateFilterOpen(false);
          }}
          onClose={() => setIsReadingDateFilterOpen(false)}
        />
      ) : null}

      {selectedRow ? (
        <RowDetailsModal
          row={selectedRow}
          astGeofenceByAstId={astGeofenceByAstId}
          onClose={() => setSelectedRow(null)}
        />
      ) : null}
      {selectedMeterRow ? (
        <MeterHistoryModal
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
  stagingCyclesTable: {
    minWidth: "920px",
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
  secondaryMiniButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
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
  paginationBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem 0.9rem",
    flexWrap: "wrap",
  },
  paginationControls: {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    flexWrap: "wrap",
  },
  pageSizeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    color: "#64748b",
    fontSize: "0.82rem",
    fontWeight: 700,
  },
  pageSizeSelect: {
    border: "1px solid rgba(148, 163, 184, 0.45)",
    borderRadius: "0.55rem",
    padding: "0.34rem 0.45rem",
    fontSize: "0.82rem",
  },
  paginationButton: {
    border: "1px solid rgba(148, 163, 184, 0.42)",
    background: "#fff",
    color: "#0f172a",
    borderRadius: "0.6rem",
    padding: "0.36rem 0.58rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  pageCountLabel: {
    color: "#334155",
    fontSize: "0.82rem",
    fontWeight: 800,
    padding: "0 0.2rem",
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
  table: {
    minWidth: "2760px",
  },
  headerCell: {
    verticalAlign: "top",
    padding: "0.65rem 0.9rem",
    whiteSpace: "normal",
  },
  headerStack: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    alignItems: "stretch",
    minWidth: 0,
  },
  sortButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    border: 0,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    fontWeight: 800,
    padding: 0,
    textAlign: "left",
    gap: "0.5rem",
  },
  headerInput: {
    width: "100%",
    minWidth: 0,
    padding: "0.38rem 0.45rem",
    border: "1px solid rgba(148, 163, 184, 0.45)",
    borderRadius: "0.55rem",
    fontSize: "0.78rem",
    boxSizing: "border-box",
  },
  headerSelect: {
    width: "100%",
    minWidth: 0,
    padding: "0.38rem 0.45rem",
    border: "1px solid rgba(148, 163, 184, 0.45)",
    borderRadius: "0.55rem",
    fontSize: "0.78rem",
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
  completedAtFilterCard: {
    width: "min(620px, 96vw)",
    maxHeight: "88vh",
    overflow: "hidden",
    background: "#fff",
    borderRadius: "1.2rem",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.28)",
    display: "flex",
    flexDirection: "column",
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
  completedAtModeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "0.6rem",
    marginBottom: "1rem",
  },
  completedAtModeButton: {
    border: "1px solid rgba(148, 163, 184, 0.45)",
    background: "#fff",
    color: "#0f172a",
    borderRadius: "0.75rem",
    padding: "0.65rem 0.75rem",
    fontWeight: 800,
    cursor: "pointer",
    textAlign: "left",
  },
  completedAtModeButtonActive: {
    borderColor: "rgba(37, 99, 235, 0.55)",
    background: "rgba(37, 99, 235, 0.08)",
    color: "#1d4ed8",
  },
  completedAtCustomGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "0.75rem",
    marginTop: "0.75rem",
  },
  completedAtDateLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    color: "#334155",
    fontSize: "0.82rem",
    fontWeight: 800,
  },
  completedAtFilterActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.65rem",
    marginTop: "1.25rem",
    flexWrap: "wrap",
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
  secondaryButton: {
    border: "1px solid rgba(148, 163, 184, 0.55)",
    background: "#fff",
    color: "#0f172a",
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
  meterHistoryStack: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  sectionHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    marginBottom: "0.75rem",
  },
  readingSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "0.55rem",
  },
  readingSummaryTile: {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: "0.75rem",
    padding: "0.55rem 0.65rem",
    background: "rgba(255, 255, 255, 0.78)",
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    minWidth: 0,
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
  historyTableWrap: {
    overflowX: "auto",
  },
  historyTable: {
    minWidth: "920px",
  },
};
