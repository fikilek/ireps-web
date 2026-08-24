import { skipToken } from "@reduxjs/toolkit/query";

import { useGetTargetedBatchDashboardQuery } from "../../../../redux/salesTargetedBatchApi";
import {
  getBatchId,
  sortBatchesByUpdatedDesc,
} from "./targetedBatchDashboardModel";

function getErrorMessage(error) {
  return (
    error?.message ||
    error?.error ||
    error?.data?.message ||
    "The permanent Targeted Batch dashboard data could not be loaded."
  );
}

export default function useTargetedBatchDashboardData({
  lmPcode = null,
  tbId = null,
} = {}) {
  const normalizedTbId = String(tbId || "").trim();
  const normalizedLmPcode = String(lmPcode || "").trim();
  const queryArg = normalizedTbId
    ? { tbId: normalizedTbId }
    : normalizedLmPcode
      ? { lmPcode: normalizedLmPcode }
      : skipToken;

  const {
    data: stream,
    isError: queryFailed,
    error: queryError,
  } = useGetTargetedBatchDashboardQuery(queryArg);

  const batches = Array.isArray(stream?.batches)
    ? [...stream.batches].sort(sortBatchesByUpdatedDesc)
    : [];
  const rows = Array.isArray(stream?.rows) ? stream.rows : [];
  const metricsByTbId = stream?.metricsByTbId || {};
  const integrityByTbId = stream?.integrityByTbId || {};
  const syncError = stream?.sync?.error;
  const loadError = syncError
    ? getErrorMessage(syncError)
    : queryFailed
      ? getErrorMessage(queryError)
      : "";
  const hasScope = Boolean(normalizedTbId || normalizedLmPcode);
  const isLoading = hasScope && !loadError && stream?.sync?.status !== "ready";
  const batch = normalizedTbId
    ? batches.find((item) => getBatchId(item) === normalizedTbId) || null
    : null;

  return {
    batches,
    rows,
    metricsByTbId,
    integrityByTbId,
    batch,
    metrics: normalizedTbId ? metricsByTbId[normalizedTbId] || null : null,
    integrity: normalizedTbId
      ? integrityByTbId[normalizedTbId] || null
      : null,
    isLoading,
    loadError,
  };
}
