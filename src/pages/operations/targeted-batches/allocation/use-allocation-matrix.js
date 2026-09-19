// Targeted Batch rules TB-R045: the Allocation Matrix's TEAM / SP numbers for one LM. Used by the
// Allocation Matrix page and by the Allocation Matrix section on TB Register (1.3.51), so both
// always show the same numbers. Since 1.3.57 the TEAM / SP numbers are counted from the batch rows,
// with the same counts as Sales Reporting (TB-R054).
import { useMemo } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../../../auth/useAuth";
import {
  useGetFieldWorkSummaryByLmQuery,
  useGetTargetedBatchAllocationDirectoryQuery,
  useGetTargetedBatchAllocationMatrixByLmQuery,
  useGetTargetedBatchRowCountsByLmQuery,
} from "../../../../redux/salesTargetedBatchApi";
import { useGetUsersDirectoryQuery } from "../../../../redux/usersApi";
import { getReportingCountsState } from "../../../sales/models/salesReportingCountsModel.js";
import { addFieldWorkToMatrix, buildOrganisationAllocationMatrixResult } from "./allocationMatrixModel";
import {
  buildUsersById,
  enrichServiceProvidersWithMembers,
  enrichTeamsWithMembers,
  getActorMncServiceProviderId,
} from "./targetedBatchAllocationUtils";

const EMPTY_LIST = Object.freeze([]);
const NO_ROW_COUNTS = Object.freeze({});
const listOf = (value) => (Array.isArray(value) ? value : EMPTY_LIST);

export function useAllocationMatrix(lmPcode) {
  const actorMncServiceProviderId = getActorMncServiceProviderId(useAuth());

  const {
    data: matrixStream,
    isError: matrixQueryFailed,
    error: matrixQueryError,
  } = useGetTargetedBatchAllocationMatrixByLmQuery(lmPcode || skipToken);

  // Rules TB-R045 (1.3.57): one status per batch row, shared with Sales Reporting's read.
  const {
    data: rowCountsStream,
    isError: rowCountsQueryFailed,
    error: rowCountsQueryError,
  } = useGetTargetedBatchRowCountsByLmQuery(lmPcode || skipToken);
  const countsState = getReportingCountsState({
    hasWorkbase: Boolean(lmPcode),
    batchesStatus: matrixStream?.sync?.status,
    batchesFailed: matrixQueryFailed || Boolean(matrixStream?.sync?.error),
    rowCountSources: rowCountsStream?.sync?.sources,
    rowCountsFailed: rowCountsQueryFailed,
  });
  // Until every row is counted the numbers are not shown (loading), and never the running totals.
  const rowCountsByBatch = countsState === "ready" ? rowCountsStream?.countsByBatch || NO_ROW_COUNTS : NO_ROW_COUNTS;
  // TB-R054: rows whose Sales meter could not be read are counted by the batch row only; say so.
  const salesUnreadRows = countsState === "ready" ? Number(rowCountsStream?.salesUnreadRows || 0) : 0;

  const {
    data: allocationDirectory,
    isError: directoryQueryFailed,
    error: directoryQueryError,
  } = useGetTargetedBatchAllocationDirectoryQuery(
    actorMncServiceProviderId || skipToken,
  );

  // Rules TB-R045 (1.3.26): work outside batches, as totals worked out by the server.
  const {
    currentData: fieldWorkSummary,
    isFetching: fieldWorkFetching,
    isError: fieldWorkFailed,
    error: fieldWorkError,
    refetch: refetchFieldWork,
  } = useGetFieldWorkSummaryByLmQuery(lmPcode ? { lmPcode } : skipToken);
  const fieldWorkGroups = listOf(fieldWorkSummary?.groups);

  const { data: users = EMPTY_LIST, isLoading: usersLoading } =
    useGetUsersDirectoryQuery({ limit: 1000 });

  const teams = listOf(allocationDirectory?.teams);
  const serviceProviders = listOf(allocationDirectory?.serviceProviders);
  const batches = listOf(matrixStream?.batches);
  const integrityRows = listOf(matrixStream?.rows);
  const usersById = useMemo(() => buildUsersById(users), [users]);
  const enrichedTeams = useMemo(
    () => enrichTeamsWithMembers(teams, usersById),
    [teams, usersById],
  );
  const enrichedServiceProviders = useMemo(
    () => enrichServiceProvidersWithMembers(serviceProviders, users),
    [serviceProviders, users],
  );

  const organisationMatrixResult = useMemo(
    () =>
      buildOrganisationAllocationMatrixResult({
        batches,
        rows: integrityRows,
        teams: enrichedTeams,
        serviceProviders: enrichedServiceProviders,
        rowCountsByBatch,
      }),
    [batches, integrityRows, enrichedTeams, enrichedServiceProviders, rowCountsByBatch],
  );
  const organisations = organisationMatrixResult.organisations;
  const matrixRows = useMemo(
    () => addFieldWorkToMatrix(organisations, fieldWorkGroups),
    [organisations, fieldWorkGroups],
  );

  const loading =
    (Boolean(lmPcode) && matrixStream?.sync?.status === "syncing") ||
    countsState === "counting" ||
    (Boolean(actorMncServiceProviderId) &&
      allocationDirectory?.sync?.status === "syncing") ||
    usersLoading;
  const error =
    matrixStream?.sync?.error ||
    (matrixQueryFailed ? matrixQueryError : null) ||
    allocationDirectory?.sync?.error ||
    (directoryQueryFailed ? directoryQueryError : null) ||
    (countsState === "error"
      ? rowCountsStream?.sync?.error ||
        (rowCountsQueryFailed ? rowCountsQueryError : null) ||
        { message: "The batch rows could not be counted." }
      : null) ||
    null;

  return {
    lmPcode,
    actorMncServiceProviderId,
    salesUnreadRows,
    batches,
    users,
    enrichedTeams,
    organisations,
    integrityIssues: organisationMatrixResult.integrityIssues,
    matrixRows,
    fieldWork: {
      summary: fieldWorkSummary,
      fetching: fieldWorkFetching,
      failed: fieldWorkFailed,
      error: fieldWorkError,
      refetch: refetchFieldWork,
    },
    loading,
    error,
  };
}
