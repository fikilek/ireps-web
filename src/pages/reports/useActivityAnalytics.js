import { useMemo } from "react";
import { skipToken } from "@reduxjs/toolkit/query";

import { useGetAvailableServiceProvidersQuery } from "../../redux/serviceProvidersApi";
import { useGetAvailableTeamsQuery } from "../../redux/teamsApi";
import { useGetRegistryTrnsByLmPcodeQuery } from "../../redux/trnsApi";
import { useGetUsersDirectoryQuery } from "../../redux/usersApi";
import { buildActivityAnalytics } from "./activityAnalyticsModel";

export default function useActivityAnalytics({ lmPcode, dateFilter } = {}) {
  const {
    data: registryTrns = [],
    isLoading: isTrnsLoading,
    isFetching: isTrnsFetching,
    error: trnsError,
  } = useGetRegistryTrnsByLmPcodeQuery(lmPcode || skipToken);

  const {
    data: teams = [],
    isLoading: isTeamsLoading,
    isFetching: isTeamsFetching,
    error: teamsError,
  } = useGetAvailableTeamsQuery();

  const {
    data: serviceProviders = [],
    isLoading: isServiceProvidersLoading,
    isFetching: isServiceProvidersFetching,
    error: serviceProvidersError,
  } = useGetAvailableServiceProvidersQuery();

  const {
    data: users = [],
    isLoading: isUsersLoading,
    isFetching: isUsersFetching,
    error: usersError,
  } = useGetUsersDirectoryQuery();

  const analytics = useMemo(
    () =>
      buildActivityAnalytics({
        registryTrns,
        users,
        teams,
        serviceProviders,
        dateFilter,
      }),
    [registryTrns, users, teams, serviceProviders, dateFilter],
  );

  return {
    ...analytics,
    isLoading:
      isTrnsLoading || isTeamsLoading || isServiceProvidersLoading || isUsersLoading,
    isFetching:
      isTrnsFetching || isTeamsFetching || isServiceProvidersFetching || isUsersFetching,
    error: trnsError || teamsError || serviceProvidersError || usersError,
  };
}
