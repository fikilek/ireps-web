// src/redux/store.js

import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";

import { registryErfsApi } from "./registryErfsApi";
import { registryMetersApi } from "./registryMetersApi";
import { registryPremisesApi } from "./registryPremisesApi";
import { registryWardsApi } from "./registryWardsApi";
import { registryAccountsApi } from "./registryAccountsApi";
import { reportAnomalyApi } from "./reportAnomalyApi";
import { reportNoAccessApi } from "./reportNoAccessApi";
import { reportNormalisationApi } from "./reportNormalisationApi";
import { reportUserActivityApi } from "./reportUserActivityApi";
import { mapLmsApi } from "./mapLmsApi";
import { mapWardsApi } from "./mapWardsApi";
import { mapGeofencesApi } from "./mapGeofencesApi";
import { mapPremisesApi } from "./mapPremisesApi";
import { mapErfsApi } from "./mapErfsApi";
import { wardErfsApi } from "./wardErfsApi";
import { astsApi } from "./astsApi";
import { tcApi } from "./tcApi";
import { bgoApi } from "./bgoApi";
import { trnsApi } from "./trnsApi";
import { teamsApi } from "./teamsApi";
import { serviceProvidersApi } from "./serviceProvidersApi";
import { usersApi } from "./usersApi";
import { geofencesApi } from "./geofencesApi";
import { registryMreadApi } from "./registryMreadApi";
import { mreadStagingCyclesApi } from "./mreadStagingCyclesApi";
import { mreadStagingApi } from "./mreadStagingApi";
import { fwrLiveLocationsApi } from "./fwrLiveLocationsApi";

export const store = configureStore({
  reducer: {
    [registryWardsApi.reducerPath]: registryWardsApi.reducer,
    [registryErfsApi.reducerPath]: registryErfsApi.reducer,
    [registryPremisesApi.reducerPath]: registryPremisesApi.reducer,
    [registryMetersApi.reducerPath]: registryMetersApi.reducer,
    [registryAccountsApi.reducerPath]: registryAccountsApi.reducer,
    [registryMreadApi.reducerPath]: registryMreadApi.reducer,
    [mreadStagingCyclesApi.reducerPath]: mreadStagingCyclesApi.reducer,
    [mreadStagingApi.reducerPath]: mreadStagingApi.reducer,

    [reportNoAccessApi.reducerPath]: reportNoAccessApi.reducer,
    [reportUserActivityApi.reducerPath]: reportUserActivityApi.reducer,
    [reportAnomalyApi.reducerPath]: reportAnomalyApi.reducer,
    [reportNormalisationApi.reducerPath]: reportNormalisationApi.reducer,

    [mapLmsApi.reducerPath]: mapLmsApi.reducer,
    [mapWardsApi.reducerPath]: mapWardsApi.reducer,
    [mapGeofencesApi.reducerPath]: mapGeofencesApi.reducer,
    [mapPremisesApi.reducerPath]: mapPremisesApi.reducer,
    [mapErfsApi.reducerPath]: mapErfsApi.reducer,

    [wardErfsApi.reducerPath]: wardErfsApi.reducer,
    [astsApi.reducerPath]: astsApi.reducer,
    [tcApi.reducerPath]: tcApi.reducer,
    [bgoApi.reducerPath]: bgoApi.reducer,
    [trnsApi.reducerPath]: trnsApi.reducer,
    [teamsApi.reducerPath]: teamsApi.reducer,
    [serviceProvidersApi.reducerPath]: serviceProvidersApi.reducer,
    [usersApi.reducerPath]: usersApi.reducer,
    [geofencesApi.reducerPath]: geofencesApi.reducer,
    [fwrLiveLocationsApi.reducerPath]: fwrLiveLocationsApi.reducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(registryWardsApi.middleware)
      .concat(registryErfsApi.middleware)
      .concat(registryPremisesApi.middleware)
      .concat(registryMetersApi.middleware)
      .concat(registryAccountsApi.middleware)
      .concat(registryMreadApi.middleware)
      .concat(mreadStagingCyclesApi.middleware)
      .concat(mreadStagingApi.middleware)
      .concat(reportNoAccessApi.middleware)
      .concat(reportUserActivityApi.middleware)
      .concat(reportAnomalyApi.middleware)
      .concat(reportNormalisationApi.middleware)
      .concat(mapLmsApi.middleware)
      .concat(mapWardsApi.middleware)
      .concat(mapGeofencesApi.middleware)
      .concat(mapPremisesApi.middleware)
      .concat(mapErfsApi.middleware)
      .concat(wardErfsApi.middleware)
      .concat(astsApi.middleware)
      .concat(tcApi.middleware)
      .concat(bgoApi.middleware)
      .concat(trnsApi.middleware)
      .concat(teamsApi.middleware)
      .concat(serviceProvidersApi.middleware)
      .concat(usersApi.middleware)
      .concat(geofencesApi.middleware)
      .concat(fwrLiveLocationsApi.middleware),
});

setupListeners(store.dispatch);
