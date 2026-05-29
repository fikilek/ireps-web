// src/redux/store.js

import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";

import { registryErfsApi } from "./registryErfsApi";
import { registryMetersApi } from "./registryMetersApi";
import { registryPremisesApi } from "./registryPremisesApi";
import { registryWardsApi } from "./registryWardsApi";
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
import { geofencesApi } from "./geofencesApi";

export const store = configureStore({
  reducer: {
    [registryWardsApi.reducerPath]: registryWardsApi.reducer,
    [registryErfsApi.reducerPath]: registryErfsApi.reducer,
    [registryPremisesApi.reducerPath]: registryPremisesApi.reducer,
    [registryMetersApi.reducerPath]: registryMetersApi.reducer,

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
    [geofencesApi.reducerPath]: geofencesApi.reducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(registryWardsApi.middleware)
      .concat(registryErfsApi.middleware)
      .concat(registryPremisesApi.middleware)
      .concat(registryMetersApi.middleware)
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
      .concat(geofencesApi.middleware),
});

setupListeners(store.dispatch);
