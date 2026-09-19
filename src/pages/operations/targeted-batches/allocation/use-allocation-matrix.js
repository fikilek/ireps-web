// Targeted Batch rules TB-R045: the Allocation Matrix's TEAM / SP numbers for one LM. Used by the
// Allocation Matrix page and by the Allocation Matrix section on TB Register (1.3.51), so both
// always show the same numbers.
import { useMemo } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useAuth } from "../../../../auth/useAuth";
import {
  useGetFieldWorkSummaryByLmQuery,
  useGetTargetedBatchAllocationDirectoryQuery,
  useGetTargetedBatchAllocationMatrixByLmQuery,
} from "../../../../redux/salesTargetedBatchApi";
import { useGetUsersDirectoryQuery } from "../../../../redux/usersApi";
import { addFieldWorkToMatrix, buildOrganisationAllocationMatrixResult } from "./allocationMatrixModel";
import {
  buildUsersById,
  enrichServiceProvidersWithMembers,
  enrichTeamsWithMembers,
  getActorMncServiceProviderId,
} from "./targetedBatchAllocationUtils";

const EMPTY_LIST = Object.freeze([]);
const listOf = (value) => (Array.isArray(value) ? value : EMPTY_LIST);

export function useAllocationMatrix(lmPcode) {
  const actorMncServiceProviderId = getActorMncServiceProviderId(useAuth());

  const {
    data: matrixStream,
    isError: matrixQueryFailed,
    error: matrixQueryError,
  } = useGetTargetedBatchAllocationMatrixByLmQuery(lmPcode || skipToken);

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
      }),
    [batches, integrityRows, enrichedTeams, enrichedServiceProviders],
  );
  const organisations = organisationMatrixResult.organisations;
  const matrixRows = useMemo(
    () => addFieldWorkToMatrix(organisations, fieldWorkGroups),
    [organisations, fieldWorkGroups],
  );

  const loading =
    (Boolean(lmPcode) && matrixStream?.sync?.status === "syncing") ||
    (Boolean(actorMncServiceProviderId) &&
      allocationDirectory?.sync?.status === "syncing") ||
    usersLoading;
  const error =
    matrixStream?.sync?.error ||
    (matrixQueryFailed ? matrixQueryError : null) ||
    allocationDirectory?.sync?.error ||
    (directoryQueryFailed ? directoryQueryError : null) ||
    null;

  return {
    lmPcode,
    actorMncServiceProviderId,
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
